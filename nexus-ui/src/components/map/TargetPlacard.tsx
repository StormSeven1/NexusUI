/**
 * TargetPlacard — 目标属性卡片（航迹/资产选中时弹出）
 *
 * 【数据流】
 *   - 选中航迹/资产 → appStore.selectedTrackId / selectedAssetId
 *   → 本组件从 track-store / asset-store 取数据 → 展示属性
 *
 * 【查证目标】
 *   - 与地图双击航迹一致 → runGisTrackVerification
 *
 * 【消灭关联】
 *   - AlertPanel「消灭」后若当前选中的是被消灭航迹 → appStore.selectTrack(null)
 *   → 本组件关闭
 */

"use client";

import { cn } from "@/lib/utils";
import { runGisTrackVerification } from "@/lib/run-gis-track-verification";
import {
  buildAssetSymbolDataUrl,
  assetFriendlyColorFromProperties,
  resolveTrackPointFill,
} from "@/lib/map-icons";
import { resolveTrackMapHighlightFill } from "@/lib/track-map-highlight-color";
import { useTrackMarkerSymbolUrl } from "@/components/military/TrackMarkerIcon";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/theme-colors";
import {
  isVirtualFromProperties,
  normalizeAssetType,
  trackMapDisplayId,
  trackTargetIdDisplay,
  type AssetStatus,
  type Track,
} from "@/lib/map-entity-model";
import { dispositionFromAssetData, getTrackRenderingConfig, getAssetFriendlyColorForAssetType, formatCameraTowerMapLabel, formatTowerMapLabel } from "@/lib/map-app-config";
import { formatTrackUnitTypeZh } from "@/lib/track-category-id-parse";
import { useAssetStore } from "@/stores/asset-store";
import {
  useTrackStore,
  getTrackDispositionForRendering,
} from "@/stores/track-store";
import { formatTrackSpeed } from "@/lib/track-speed-format";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export type PlacardKind = "track" | "asset";

export interface TargetPlacardProps {
  kind: PlacardKind;
  id: string;
  onClose: () => void;
  className?: string;
}

function formatLatLng(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return "-";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lng).toFixed(4)}°${ew}`;
}

/** epoch ms 或 ISO 字符串 → 本地 HH:MM:SS.mmm；无效返回 "-"。 */
function formatClockMs(input: number | string | null | undefined): string {
  if (input == null) return "-";
  let ms: number;
  if (typeof input === "number") {
    ms = input;
  } else {
    const p = Date.parse(input);
    if (!Number.isFinite(p)) return String(input) || "-";
    ms = p;
  }
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const d = new Date(ms);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function DispositionBadge({ d }: { d: ForceDisposition }) {
  const label: Record<ForceDisposition, string> = {
    friendly: "友方",
    neutral: "中立",
    hostile: "敌方",
  };
  const color = FORCE_COLORS[d] ?? "#a1a1aa";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-nexus-text-secondary"
      title={d}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label[d] ?? d}
    </span>
  );
}

function SectionTitle({ children, accent }: { children: string; accent?: boolean }) {
  return (
    <div className="mt-2 flex items-center justify-between">
      <div
        className={cn(
          "text-[10px] font-semibold tracking-wider",
          accent ? "text-[#c9a835]" : "text-nexus-text-muted",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Row({ k, v, nowrap, labelWide }: { k: string; v: React.ReactNode; nowrap?: boolean; labelWide?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-x-2 gap-y-1 text-[11px]",
        labelWide ? "grid-cols-[5.5rem_1fr]" : "grid-cols-[56px_1fr]",
      )}
    >
      <div className="text-nexus-text-muted">{k}</div>
      <div className={cn("min-w-0 text-nexus-text-primary", nowrap && "whitespace-nowrap")}>{v}</div>
    </div>
  );
}

export function TargetPlacard(props: TargetPlacardProps) {
  const { kind, id, onClose, className } = props;

  const allAssets = useAssetStore((s) => s.assets);
  const track = useTrackStore((s) => s.tracks.find((t) => t.id === id)) as Track | undefined;

  const asset = allAssets.find((a) => a.id === id);
  // console.log("[TargetPlacard] id=", id, "kind=", kind, "asset=", asset ? { id: asset.id, asset_type: asset.asset_type, name: asset.name } : null, "allAssetIds=", allAssets.map(a => `${a.id}(${a.asset_type})`));
  const [verifyLoading, setVerifyLoading] = useState(false);

  /* 目标丢失时自动关闭属性框 */
  useEffect(() => {
    if (kind === "track" && !track) onClose();
    if (kind === "asset" && !asset) onClose();
  }, [kind, track, asset, onClose]);

  /** 航迹：TargetObject.name（trackAlias）；资产：机场/光电等既有解析 */
  const mapDisplayName = useMemo(() => {
    if (kind === "track") return track ? trackMapDisplayId(track) : id;
    if (!asset) return id;
    const t = normalizeAssetType(asset.asset_type);
    if (t === "camera") return formatCameraTowerMapLabel(asset.id);
    if (t === "tower") return formatTowerMapLabel(asset.id);
    return asset.name;
  }, [kind, track, asset, id]);

  const title = mapDisplayName;
  const subtitle = kind === "track" ? "航迹" : "资产";
  const trackTypeZh = kind === "track" && track ? formatTrackUnitTypeZh(track) : "-";
  const trackTargetId = kind === "track" && track ? trackTargetIdDisplay(track) : id;

  const trackSymbolUrl = useTrackMarkerSymbolUrl(kind === "track" ? track : null);

  const trackDispBadge = kind === "track" && track ? getTrackDispositionForRendering(track) : null;

  const [assetIconLoaded, setAssetIconLoaded] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    if (kind !== "asset") return;
    if (!asset) return;
    let cancelled = false;
    const aid = asset.id;
    const t = normalizeAssetType(asset.asset_type);
    const assetFriendlyTint =
      assetFriendlyColorFromProperties(asset.properties as Record<string, unknown> | null) ??
      getAssetFriendlyColorForAssetType(t) ??
      FORCE_COLORS.friendly;
    void buildAssetSymbolDataUrl(
      t,
      asset.status as AssetStatus,
      isVirtualFromProperties(asset.properties),
      dispositionFromAssetData(asset),
      undefined,
      assetFriendlyTint,
    ).then((url) => {
      if (!cancelled) setAssetIconLoaded({ id: aid, url });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, asset, id]);

  const symbolUrl =
    kind === "track"
      ? trackSymbolUrl
      : kind === "asset" && assetIconLoaded?.id === (asset?.id ?? id)
        ? assetIconLoaded.url
        : null;

  const handleVerifyTarget = useCallback(async () => {
    if (kind !== "track" || !track) return;
    setVerifyLoading(true);
    try {
      await runGisTrackVerification(track);
    } catch (e) {
      console.error("[TargetPlacard] 查证目标失败", e);
      const msg = e instanceof Error ? e.message : "查证失败，请稍后重试";
      toast.error("查证目标失败", { description: msg });
    } finally {
      setVerifyLoading(false);
    }
  }, [kind, track]);

  const headerColor = (() => {
    if (kind !== "track" || !track) {
      return assetFriendlyColorFromProperties(asset?.properties as Record<string, unknown> | null) ??
        (asset?.asset_type ? getAssetFriendlyColorForAssetType(normalizeAssetType(asset.asset_type)) : null) ??
        FORCE_COLORS.friendly;
    }
    const eff = getTrackDispositionForRendering(track);
    const tr = getTrackRenderingConfig();
    const ts = tr.trackTypeStyles[track.type] ?? tr.trackTypeStyles.sea;
    const friendlyFill = eff === "friendly" ? ts.idColor : undefined;
    const baseFill = resolveTrackPointFill(track, eff, null, friendlyFill);
    return resolveTrackMapHighlightFill(track, baseFill);
  })();

  return (
    <div
      className={cn(
        "pointer-events-auto w-[300px] rounded-xl border border-white/10 bg-[#0c0c0e]/95 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.72)] backdrop-blur-md",
        className,
      )}
      role="dialog"
      aria-label="目标信息"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5"
            style={{ boxShadow: `0 0 0 3px rgba(255,255,255,0.04), 0 0 0 1px ${headerColor}40 inset` }}
          >
            {symbolUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={symbolUrl} alt="symbol" className="h-7 w-7" />
            ) : (
              <div className="h-7 w-7 rounded-md bg-white/5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-xs font-semibold text-nexus-text-primary">
                {title}
              </div>
              {kind === "track" && trackDispBadge && (
                <DispositionBadge d={trackDispBadge} />
              )}
              {kind === "track" && track && (
                <span className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  track.type === "air"
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                )}>
                  {track.type === "air" ? "对空" : "对海"}
                </span>
              )}
              {kind === "asset" && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-nexus-text-muted">
                  {subtitle}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
              {kind === "track" ? (
                <span>
                  <span className="text-nexus-text-secondary">target_id:</span> {trackTargetId}
                  {track?.trackId && track.trackId !== trackTargetId && (
                    <span className="ml-2"><span className="text-nexus-text-secondary">trackId:</span> {track.trackId}</span>
                  )}
                </span>
              ) : id}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-nexus-text-secondary hover:bg-white/5 hover:text-nexus-text-primary"
          aria-label="关闭"
          title="关闭"
        >
          ×
        </button>
      </div>

      {kind === "track" ? (
        <>
          <SectionTitle accent>概况</SectionTitle>
          <div className="mt-1 flex flex-col gap-y-1.5">
            <Row k="名称" v={track ? trackMapDisplayId(track) : "-"} />
            <Row k="类型" v={trackTypeZh} />
            <Row k="来源" v={track?.sensor ?? "-"} />
            <Row k="坐标" v={formatLatLng(track?.lat, track?.lng)} />
          </div>

          <SectionTitle accent>时间</SectionTitle>
          <div className="mt-1 flex flex-col gap-y-1.5">
            <Row labelWide k="航迹创建" nowrap v={formatClockMs(track?.trackCreatedMs)} />
            <Row labelWide k="航迹接收" nowrap v={formatClockMs(track?.trackSourceRecvMs)} />
            <Row labelWide k="航迹发送" nowrap v={formatClockMs(track?.trackGrpcSendMs)} />
            <Row labelWide k="后端接收" nowrap v={formatClockMs(track?.backendRecvMs)} />
            <Row labelWide k="前端接收" nowrap v={formatClockMs(track?.wsRecvMs)} />
          </div>

          <SectionTitle accent>运动</SectionTitle>
          <div className="mt-1 flex flex-col gap-y-1.5">
            <Row k="航速" nowrap v={track ? formatTrackSpeed(track.speed) : "-"} />
            <Row
              k="航向"
              nowrap
              v={
                track
                  ? (() => {
                      const brg = track.course ?? track.heading;
                      return Number.isFinite(brg) ? `${Number(brg).toFixed(1)}°` : "-";
                    })()
                  : "-"
              }
            />
            <Row k="高度" nowrap v={track?.altitude != null ? `${track.altitude.toFixed(1)} m` : "-"} />
          </div>

          <SectionTitle accent>查证</SectionTitle>
          <div className="mt-1">
            <button
              type="button"
              disabled={verifyLoading}
              onClick={() => void handleVerifyTarget()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyLoading ? <Loader2 size={12} className="animate-spin" /> : null}
              查证目标
            </button>
          </div>
        </>
      ) : (
        <>
          <SectionTitle accent>概况</SectionTitle>
          <div className="mt-1 space-y-1.5">
            <Row k="状态" v={asset?.status ?? "-"} />
            <Row k="类型" v={asset?.asset_type ?? "-"} />
            <Row k="坐标" v={formatLatLng(asset?.lat, asset?.lng)} />
            <Row k="射程" v={asset?.range_km ? `${asset.range_km} km` : "-"} />
            <Row k="任务状态" v={asset?.mission_status ?? "-"} />
            <Row k="更新时间" v={asset?.updated_at ?? "-"} />
          </div>
        </>
      )}
    </div>
  );
}

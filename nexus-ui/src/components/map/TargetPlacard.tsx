/**
 * TargetPlacard — 目标属性卡片（航迹/资产选中时弹出）
 *
 * 【数据流】
 *   - 选中航迹/资产 → appStore.selectedTrackId / selectedAssetId
 *   → 本组件从 track-store / asset-store 取数据 → 展示属性
 *
 * 【一键处置】
 *   - 点击「一键处置」按钮 → buildTargetInfoFromTrack 构建请求体
 *   → fetchDisposalPlansHttp POST disposalManualGeneratePlanUrl
 *   → disposalPlanStore.appendFromNormalized(_, "http")
 *   → DisposalPlanFeed 展示方案卡片
 *
 * 【消灭关联】
 *   - AlertPanel「消灭」后若当前选中的是被消灭航迹 → appStore.selectTrack(null)
 *   → 本组件关闭
 */

"use client";

import { cn } from "@/lib/utils";
import { useAppConfigStore } from "@/stores/app-config-store";
import { buildTargetInfoFromTrack } from "@/lib/disposal/target-info-from-track";
import { fetchDisposalPlansHttp } from "@/lib/disposal/disposal-api";
import { useAppStore } from "@/stores/app-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { buildAssetSymbolDataUrl, buildMarkerSymbolDataUrl, assetFriendlyColorFromProperties, getFusionTrackMarkerFill, resolveTrackPointFill } from "@/lib/map-icons";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/theme-colors";
import { isVirtualFromProperties, normalizeAssetType, type AssetStatus, type Track } from "@/lib/map-entity-model";
import { dispositionFromAssetData, getTrackRenderingConfig, getAssetFriendlyColorForAssetType, formatCameraTowerMapLabel, formatTowerMapLabel } from "@/lib/map-app-config";
import { useAlertStore } from "@/stores/alert-store";
import { useAssetStore } from "@/stores/asset-store";
import { useTrackStore, isTrackMatchedByAlarm, getEffectiveTrackDisposition } from "@/stores/track-store";
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

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mt-2 flex items-center justify-between">
      <div className="text-[10px] font-semibold tracking-wider text-nexus-text-muted">
        {children}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[78px_1fr] gap-x-3 gap-y-1 text-[11px]">
      <div className="text-nexus-text-muted">{k}</div>
      <div className="min-w-0 text-nexus-text-primary">{v}</div>
    </div>
  );
}

export function TargetPlacard(props: TargetPlacardProps) {
  const { kind, id, onClose, className } = props;

  const allAssets = useAssetStore((s) => s.assets);
  const track = useTrackStore((s) => s.tracks.find((t) => t.id === id)) as Track | undefined;

  const asset = allAssets.find((a) => a.id === id);
  // console.log("[TargetPlacard] id=", id, "kind=", kind, "asset=", asset ? { id: asset.id, asset_type: asset.asset_type, name: asset.name } : null, "allAssetIds=", allAssets.map(a => `${a.id}(${a.asset_type})`));
  const alerts = useAlertStore((s) => s.alerts);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const appendDisposalFromHttp = useDisposalPlanStore((s) => s.appendFromNormalized);
  const [oneClickLoading, setOneClickLoading] = useState(false);

  /* 目标丢失时自动关闭属性框 */
  useEffect(() => {
    if (kind === "track" && !track) onClose();
    if (kind === "asset" && !asset) onClose();
  }, [kind, track, asset, onClose]);

  /** 构建告警 trackId 集合，复用 isTrackMatchedByAlarm 逻辑匹配 */
  const relatedAlerts = useMemo(() => {
    if (kind !== "track" || !track) return [];
    const alarmTrackIds = new Set<string>();
    for (const a of alerts) {
      if (a.trackId) alarmTrackIds.add(a.trackId);
    }
    return alerts
      .filter((a) => a.trackId && isTrackMatchedByAlarm(track, new Set([a.trackId])))
      .slice(0, 5);
  }, [alerts, track, kind]);

  /** 机场/无人机的 name 在入资产时已解析好，直接用 */
  const mapDisplayName = useMemo(() => {
    if (kind === "track") return track?.name ?? id;
    if (!asset) return id;
    const t = normalizeAssetType(asset.asset_type);
    if (t === "camera") return formatCameraTowerMapLabel(asset.id);
    if (t === "tower") return formatTowerMapLabel(asset.id);
    return asset.name;
  }, [kind, track, asset, id]);

  const title = mapDisplayName;
  const subtitle = kind === "track" ? "航迹" : "资产";

  const trackSymbolUrl = useMemo(() => {
    if (kind !== "track" || !track) return null;
    const tr = getTrackRenderingConfig();
    const ts = tr.trackTypeStyles[track.type] ?? tr.trackTypeStyles.sea;
    const eff = getEffectiveTrackDisposition(track);
    const friendlyFill = eff === "friendly" ? ts.idColor : undefined;
    return buildMarkerSymbolDataUrl(
      track.type,
      eff,
      undefined,
      track.isVirtual === true,
      friendlyFill,
      eff === "neutral" ? getFusionTrackMarkerFill(track) : undefined,
    );
  }, [kind, track]);

  const trackDispBadge = kind === "track" && track ? getEffectiveTrackDisposition(track) : null;

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

  const handleOneClickDisposal = useCallback(async () => {
    if (kind !== "track" || !track) return;
    await useAppConfigStore.getState().ensureLoaded();
    setOneClickLoading(true);
    try {
      const targetInfo = buildTargetInfoFromTrack(track);
      const normalized = await fetchDisposalPlansHttp({ targetInfo });
      if (!normalized?.items?.length) {
        console.warn("[TargetPlacard] 响应中未解析到处置方案");
        return;
      }
      appendDisposalFromHttp(normalized, "http");
      if (!rightSidebarOpen) toggleRightSidebar();
      setRightPanelTab("chat");
    } catch (e) {
      console.error("[TargetPlacard] 一键处置失败", e);
      const msg = e instanceof Error ? e.message : "网络不通畅，请检查网络后重试";
      toast.error("一键处置失败", { description: msg });
    } finally {
      setOneClickLoading(false);
    }
  }, [
    kind,
    track,
    appendDisposalFromHttp,
    setRightPanelTab,
    toggleRightSidebar,
    rightSidebarOpen,
  ]);

  const headerColor = (() => {
    if (kind !== "track" || !track) {
      return assetFriendlyColorFromProperties(asset?.properties as Record<string, unknown> | null) ??
        (asset?.asset_type ? getAssetFriendlyColorForAssetType(normalizeAssetType(asset.asset_type)) : null) ??
        FORCE_COLORS.friendly;
    }
    const eff = getEffectiveTrackDisposition(track);
    const tr = getTrackRenderingConfig();
    const ts = tr.trackTypeStyles[track.type] ?? tr.trackTypeStyles.sea;
    const friendlyFill = eff === "friendly" ? ts.idColor : undefined;
    return resolveTrackPointFill(track, eff, null, friendlyFill);
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
                  <span className="text-nexus-text-secondary">showID:</span> {track?.showID ?? id}
                  {track?.trackId && track.trackId !== track.showID && (
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
          <SectionTitle>概况</SectionTitle>
          <div className="mt-1 flex flex-col gap-y-1.5">
            <Row k="来源" v={track?.sensor ?? "-"} />
            <Row k="最后更新" v={track?.lastUpdate ?? "-"} />
            <Row k="坐标" v={formatLatLng(track?.lat, track?.lng)} />
          </div>

          <SectionTitle>运动</SectionTitle>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <Row k="航速" v={track ? `${track.speed.toFixed(1)} kn` : "-"} />
            <Row k="航向" v={track ? `${track.heading.toFixed(1)}°` : "-"} />
            <Row k="高度" v={track?.altitude != null ? `${track.altitude.toFixed(1)}` : "-"} />
          </div>

          <SectionTitle>处置</SectionTitle>
          <div className="mt-1">
            <button
              type="button"
              disabled={oneClickLoading}
              onClick={() => void handleOneClickDisposal()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {oneClickLoading ? <Loader2 size={12} className="animate-spin" /> : null}
              一键处置
            </button>
            <p className="mt-1 text-[9px] text-nexus-text-muted">拉取方案并显示在右侧「AI 助手」面板</p>
          </div>

          <SectionTitle>关联告警</SectionTitle>
          <div className="mt-1 space-y-1.5">
            {relatedAlerts.length ? (
              relatedAlerts.map((a) => {
                const sevColor =
                  a.severity === "critical"
                    ? "text-red-400"
                    : a.severity === "warning"
                      ? "text-amber-400"
                      : "text-zinc-400";
                const sevLabel =
                  a.severity === "critical"
                    ? "严重"
                    : a.severity === "warning"
                      ? "警告"
                      : "信息";
                const sevBorder =
                  a.severity === "critical"
                    ? "border-l-2 border-l-red-500/60"
                    : a.severity === "warning"
                      ? "border-l-2 border-l-amber-500/60"
                      : "border-l-2 border-l-zinc-500/40";
                return (
                  <div
                    key={a.id}
                    className={cn("rounded-lg border border-white/10 bg-white/5 px-2.5 py-2", sevBorder)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-[10px] font-bold", sevColor)}>{sevLabel}</span>
                        {a.alarmType && (
                          <span className="rounded bg-white/5 px-1 text-[9px] text-nexus-text-muted">
                            {a.alarmType === "threat" ? "威胁" : "告警"}
                          </span>
                        )}
                        {a.alarmLevel != null && (
                          <span className="text-[10px] text-nexus-text-muted">Lv.{a.alarmLevel}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-nexus-text-muted">{a.timestamp}</div>
                    </div>
                    {/* {a.title && (
                      <div className="mt-1 text-[11px] font-medium text-nexus-text-primary">{a.title}</div>
                    )} */}
                    {/* <div className={cn("text-[11px] text-nexus-text-primary", a.title ? "mt-0.5" : "mt-1")}>
                      {a.message}
                    </div> */}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-nexus-text-muted">
                      {a.source && <span>来源：{a.source}</span>}
                      {a.areaName && <span>区域：{a.areaName}</span>}
                      {a.lat != null && a.lng != null && Number.isFinite(a.lat) && Number.isFinite(a.lng) && (
                        <span>坐标：{a.lng.toFixed(4)}, {a.lat.toFixed(4)}</span>
                      )}
                      {a.type && <span>类型：{a.type}</span>}
                    </div>
                    {a.detail && (
                      <div className="mt-1 text-[10px] leading-relaxed text-nexus-text-muted">{a.detail}</div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-[11px] text-nexus-text-muted">暂无关联告警</div>
            )}
          </div>
        </>
      ) : (
        <>
          <SectionTitle>概况</SectionTitle>
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

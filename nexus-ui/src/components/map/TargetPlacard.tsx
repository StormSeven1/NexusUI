"use client";

import { cn } from "@/lib/utils";
import { useAppConfigStore } from "@/stores/app-config-store";
import { buildTargetInfoFromTrack } from "@/lib/disposal/target-info-from-track";
import { fetchDisposalPlansHttp } from "@/lib/disposal/disposal-api";
import { useAppStore } from "@/stores/app-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import {
  buildAssetSymbolDataUrl,
  buildMarkerSymbolDataUrl,
  assetFriendlyColorFromProperties,
  preloadTrackIconFragments,
} from "@/lib/map-icons";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/theme-colors";
import {
  isVirtualFromProperties,
  normalizeAssetType,
  type AssetStatus,
  type PublicMapAssetType,
  type Track,
} from "@/lib/map-entity-model";
import {
  dispositionFromAssetData,
  findAssetInStore,
  formatAssetDeviceStateDisplay,
  formatIsoToSecond,
  getTrackRenderingConfig,
  getAssetFriendlyColorForAssetType,
  isMunitionAsset,
} from "@/lib/map-app-config";
import { useTrackAliasStore, resolveAliasKey } from "@/stores/track-alias-store";
import { useAssetStore } from "@/stores/asset-store";
import { useTrackStore } from "@/stores/track-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { signalingUrlFromWebrtcUrl } from "@/lib/eo-video/buildSignalingUrl";

export type PlacardKind = "track" | "asset";

export interface TargetPlacardProps {
  kind: PlacardKind;
  id: string;
  onClose: () => void;
  className?: string;
}

type PlacardAlarm = {
  alarm_id: string;
  categories: unknown[];
  level: number;
  area?: {
    name?: string;
  };
};

function formatLatLng(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return "-";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lng).toFixed(4)}°${ew}`;
}

function formatSpeedMps(value: unknown): string {
  const speed = Number(value);
  return Number.isFinite(speed) ? `${speed.toFixed(1)} m/s` : "-";
}

function readSpeedMpsFromRecord(record: Record<string, unknown> | null | undefined): number | null {
  if (!record) return null;
  const horizontalRaw = record.horizontal_speed ?? record.horizontalSpeed;
  const verticalRaw = record.vertical_speed ?? record.verticalSpeed;
  if (horizontalRaw != null || verticalRaw != null) {
    const horizontal = Number(horizontalRaw);
    const vertical = Number(verticalRaw);
    const h = Number.isFinite(horizontal) ? horizontal : 0;
    const v = Number.isFinite(vertical) ? vertical : 0;
    return Math.sqrt(h * h + v * v);
  }
  const speed = Number(record.speed_mps ?? record.speedMps ?? record.speed_ms ?? record.speed);
  if (Number.isFinite(speed)) return speed;
  const northRaw = record.speed_N ?? record.speedN ?? record.north_mps;
  const eastRaw = record.speed__E ?? record.speed_E ?? record.speedE ?? record.east_mps;
  const upRaw = record.speed_V ?? record.speedV ?? record.up_mps;
  if (northRaw == null && eastRaw == null && upRaw == null) return null;
  const north = Number(northRaw);
  const east = Number(eastRaw);
  const up = Number(upRaw);
  const n = Number.isFinite(north) ? north : 0;
  const e = Number.isFinite(east) ? east : 0;
  const u = Number.isFinite(up) ? up : 0;
  return Math.sqrt(n * n + e * e + u * u);
}

function readAssetSpeedMps(properties: Record<string, unknown> | null | undefined): number | null {
  if (!properties) return null;
  const highFreq = properties.high_freq && typeof properties.high_freq === "object"
    ? (properties.high_freq as Record<string, unknown>)
    : null;
  const status = properties.drone_status && typeof properties.drone_status === "object"
    ? (properties.drone_status as Record<string, unknown>)
    : null;
  return readSpeedMpsFromRecord(highFreq) ?? readSpeedMpsFromRecord(status) ?? readSpeedMpsFromRecord(properties);
}

function readHeadingDegrees(asset: AssetData | null, properties: Record<string, unknown> | null | undefined): number | null {
  const heading = Number(
    asset?.heading ??
      properties?.heading ??
      properties?.headingDeg ??
      properties?.attitude_head ??
      properties?.course ??
      properties?.yaw,
  );
  return Number.isFinite(heading) ? heading : null;
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

function assetTypeDisplayLabel(t: PublicMapAssetType | string | undefined): string {
  const n = String(t ?? "").trim().toLowerCase();
  if (n === "usv") return "无人船";
  if (n === "missile") return "飞弹";
  if (n === "drone") return "无人机";
  if (n === "airport") return "机场";
  if (n === "radar") return "雷达";
  if (n === "camera") return "光电";
  if (n === "tower") return "电侦";
  if (n === "laser") return "激光";
  if (n === "tdoa") return "TDOA";
  return n || "资产";
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] gap-x-1.5 text-[11px]">
      <div className="shrink-0 text-nexus-text-muted">{k}</div>
      <div className="min-w-0 text-nexus-text-primary">{v}</div>
    </div>
  );
}

function toPlacardAlarm(value: unknown): PlacardAlarm | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.alarm_id !== "string" || !rec.alarm_id.trim()) return null;
  return {
    alarm_id: rec.alarm_id,
    categories: Array.isArray(rec.categories) ? rec.categories : [],
    level: Number(rec.level ?? -1),
    area:
      rec.area && typeof rec.area === "object" && !Array.isArray(rec.area)
        ? { name: typeof (rec.area as Record<string, unknown>).name === "string" ? String((rec.area as Record<string, unknown>).name) : undefined }
        : undefined,
  };
}

export function TargetPlacard(props: TargetPlacardProps) {
  const { kind, id, onClose, className } = props;

  const allAssets = useAssetStore((s) => s.assets);
  const entityIdToDeviceSn = useAssetStore((s) => s.entityIdToDeviceSn);
  const track = useTrackStore((s) => s.tracks.find((t) => t.id === id)) as Track | undefined;
  const asset = useMemo(
    () => findAssetInStore(allAssets, id, entityIdToDeviceSn),
    [allAssets, id, entityIdToDeviceSn],
  );
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const appendDisposalFromHttp = useDisposalPlanStore((s) => s.appendFromNormalized);
  const [oneClickLoading, setOneClickLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (kind === "track" && !track) onClose();
    if (kind === "asset" && !asset) onClose();
  }, [kind, track, asset, onClose]);

  const assetLat = asset?.lat ?? null;
  const assetLng = asset?.lng ?? null;
  const assetProperties =
    asset?.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const assetVideoUrl =
    assetProperties && typeof assetProperties.sensor_video_url === "string"
      ? assetProperties.sensor_video_url
      : "";
  const assetVideoSourcePath =
    assetProperties && typeof assetProperties.sensor_video_source_path === "string"
      ? assetProperties.sensor_video_source_path
      : "";
  const assetMediaJson = useMemo(() => {
    const mediaObject = assetProperties?.entity_media;
    if (!mediaObject) return "";
    try {
      return JSON.stringify(mediaObject, null, 2);
    } catch {
      return "";
    }
  }, [assetProperties]);
  const assetPlaybackUrl = useMemo(() => {
    if (!assetVideoUrl) return "";
    try {
      if (assetVideoUrl.startsWith("webrtc://")) {
        return signalingUrlFromWebrtcUrl(assetVideoUrl);
      }
      if (assetVideoUrl.includes("/index/api/webrtc")) {
        return assetVideoUrl;
      }
      if (assetVideoUrl.startsWith("rtsp://") || assetVideoUrl.startsWith("rtsps://")) {
        return "当前前端播放器暂不支持直接播放 RTSP";
      }
      return "";
    } catch {
      return "";
    }
  }, [assetVideoUrl]);
  const assetHeading = readHeadingDegrees(asset, assetProperties);
  const assetSpeedMps = readAssetSpeedMps(assetProperties);
  const assetUpdatedAt = asset?.updated_at;
  const assetTypeLabel =
    asset != null
      ? assetTypeDisplayLabel(normalizeAssetType(asset.asset_type))
      : "资产";

  const relatedAlerts = useMemo(() => {
    if (kind !== "track" || !track || !Array.isArray(track.alarms)) return [];
    return track.alarms.map(toPlacardAlarm).filter((item): item is PlacardAlarm => item != null).slice(0, 5);
  }, [track, kind]);

  const isMunition = kind === "asset" && isMunitionAsset(asset);
  const subtitle = kind === "track" ? "航迹" : assetTypeLabel;
  const titleText = useMemo(() => {
    if (kind === "track") {
      const key = track ? resolveAliasKey(track) : null;
      const alias = key ? useTrackAliasStore.getState().getOrCreate(key) : "";
      return alias || track?.name || track?.targetID || id;
    }
    return asset?.name || id;
  }, [kind, track, id, asset?.name]);

  const [trackSymbolUrl, setTrackSymbolUrl] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "track" || !track) {
      setTrackSymbolUrl(null);
      return;
    }
    let cancelled = false;
    const tr = getTrackRenderingConfig();
    const ts = tr.trackTypeStyles[track.type] ?? tr.trackTypeStyles.sea;
    const friendlyFill = track.disposition === "friendly" ? ts.idColor : undefined;
    const build = () =>
      buildMarkerSymbolDataUrl(track.type, track.disposition, undefined, track.isVirtual === true, friendlyFill);
    void preloadTrackIconFragments().then(() => {
      if (!cancelled) setTrackSymbolUrl(build());
    });
    return () => {
      cancelled = true;
    };
  }, [kind, track]);

  const [assetIconLoaded, setAssetIconLoaded] = useState<{ id: string; url: string } | null>(null);
  const assetIconType = asset ? normalizeAssetType(asset.asset_type) : null;
  const assetIconStatus = (asset?.status ?? "online") as AssetStatus;
  const assetIconVirtual = isVirtualFromProperties(asset?.properties);
  const assetIconDisposition = asset ? dispositionFromAssetData(asset) : "friendly";
  const assetIconFriendlyTint =
    assetFriendlyColorFromProperties(asset?.properties as Record<string, unknown> | null) ??
    (assetIconType ? getAssetFriendlyColorForAssetType(assetIconType) : null) ??
    FORCE_COLORS.friendly;

  useEffect(() => {
    if (kind !== "asset" || !assetIconType) {
      setAssetIconLoaded(null);
      return;
    }
    let cancelled = false;
    const aid = id;
    void buildAssetSymbolDataUrl(
      assetIconType,
      assetIconStatus,
      assetIconVirtual,
      assetIconDisposition,
      undefined,
      assetIconFriendlyTint,
    ).then((url) => {
      if (cancelled) return;
      setAssetIconLoaded((prev) => (prev?.id === aid && prev.url === url ? prev : { id: aid, url }));
    });
    return () => {
      cancelled = true;
    };
  }, [kind, id, assetIconType, assetIconStatus, assetIconVirtual, assetIconDisposition, assetIconFriendlyTint]);

  const symbolUrl =
    kind === "track"
      ? trackSymbolUrl
      : kind === "asset" && assetIconLoaded?.id === id
        ? assetIconLoaded.url
        : null;

  const handleOneClickDisposal = useCallback(async () => {
    if (kind !== "track" || !track) return;
    await useAppConfigStore.getState().ensureLoaded();
    setOneClickLoading(true);
    try {
      const targetInfo = buildTargetInfoFromTrack(track);
      const normalized = await fetchDisposalPlansHttp({ targetInfo });
      if (!normalized?.items?.length) return;
      appendDisposalFromHttp(normalized, "http");
      if (!rightSidebarOpen) toggleRightSidebar();
      setRightPanelTab("taskPanel");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络不通畅，请检查网络后重试";
      toast.error("一键处置失败", { description: msg });
    } finally {
      setOneClickLoading(false);
    }
  }, [kind, track, appendDisposalFromHttp, setRightPanelTab, toggleRightSidebar, rightSidebarOpen]);

  const headerColor =
    kind === "track"
      ? track
        ? (FORCE_COLORS[track.disposition] ?? "#a1a1aa")
        : "#a1a1aa"
      : assetFriendlyColorFromProperties(asset?.properties as Record<string, unknown> | null) ??
        (asset?.asset_type ? getAssetFriendlyColorForAssetType(normalizeAssetType(asset.asset_type)) : null) ??
        FORCE_COLORS.friendly;

  return (
    <div
      className={cn(
        "pointer-events-auto w-[200px] rounded-xl border border-white/10 bg-[#0c0c0e]/95 p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.72)] backdrop-blur-md",
        className,
      )}
      role="dialog"
      aria-label="目标信息"
    >
      <div className="mb-1.5 flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5"
            style={{ boxShadow: `0 0 0 1px ${headerColor}40 inset` }}
          >
            {symbolUrl ? (
              <img src={symbolUrl} alt="symbol" className="h-4 w-4" />
            ) : (
              <div className="h-4 w-4 rounded bg-white/5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-bold text-nexus-text-primary">{titleText}</div>
            <div className="flex items-center gap-1">
              {kind === "track" && track?.disposition && <DispositionBadge d={track.disposition} />}
              {kind === "track" && track && (
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold",
                    track.type === "air"
                      ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                  )}
                >
                  {track.type === "air" ? "对空" : "对海"}
                </span>
              )}
              {kind === "asset" && (
                <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-semibold text-nexus-text-muted">
                  {subtitle}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="shrink-0 rounded px-1 py-0.5 text-[10px] text-nexus-text-secondary hover:bg-white/5 hover:text-nexus-text-primary"
          aria-label="关闭"
          title="关闭"
        >
          ×
        </button>
      </div>

      {kind === "track" ? (
        <>
          <div className="mt-1 flex flex-col gap-y-1">
            <Row k="坐标" v={formatLatLng(track?.lat, track?.lng)} />
            <Row k="航速" v={track ? formatSpeedMps(track.speed) : "-"} />
            <Row k="航向" v={track && typeof track.course === "number" ? `${track.course.toFixed(1)}°` : "-"} />
          </div>

          <div className="mt-2">
            <button
              type="button"
              disabled={oneClickLoading}
              onClick={() => void handleOneClickDisposal()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 py-1.5 text-[10px] font-semibold text-sky-300 transition hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {oneClickLoading ? <Loader2 size={11} className="animate-spin" /> : null}
              一键处置
            </button>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 py-0.5 text-[9px] text-nexus-text-secondary transition-colors hover:bg-white/10 hover:text-nexus-text-primary"
          >
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? "收起详情" : "展开详情"}
          </button>

          {expanded && (
            <>
              <div className="mt-1 flex flex-col gap-y-1">
                {track?.targetID && <Row k="targetID" v={track.targetID} />}
                {track?.external_target_id && <Row k="external_target_id" v={track.external_target_id} />}
                <Row k="来源" v={track?.sensor ?? "-"} />
                <Row k="最后更新" v={track?.lastUpdate ?? "-"} />
                <Row k="高度" v={track?.altitude != null ? `${track.altitude.toFixed(1)}` : "-"} />
              </div>

              <div className="mt-1 space-y-2">
                {relatedAlerts.length ? (
                  relatedAlerts.map((alarm) => {
                    const sevColor =
                      alarm.level >= 2
                        ? "text-red-400"
                        : alarm.level >= 0
                          ? "text-amber-400"
                          : "text-zinc-400";
                    const sevLabel = alarm.level >= 2 ? "严重" : alarm.level >= 0 ? "告警" : "";
                    const category =
                      alarm.categories.length > 0 ? String(alarm.categories[0]) : "告警";
                    return (
                      <div
                        key={alarm.alarm_id}
                        className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[9px]"
                      >
                        {sevLabel && <span className={cn("font-bold", sevColor)}>{sevLabel}</span>}
                        <span className="text-nexus-text-muted">{category}</span>
                        {Number.isFinite(alarm.level) && (
                          <span className="text-nexus-text-muted">Lv.{alarm.level}</span>
                        )}
                        {alarm.area?.name && (
                          <span className="truncate text-nexus-text-muted">{alarm.area.name}</span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-[9px] text-nexus-text-muted">暂无</div>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mt-1 space-y-1">
            <Row k="坐标" v={formatLatLng(assetLat, assetLng)} />
            <Row k="状态" v={formatAssetDeviceStateDisplay(asset)} />
            <Row k="更新时间" v={formatIsoToSecond(assetUpdatedAt)} />
            {normalizeAssetType(asset?.asset_type) === "drone" ? <Row k="速度" v={formatSpeedMps(assetSpeedMps)} /> : null}
            {assetHeading != null ? <Row k="航向" v={`${assetHeading.toFixed(1)}°`} /> : null}
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 py-0.5 text-[9px] text-nexus-text-secondary transition-colors hover:bg-white/10 hover:text-nexus-text-primary"
          >
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? "收起详情" : "展开详情"}
          </button>

          {expanded && (
            <div className="mt-1 space-y-1">
              <Row k="类型" v={assetTypeLabel} />
              <Row k="entityId" v={asset?.id ?? "-"} />
              {!isMunition ? <Row k="射程" v={asset?.range_km ? `${asset.range_km} km` : "-"} /> : null}
              <Row k="任务状态" v={asset?.mission_status ?? "-"} />
              <Row k="取流字段" v={assetVideoSourcePath || "-"} />
              <Row
                k="原始流"
                v={
                  assetVideoUrl ? (
                    <span className="block break-all text-[10px] leading-4 text-nexus-text-primary">
                      {assetVideoUrl}
                    </span>
                  ) : (
                    "-"
                  )
                }
              />
              <Row
                k="播放流"
                v={
                  assetPlaybackUrl ? (
                    <span className="block break-all text-[10px] leading-4 text-nexus-text-primary">
                      {assetPlaybackUrl}
                    </span>
                  ) : (
                    "-"
                  )
                }
              />
              <Row
                k="Media"
                v={
                  assetMediaJson ? (
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-1 text-[9px] leading-4 text-nexus-text-primary">
                      {assetMediaJson}
                    </pre>
                  ) : (
                    "-"
                  )
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}


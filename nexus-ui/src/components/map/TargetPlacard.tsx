"use client";

import { cn } from "@/lib/utils";
import { buildAssetSymbolDataUrl, buildMarkerSymbolDataUrl } from "@/lib/map-symbols";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/colors";
import { MOCK_TRACKS, type Track } from "@/lib/mock-data";
import { useAlertStore } from "@/stores/alert-store";
import { useAssetStore } from "@/stores/asset-store";
import { useTrackStore } from "@/stores/track-store";
import { useMemo, useState } from "react";

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

function kvEntries(obj: Record<string, unknown> | null | undefined) {
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 40);
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
  const [showAllProps, setShowAllProps] = useState(false);

  const track = useTrackStore((s) => s.tracks.find((t) => t.id === id)) as Track | undefined;
  const trackFallback = useMemo(
    () => (track ? undefined : MOCK_TRACKS.find((t) => t.id === id)),
    [id, track],
  );
  const t = track ?? trackFallback;

  const asset = useAssetStore((s) => s.assets.find((a) => a.id === id));
  const alerts = useAlertStore((s) => s.alerts);

  const relatedAlerts = useMemo(() => {
    if (kind !== "track") return [];
    return alerts.filter((a) => a.trackId === id).slice(0, 5);
  }, [alerts, id, kind]);

  const title = kind === "track" ? (t?.name ?? id) : (asset?.name ?? id);
  const subtitle = kind === "track" ? "目标航迹" : "资产";

  const symbolUrl = useMemo(() => {
    if (kind === "track") {
      if (!t) return null;
      return buildMarkerSymbolDataUrl(t.type, t.disposition);
    }
    if (!asset) return null;
    return buildAssetSymbolDataUrl(asset.asset_type as never, asset.status as never);
  }, [asset, kind, t]);

  const headerColor = kind === "track"
    ? (t ? (FORCE_COLORS[t.disposition] ?? "#a1a1aa") : "#a1a1aa")
    : "#6ee7b7";

  const propEntries = useMemo(() => {
    if (kind !== "asset") return [];
    const entries = kvEntries(asset?.properties ?? null);
    return showAllProps ? entries : entries.slice(0, 12);
  }, [asset?.properties, kind, showAllProps]);

  return (
    <div
      className={cn(
        "pointer-events-auto w-[320px] rounded-xl border border-white/10 bg-[#0c0c0e]/95 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.72)] backdrop-blur-md",
        className,
      )}
      role="dialog"
      aria-label="目标标牌"
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
              {kind === "track" && t?.disposition && (
                <DispositionBadge d={t.disposition} />
              )}
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-nexus-text-muted">
                {subtitle}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-nexus-text-muted">
              {id}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-nexus-text-secondary hover:bg-white/5 hover:text-nexus-text-primary"
          aria-label="关闭标牌"
          title="关闭"
        >
          ×
        </button>
      </div>

      {kind === "track" ? (
        <>
          <SectionTitle>发现信息</SectionTitle>
          <div className="mt-1 space-y-1.5">
            <Row k="发现来源" v={t?.sensor ?? "-"} />
            <Row k="发现时间" v={t?.lastUpdate ?? "-"} />
            <Row k="位置" v={formatLatLng(t?.lat, t?.lng)} />
          </div>

          <SectionTitle>运动属性</SectionTitle>
          <div className="mt-1 space-y-1.5">
            <Row k="速度" v={t ? `${t.speed} kn` : "-"} />
            <Row k="航向" v={t ? `${t.heading}°` : "-"} />
            <Row k="高度" v={t?.altitude != null ? `${t.altitude}` : "-"} />
            <Row k="类型" v={t?.type ?? "-"} />
          </div>

          <SectionTitle>关联告警</SectionTitle>
          <div className="mt-1 space-y-1">
            {relatedAlerts.length ? (
              relatedAlerts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold text-nexus-text-secondary">
                      {a.severity.toUpperCase()}
                    </div>
                    <div className="text-[10px] text-nexus-text-muted">{a.timestamp}</div>
                  </div>
                  <div className="mt-0.5 text-[11px] text-nexus-text-primary">
                    {a.message}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-nexus-text-muted">暂无告警</div>
            )}
          </div>
        </>
      ) : (
        <>
          <SectionTitle>资产信息</SectionTitle>
          <div className="mt-1 space-y-1.5">
            <Row k="状态" v={asset?.status ?? "-"} />
            <Row k="类型" v={asset?.asset_type ?? "-"} />
            <Row k="位置" v={formatLatLng(asset?.lat, asset?.lng)} />
            <Row k="覆盖" v={asset?.range_km ? `${asset.range_km} km` : "-"} />
            <Row k="任务状态" v={asset?.mission_status ?? "-"} />
            <Row k="指派目标" v={asset?.assigned_target_id ?? "-"} />
            <Row k="目标位置" v={formatLatLng(asset?.target_lat, asset?.target_lng)} />
            <Row k="更新时间" v={asset?.updated_at ?? "-"} />
          </div>

          <SectionTitle>扩展属性</SectionTitle>
          <div className="mt-1">
            {propEntries.length ? (
              <>
                <div className="space-y-1.5">
                  {propEntries.map(([k, v]) => (
                    <Row
                      key={k}
                      k={k}
                      v={
                        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                          ? String(v)
                          : (
                            <span className="block truncate text-nexus-text-secondary" title={JSON.stringify(v)}>
                              {JSON.stringify(v)}
                            </span>
                          )
                      }
                    />
                  ))}
                </div>
                {kvEntries(asset?.properties ?? null).length > 12 && (
                  <button
                    onClick={() => setShowAllProps((s) => !s)}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-nexus-text-secondary hover:bg-white/10"
                  >
                    {showAllProps ? "收起属性" : "展开更多属性"}
                  </button>
                )}
              </>
            ) : (
              <div className="text-[11px] text-nexus-text-muted">暂无扩展属性</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


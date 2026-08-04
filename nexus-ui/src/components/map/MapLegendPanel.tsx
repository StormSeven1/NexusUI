"use client";

/**
 * GIS 右下角图例：折叠按钮 → 展开两列
 * - 左：各航迹类型中立色（对空融合拆鸟/无人机）
 * - 右：目标属性高亮色（重点关注/威胁）
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { type TrackLayerKey } from "@/lib/map-entity-model";
import { getTrackLayerKeysOrdered, trackSubtypeLabel } from "@/lib/track-layer-visibility";
import { FORCE_COLORS } from "@/lib/theme-colors";
import { SUSPICIOUS_TRACK_MAP_COLOR } from "@/lib/suspicious-track-constants";
import {
  defaultAirFusionNeutralColors,
  defaultNeutralColorByLayer,
  normalizeCssHexColor,
  useTrackDisplayStore,
} from "@/stores/track-display-store";

type LegendSwatch = { key: string; label: string; color: string };

const ATTR_LEGEND: LegendSwatch[] = [
  { key: "suspicious", label: "重点关注", color: SUSPICIOUS_TRACK_MAP_COLOR },
  { key: "threat", label: "威胁目标", color: FORCE_COLORS.hostile },
];

function SwatchRow({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className="size-2.5 shrink-0 rounded-[2px] border border-white/25 shadow-sm"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="min-w-0 truncate text-[10px] leading-tight text-nexus-text-secondary" title={label}>
        {label}
      </span>
    </div>
  );
}

function buildTrackLegendItems(
  neutralColorByLayer: Record<TrackLayerKey, string>,
  airFusion: { bird: string; uav: string },
): LegendSwatch[] {
  const defaults = defaultNeutralColorByLayer();
  const airDefaults = defaultAirFusionNeutralColors();
  const out: LegendSwatch[] = [];
  for (const key of getTrackLayerKeysOrdered()) {
    if (key === "fuse_air") {
      out.push({
        key: "fuse_air_bird",
        label: "对空融合·鸟",
        color: normalizeCssHexColor(airFusion.bird, airDefaults.bird),
      });
      out.push({
        key: "fuse_air_uav",
        label: "对空融合·无人机",
        color: normalizeCssHexColor(airFusion.uav, airDefaults.uav),
      });
      continue;
    }
    out.push({
      key,
      label: trackSubtypeLabel(key),
      color: normalizeCssHexColor(
        neutralColorByLayer[key] ?? defaults[key] ?? "#94a3b8",
        defaults[key] ?? "#94a3b8",
      ),
    });
  }
  return out;
}

export function MapLegendPanel() {
  const [open, setOpen] = useState(false);
  const neutralColorByLayer = useTrackDisplayStore((s) => s.neutralColorByLayer);
  const airFusionNeutralColorBySubtype = useTrackDisplayStore(
    (s) => s.airFusionNeutralColorBySubtype,
  );

  const trackItems = useMemo(
    () => buildTrackLegendItems(neutralColorByLayer, airFusionNeutralColorBySubtype),
    [neutralColorByLayer, airFusionNeutralColorBySubtype],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-md border border-white/[0.1]",
          "bg-nexus-bg-surface/85 px-2.5 py-1.5 text-[11px] font-medium text-nexus-text-secondary",
          "shadow-lg backdrop-blur-sm transition hover:border-white/20 hover:bg-nexus-bg-elevated/90 hover:text-nexus-text-primary",
        )}
        title="展开图例"
        aria-expanded={false}
      >
        <List className="size-3.5 opacity-80" strokeWidth={2} />
        图例
        <ChevronUp className="size-3 opacity-70" strokeWidth={2} />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "absolute bottom-3 right-3 z-20 w-[min(100%-1.5rem,420px)] overflow-hidden rounded-md",
        "border border-white/[0.1] bg-nexus-bg-surface/90 shadow-xl backdrop-blur-md",
      )}
      role="dialog"
      aria-label="地图图例"
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] px-2.5 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-nexus-text-secondary">图例</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-nexus-text-muted transition hover:bg-white/[0.06] hover:text-nexus-text-primary"
          title="收起图例"
          aria-expanded={true}
        >
          收起
          <ChevronDown className="size-3 opacity-70" strokeWidth={2} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-0">
        <div className="border-r border-white/[0.08] px-2.5 py-2">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            航迹颜色
          </div>
          <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
            {trackItems.map((item) => (
              <SwatchRow key={item.key} label={item.label} color={item.color} />
            ))}
          </div>
        </div>

        <div className="px-2.5 py-2">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            目标属性
          </div>
          <div className="flex flex-col gap-1.5">
            {ATTR_LEGEND.map((item) => (
              <SwatchRow key={item.key} label={item.label} color={item.color} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

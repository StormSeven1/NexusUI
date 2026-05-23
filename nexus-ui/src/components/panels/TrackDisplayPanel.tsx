"use client";

/**
 * 航迹显示：6 类 DDS 航迹各自矢量/尾迹时长；对海/对空融合中立色单独配置。
 */

import { cn } from "@/lib/utils";
import { TRACK_LAYER_KEYS_ORDERED, type TrackLayerKey } from "@/lib/map-entity-model";
import { TRACK_SUBTYPE_LABELS } from "@/lib/track-layer-visibility";
import { useTrackDisplayStore } from "@/stores/track-display-store";
import { Route } from "lucide-react";
import { useMemo, useState } from "react";

export function TrackDisplayPanel() {
  const seaFusionColor = useTrackDisplayStore((s) => s.seaFusionColor);
  const airFusionColor = useTrackDisplayStore((s) => s.airFusionColor);
  const vectorLengthSecondsByLayer = useTrackDisplayStore((s) => s.vectorLengthSecondsByLayer);
  const trailLengthSecondsByLayer = useTrackDisplayStore((s) => s.trailLengthSecondsByLayer);
  const setSeaFusionColor = useTrackDisplayStore((s) => s.setSeaFusionColor);
  const setAirFusionColor = useTrackDisplayStore((s) => s.setAirFusionColor);
  const setVectorLengthSecondsForLayer = useTrackDisplayStore((s) => s.setVectorLengthSecondsForLayer);
  const setTrailLengthSecondsForLayer = useTrackDisplayStore((s) => s.setTrailLengthSecondsForLayer);

  const [selectedLayer, setSelectedLayer] = useState<TrackLayerKey>("fuse_sea");

  const layerTabs = useMemo(
    () =>
      TRACK_LAYER_KEYS_ORDERED.map((id) => ({
        id,
        label: TRACK_SUBTYPE_LABELS[id],
      })),
    [],
  );

  const currentVectorLengthSeconds = vectorLengthSecondsByLayer[selectedLayer] ?? 60;
  const currentTrailLengthSeconds = trailLengthSecondsByLayer[selectedLayer] ?? 600;
  const showFusionColor = selectedLayer === "fuse_sea" || selectedLayer === "fuse_air";
  const currentColor = selectedLayer === "fuse_air" ? airFusionColor : seaFusionColor;
  const setCurrentColor = selectedLayer === "fuse_air" ? setAirFusionColor : setSeaFusionColor;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center gap-2">
          <Route size={16} className="text-nexus-text-muted" />
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            航迹显示
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-nexus-text-muted">
          选择航迹类型后分别调整矢量与尾迹；融合航迹可改中立色。
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            航迹类型
          </div>
          <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto pr-0.5">
            {layerTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedLayer(tab.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                  selectedLayer === tab.id
                    ? "border-nexus-border-accent bg-nexus-accent-glow/15 text-nexus-text-primary"
                    : "border-nexus-border bg-nexus-bg-surface/80 text-nexus-text-muted hover:bg-nexus-bg-elevated/60",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {showFusionColor ? (
          <div>
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
              融合中立色（{TRACK_SUBTYPE_LABELS[selectedLayer]}）
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-nexus-border bg-nexus-bg-surface"
                aria-label="航迹颜色"
              />
              <input
                type="text"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 font-mono text-[11px] text-nexus-text-primary"
                spellCheck={false}
              />
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
              矢量长度
            </span>
            <span className="text-[11px] tabular-nums text-nexus-text-secondary">
              {currentVectorLengthSeconds}s
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={300}
            step={1}
            value={currentVectorLengthSeconds}
            onChange={(e) => setVectorLengthSecondsForLayer(selectedLayer, Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="mt-0.5 flex justify-between text-[9px] text-nexus-text-muted">
            <span>1s</span>
            <span>300s</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
              尾迹长度
            </span>
            <span className="text-[11px] tabular-nums text-nexus-text-secondary">
              {currentTrailLengthSeconds}s
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={1800}
            step={1}
            value={currentTrailLengthSeconds}
            onChange={(e) => setTrailLengthSecondsForLayer(selectedLayer, Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="mt-0.5 flex justify-between text-[9px] text-nexus-text-muted">
            <span>1s</span>
            <span>1800s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

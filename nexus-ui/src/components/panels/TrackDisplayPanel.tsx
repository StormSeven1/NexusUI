"use client";

/**
 * 航迹显示：对海/对空融合配色、速度矢量时长、尾迹展示时长（与 GIS 航迹层联动，见 track-display-store + tracks-maplibre）。
 */

import { cn } from "@/lib/utils";
import {
  useTrackDisplayStore,
  type TrackFusionKindUi,
} from "@/stores/track-display-store";
import { Route } from "lucide-react";
import { useMemo, useState } from "react";

export function TrackDisplayPanel() {
  const seaFusionColor = useTrackDisplayStore((s) => s.seaFusionColor);
  const airFusionColor = useTrackDisplayStore((s) => s.airFusionColor);
  const vectorLengthSecondsSea = useTrackDisplayStore((s) => s.vectorLengthSecondsSea);
  const vectorLengthSecondsAir = useTrackDisplayStore((s) => s.vectorLengthSecondsAir);
  const trailLengthSecondsSea = useTrackDisplayStore((s) => s.trailLengthSecondsSea);
  const trailLengthSecondsAir = useTrackDisplayStore((s) => s.trailLengthSecondsAir);
  const setSeaFusionColor = useTrackDisplayStore((s) => s.setSeaFusionColor);
  const setAirFusionColor = useTrackDisplayStore((s) => s.setAirFusionColor);
  const setVectorLengthSeconds = useTrackDisplayStore((s) => s.setVectorLengthSeconds);
  const setTrailLengthSeconds = useTrackDisplayStore((s) => s.setTrailLengthSeconds);

  const [fusionKind, setFusionKind] = useState<TrackFusionKindUi>("sea");

  const currentColor = fusionKind === "sea" ? seaFusionColor : airFusionColor;
  const setCurrentColor = fusionKind === "sea" ? setSeaFusionColor : setAirFusionColor;
  const currentVectorLengthSeconds = fusionKind === "sea" ? vectorLengthSecondsSea : vectorLengthSecondsAir;
  const currentTrailLengthSeconds = fusionKind === "sea" ? trailLengthSecondsSea : trailLengthSecondsAir;

  const fusionTabs = useMemo(
    () =>
      [
        { id: "sea" as const, label: "对海融合航迹" },
        { id: "air" as const, label: "对空融合航迹" },
      ] as const,
    [],
  );

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
          选择融合类型后调整颜色；矢量长度为速度 × 时间；尾迹长度按采样间隔折算展示点数。
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            航迹类型
          </div>
          <div className="flex flex-col gap-1">
            {fusionTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFusionKind(tab.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                  fusionKind === tab.id
                    ? "border-nexus-border-accent bg-nexus-accent-glow/15 text-nexus-text-primary"
                    : "border-nexus-border bg-nexus-bg-surface/80 text-nexus-text-muted hover:bg-nexus-bg-elevated/60",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            航迹颜色（{fusionKind === "sea" ? "对海融合" : "对空融合"}）
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

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
              矢量长度
            </span>
            <span className="text-[11px] tabular-nums text-nexus-text-secondary">{currentVectorLengthSeconds}s</span>
          </div>
          <input
            type="range"
            min={1}
            max={300}
            step={1}
            value={currentVectorLengthSeconds}
            onChange={(e) => setVectorLengthSeconds(fusionKind, Number(e.target.value))}
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
            <span className="text-[11px] tabular-nums text-nexus-text-secondary">{currentTrailLengthSeconds}s</span>
          </div>
          <input
            type="range"
            min={1}
            max={1800}
            step={1}
            value={currentTrailLengthSeconds}
            onChange={(e) => setTrailLengthSeconds(fusionKind, Number(e.target.value))}
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

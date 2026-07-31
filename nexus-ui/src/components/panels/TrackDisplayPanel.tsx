"use client";

/**
 * 航迹显示：各 DDS 航迹类型独立矢量/尾迹/颜色配置。
 * 对空融合：鸟 / 无人机两行独立中立色。
 */

import { cn } from "@/lib/utils";
import { TRACK_LAYER_KEYS_ORDERED, type TrackLayerKey } from "@/lib/map-entity-model";
import { TRACK_SUBTYPE_LABELS, isDotTrackLayerKey } from "@/lib/track-layer-visibility";
import {
  type AirFusionSubtypeKey,
  defaultAirFusionNeutralColors,
  defaultNeutralColorByLayer,
  normalizeCssHexColor,
  useTrackDisplayStore,
} from "@/stores/track-display-store";
import { useMemo, useState } from "react";

function colorLabelForLayer(key: TrackLayerKey): string {
  if (key === "fuse_sea") return "融合中立色";
  if (key === "fuse_air") return "融合中立色";
  if (key === "ais_track") return "三角颜色";
  if (isDotTrackLayerKey(key)) return "圆点颜色";
  return "航迹颜色";
}

const AIR_FUSION_COLOR_ROWS: { key: AirFusionSubtypeKey; label: string }[] = [
  { key: "bird", label: "鸟" },
  { key: "uav", label: "无人机" },
];

function ColorRow({
  label,
  ariaLabel,
  storedColor,
  draft,
  onDraftChange,
  onCommit,
  inputKey,
}: {
  label: string;
  ariaLabel: string;
  storedColor: string;
  draft: string | null;
  onDraftChange: (v: string | null) => void;
  onCommit: (raw: string) => void;
  inputKey: string;
}) {
  const currentColor = draft ?? storedColor;
  return (
    <div>
      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          key={`color-swatch-${inputKey}`}
          type="color"
          value={storedColor}
          onChange={(e) => onCommit(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded border border-nexus-border bg-nexus-bg-surface"
          aria-label={ariaLabel}
        />
        <input
          key={`color-text-${inputKey}`}
          type="text"
          value={currentColor}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => {
            if (draft != null) onCommit(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft != null) {
              e.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 font-mono text-[11px] text-nexus-text-primary"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export function TrackDisplayPanel({ embedded = false }: { embedded?: boolean }) {
  const neutralColorByLayer = useTrackDisplayStore((s) => s.neutralColorByLayer);
  const airFusionNeutralColorBySubtype = useTrackDisplayStore(
    (s) => s.airFusionNeutralColorBySubtype,
  );
  const vectorLengthSecondsByLayer = useTrackDisplayStore((s) => s.vectorLengthSecondsByLayer);
  const trailLengthSecondsByLayer = useTrackDisplayStore((s) => s.trailLengthSecondsByLayer);
  const setNeutralColorForLayer = useTrackDisplayStore((s) => s.setNeutralColorForLayer);
  const setAirFusionNeutralColorForSubtype = useTrackDisplayStore(
    (s) => s.setAirFusionNeutralColorForSubtype,
  );
  const setVectorLengthSecondsForLayer = useTrackDisplayStore((s) => s.setVectorLengthSecondsForLayer);
  const setTrailLengthSecondsForLayer = useTrackDisplayStore((s) => s.setTrailLengthSecondsForLayer);
  const setTrailLengthSecondsForAllLayers = useTrackDisplayStore(
    (s) => s.setTrailLengthSecondsForAllLayers,
  );

  const [selectedLayer, setSelectedLayer] = useState<TrackLayerKey>("fuse_sea");
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [airColorDraft, setAirColorDraft] = useState<Partial<Record<AirFusionSubtypeKey, string>>>(
    {},
  );

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
  const layerDefault = defaultNeutralColorByLayer()[selectedLayer];
  const storedColor = normalizeCssHexColor(
    neutralColorByLayer[selectedLayer] ?? layerDefault,
    layerDefault,
  );

  const airDefaults = defaultAirFusionNeutralColors();
  const storedAirColors = {
    bird: normalizeCssHexColor(
      airFusionNeutralColorBySubtype.bird ?? airDefaults.bird,
      airDefaults.bird,
    ),
    uav: normalizeCssHexColor(
      airFusionNeutralColorBySubtype.uav ?? airDefaults.uav,
      airDefaults.uav,
    ),
  };

  const commitColor = (raw: string) => {
    const next = normalizeCssHexColor(raw, storedColor);
    setColorDraft(null);
    setNeutralColorForLayer(selectedLayer, next);
  };

  const commitAirColor = (key: AirFusionSubtypeKey, raw: string) => {
    const next = normalizeCssHexColor(raw, storedAirColors[key]);
    setAirColorDraft((d) => {
      const n = { ...d };
      delete n[key];
      return n;
    });
    setAirFusionNeutralColorForSubtype(key, next);
  };

  const selectLayer = (id: TrackLayerKey) => {
    setColorDraft(null);
    setAirColorDraft({});
    setSelectedLayer(id);
  };

  const isFuseAir = selectedLayer === "fuse_air";

  const body = (
    <div className={embedded ? "space-y-4" : "flex-1 space-y-4 overflow-y-auto p-3"}>
        {!embedded ? (
          <p className="text-[10px] leading-snug text-nexus-text-muted">
            选择航迹类型后分别调整颜色、矢量与尾迹；各类型配色相互独立。
          </p>
        ) : null}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            航迹类型
          </div>
          <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto pr-0.5">
            {layerTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectLayer(tab.id)}
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

        {isFuseAir ? (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
              {colorLabelForLayer("fuse_air")}（{TRACK_SUBTYPE_LABELS.fuse_air}）
            </div>
            {AIR_FUSION_COLOR_ROWS.map((row) => (
              <ColorRow
                key={row.key}
                label={row.label}
                ariaLabel={`对空融合${row.label}颜色`}
                storedColor={storedAirColors[row.key]}
                draft={airColorDraft[row.key] ?? null}
                onDraftChange={(v) =>
                  setAirColorDraft((d) => {
                    if (v == null) {
                      const n = { ...d };
                      delete n[row.key];
                      return n;
                    }
                    return { ...d, [row.key]: v };
                  })
                }
                onCommit={(raw) => commitAirColor(row.key, raw)}
                inputKey={`fuse_air-${row.key}`}
              />
            ))}
          </div>
        ) : (
          <ColorRow
            label={`${colorLabelForLayer(selectedLayer)}（${TRACK_SUBTYPE_LABELS[selectedLayer]}）`}
            ariaLabel="航迹颜色"
            storedColor={storedColor}
            draft={colorDraft}
            onDraftChange={setColorDraft}
            onCommit={commitColor}
            inputKey={selectedLayer}
          />
        )}

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
          <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-nexus-text-muted">
            <span>1s</span>
            <button
              type="button"
              className="rounded border border-nexus-border px-1.5 py-0.5 text-[9px] text-nexus-text-secondary hover:bg-nexus-bg-elevated/60"
              onClick={() => setTrailLengthSecondsForAllLayers(currentTrailLengthSeconds)}
              title="将该尾迹秒数同步到全部航迹类型"
            >
              应用到全部类型
            </button>
            <span>1800s</span>
          </div>
          <p className="mt-1 text-[9px] leading-snug text-nexus-text-muted">
            上限：内存历史不足时再拉大（如 40s 有数据、拉到 1000s）仍画满已有尾迹。请先选对目标类型，或「应用到全部类型」。
          </p>
        </div>
    </div>
  );

  if (embedded) return body;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">航迹显示</span>
        <p className="mt-1 text-[10px] leading-snug text-nexus-text-muted">
          选择航迹类型后分别调整颜色、矢量与尾迹；各类型配色相互独立。
        </p>
      </div>
      {body}
    </div>
  );
}

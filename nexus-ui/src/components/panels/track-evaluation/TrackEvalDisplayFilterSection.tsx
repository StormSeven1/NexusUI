"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRACK_EVAL_SENSOR_OPTIONS,
  useTrackEvaluationStore,
} from "@/stores/track-evaluation-store";

function RangeInputs({
  min,
  max,
  onMin,
  onMax,
  step = "0.01",
}: {
  min: number | null;
  max: number | null;
  onMin: (v: number | null) => void;
  onMax: (v: number | null) => void;
  step?: string;
}) {
  const parse = (raw: string) => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        step={step}
        value={min ?? ""}
        onChange={(e) => onMin(parse(e.target.value))}
        placeholder="最小值"
        className="h-7 min-w-0 flex-1 rounded border border-nexus-border bg-nexus-bg-base px-1.5 text-[11px] text-nexus-text-primary"
      />
      <span className="text-[10px] text-nexus-text-muted">~</span>
      <input
        type="number"
        step={step}
        value={max ?? ""}
        onChange={(e) => onMax(parse(e.target.value))}
        placeholder="最大值"
        className="h-7 min-w-0 flex-1 rounded border border-nexus-border bg-nexus-bg-base px-1.5 text-[11px] text-nexus-text-primary"
      />
    </div>
  );
}

export function TrackEvalDisplayFilterSection() {
  const displayAdvancedVisible = useTrackEvaluationStore((s) => s.displayAdvancedVisible);
  const displayFilter = useTrackEvaluationStore((s) => s.displayFilter);
  const setDisplayAdvancedVisible = useTrackEvaluationStore((s) => s.setDisplayAdvancedVisible);
  const toggleDisplaySensor = useTrackEvaluationStore((s) => s.toggleDisplaySensor);
  const patchDisplayFilter = useTrackEvaluationStore((s) => s.patchDisplayFilter);
  const applyDisplayFilter = useTrackEvaluationStore((s) => s.applyDisplayFilter);

  const df = displayFilter;

  return (
    <section className="mt-4 border-t border-nexus-border pt-3">
      <button
        type="button"
        onClick={() => setDisplayAdvancedVisible(!displayAdvancedVisible)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
          显示筛选
        </h4>
        <span className="flex items-center gap-1 text-[10px] text-nexus-text-muted">
          {displayAdvancedVisible ? "隐藏" : "展开"}
          {displayAdvancedVisible ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
        </span>
      </button>

      {displayAdvancedVisible ? (
        <div className="mt-2 space-y-3">
          <div>
            <span className="mb-1.5 block text-[10px] text-nexus-text-muted">传感器 ID</span>
            <div className="space-y-1 rounded-md border border-nexus-border bg-nexus-bg-elevated/30 p-2">
              <label className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-nexus-text-secondary">
                <input
                  type="checkbox"
                  checked={df.displaySensorIds.includes(0)}
                  onChange={() => toggleDisplaySensor(0)}
                  className="accent-nexus-accent"
                />
                <span>对海融合航迹(</span>
                {(
                  [
                    ["all", "所有"],
                    ["with-ais", "含AIS"],
                    ["without-ais", "不含AIS"],
                  ] as const
                ).map(([val, label]) => (
                  <label key={val} className="inline-flex items-center gap-0.5">
                    <input
                      type="radio"
                      name="seaFusionFilter"
                      checked={df.seaFusionFilter === val}
                      disabled={!df.displaySensorIds.includes(0)}
                      onChange={() => patchDisplayFilter({ seaFusionFilter: val })}
                      className="accent-nexus-accent"
                    />
                    {label}
                  </label>
                ))}
                <span>)</span>
              </label>
              {TRACK_EVAL_SENSOR_OPTIONS.filter((o) => o.id !== 0 && o.id !== 6).map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 text-[10px] text-nexus-text-secondary"
                >
                  <input
                    type="checkbox"
                    checked={df.displaySensorIds.includes(opt.id)}
                    onChange={() => toggleDisplaySensor(opt.id)}
                    className="accent-nexus-accent"
                  />
                  {opt.label}
                </label>
              ))}
              <label className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-nexus-text-secondary">
                <input
                  type="checkbox"
                  checked={df.displaySensorIds.includes(6)}
                  onChange={() => toggleDisplaySensor(6)}
                  className="accent-nexus-accent"
                />
                <span>对空融合航迹(</span>
                {(
                  [
                    ["all", "所有"],
                    ["with-selfreport", "含自报位"],
                    ["without-selfreport", "不含自报位"],
                  ] as const
                ).map(([val, label]) => (
                  <label key={val} className="inline-flex items-center gap-0.5">
                    <input
                      type="radio"
                      name="airFusionFilter"
                      checked={df.airFusionFilter === val}
                      disabled={!df.displaySensorIds.includes(6)}
                      onChange={() => patchDisplayFilter({ airFusionFilter: val })}
                      className="accent-nexus-accent"
                    />
                    {label}
                  </label>
                ))}
                <span>)</span>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-nexus-text-muted">航迹 ID</label>
            <input
              type="text"
              value={df.trackId}
              onChange={(e) => patchDisplayFilter({ trackId: e.target.value })}
              placeholder="可输入多个 ID，用逗号分隔，如：1,2,3"
              className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 text-xs text-nexus-text-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-nexus-text-muted">唯一 ID</label>
            <input
              type="text"
              value={df.uniqueId}
              onChange={(e) => patchDisplayFilter({ uniqueId: e.target.value })}
              placeholder="可输入多个 ID，用逗号分隔，如：100,200,300"
              className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 text-xs text-nexus-text-primary"
            />
          </div>

          {(
            [
              ["方位角范围", "minAzimuth", "maxAzimuth"],
              ["距离范围", "minDistance", "maxDistance"],
              ["速度范围", "minSpeed", "maxSpeed"],
              ["航向范围", "minCourse", "maxCourse"],
              ["目标大小范围", "minSize", "maxSize"],
            ] as const
          ).map(([label, minKey, maxKey]) => (
            <div key={minKey}>
              <label className="mb-1 block text-[10px] text-nexus-text-muted">{label}</label>
              <RangeInputs
                min={df[minKey]}
                max={df[maxKey]}
                onMin={(v) => patchDisplayFilter({ [minKey]: v })}
                onMax={(v) => patchDisplayFilter({ [maxKey]: v })}
              />
            </div>
          ))}

          <button
            type="button"
            onClick={() => applyDisplayFilter()}
            className="w-full rounded-md bg-nexus-accent px-2.5 py-1.5 text-[11px] font-medium text-nexus-text-inverse hover:opacity-90"
          >
            开始筛选
          </button>

          <div>
            <span className="mb-1.5 block text-[10px] font-medium text-nexus-text-muted">
              误差筛选（仅对融合航迹有效）
            </span>
            <div className="space-y-2 rounded-md border border-nexus-border bg-nexus-bg-elevated/30 p-2">
              {(
                [
                  ["距离误差 (m)", "minDistanceError", "maxDistanceError"],
                  ["高度误差 (m)", "minHeightError", "maxHeightError"],
                  ["方位角误差 (°)", "minAzimuthError", "maxAzimuthError"],
                  ["俯仰角误差 (°)", "minElevationError", "maxElevationError"],
                  ["航向误差 (°)", "minCourseError", "maxCourseError"],
                  ["航速误差 (m/s)", "minSpeedError", "maxSpeedError"],
                ] as const
              ).map(([label, minKey, maxKey]) => (
                <div key={minKey}>
                  <label className="mb-0.5 block text-[10px] text-nexus-text-muted">{label}</label>
                  <RangeInputs
                    min={df[minKey]}
                    max={df[maxKey]}
                    onMin={(v) => patchDisplayFilter({ [minKey]: v })}
                    onMax={(v) => patchDisplayFilter({ [maxKey]: v })}
                  />
                </div>
              ))}
            </div>
          </div>

          <p className={cn("text-[9px] leading-snug text-nexus-text-muted/80")}>
            与 mapbox-vue2 一致：显示筛选在查询完成后应用；gRPC 模式下会带条件重新评估或本地过滤指标。
          </p>
        </div>
      ) : null}
    </section>
  );
}

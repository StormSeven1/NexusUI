"use client";

import {
  AREA_LAYER_LINE_STYLE_OPTIONS,
  AREA_LAYER_LINE_WIDTH_MAX,
  AREA_LAYER_LINE_WIDTH_MIN,
  DISTANCE_RING_MAX_COUNT,
  DISTANCE_RING_SPACING_NM_OPTIONS,
} from "@/lib/distance-ring-settings";
import { useDistanceRingStore } from "@/stores/distance-ring-store";

function ColorOpacityField({
  label,
  color,
  opacity,
  onColor,
  onOpacity,
  ariaColor,
}: {
  label: string;
  color: string;
  opacity: number;
  onColor: (c: string) => void;
  onOpacity: (o: number) => void;
  ariaColor: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded border border-nexus-border bg-nexus-bg-surface"
          aria-label={ariaColor}
        />
        <input
          type="text"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 font-mono text-[11px] text-nexus-text-primary"
          spellCheck={false}
        />
      </div>
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] text-nexus-text-muted">
          <span>透明度</span>
          <span className="tabular-nums text-nexus-text-secondary">{opacity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => onOpacity(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>
    </div>
  );
}

export function DistanceRingDisplayTab() {
  const ringCount = useDistanceRingStore((s) => s.ringCount);
  const spacingNm = useDistanceRingStore((s) => s.spacingNm);
  const centerLat = useDistanceRingStore((s) => s.centerLat);
  const centerLng = useDistanceRingStore((s) => s.centerLng);
  const ringColor = useDistanceRingStore((s) => s.ringColor);
  const ringOpacity = useDistanceRingStore((s) => s.ringOpacity);
  const labelOpacity = useDistanceRingStore((s) => s.labelOpacity);
  const areaLineColor = useDistanceRingStore((s) => s.areaLineColor);
  const areaLineOpacity = useDistanceRingStore((s) => s.areaLineOpacity);
  const areaLabelOpacity = useDistanceRingStore((s) => s.areaLabelOpacity);
  const setRingCount = useDistanceRingStore((s) => s.setRingCount);
  const setSpacingNm = useDistanceRingStore((s) => s.setSpacingNm);
  const setCenterLat = useDistanceRingStore((s) => s.setCenterLat);
  const setCenterLng = useDistanceRingStore((s) => s.setCenterLng);
  const setRingColor = useDistanceRingStore((s) => s.setRingColor);
  const setRingOpacity = useDistanceRingStore((s) => s.setRingOpacity);
  const setLabelOpacity = useDistanceRingStore((s) => s.setLabelOpacity);
  const areaLineWidth = useDistanceRingStore((s) => s.areaLineWidth);
  const areaLineStyle = useDistanceRingStore((s) => s.areaLineStyle);
  const setAreaLineColor = useDistanceRingStore((s) => s.setAreaLineColor);
  const setAreaLineOpacity = useDistanceRingStore((s) => s.setAreaLineOpacity);
  const setAreaLabelOpacity = useDistanceRingStore((s) => s.setAreaLabelOpacity);
  const setAreaLineWidth = useDistanceRingStore((s) => s.setAreaLineWidth);
  const setAreaLineStyle = useDistanceRingStore((s) => s.setAreaLineStyle);

  return (
    <div className="space-y-4">
      <p className="text-[10px] leading-snug text-nexus-text-muted">
        距离环为态势同心圆；下方「区域图层」配色作用于图层面板中的 Postgres 区域（矩形/圆/航线等），与距离环无关。
      </p>

      <p className="text-[11px] font-semibold text-nexus-text-secondary">距离环</p>

      <div>
        <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
          <span>距离环个数</span>
          <span className="tabular-nums text-nexus-text-secondary">{ringCount}</span>
        </label>
        <input
          type="range"
          min={1}
          max={DISTANCE_RING_MAX_COUNT}
          step={1}
          value={ringCount}
          onChange={(e) => setRingCount(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <div className="mt-0.5 flex justify-between text-[9px] text-nexus-text-muted">
          <span>1</span>
          <span>{DISTANCE_RING_MAX_COUNT}</span>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
          距离环间距（NM）
        </label>
        <select
          value={spacingNm}
          onChange={(e) => setSpacingNm(Number(e.target.value))}
          className="w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 text-xs text-nexus-text-primary"
        >
          {DISTANCE_RING_SPACING_NM_OPTIONS.map((nm) => (
            <option key={nm} value={nm}>
              {nm % 1 === 0 ? `${nm} NM` : `${nm.toFixed(1)} NM`}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            中心纬度
          </label>
          <input
            type="number"
            step="any"
            value={centerLat}
            onChange={(e) => setCenterLat(Number(e.target.value))}
            className="w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 font-mono text-[11px] text-nexus-text-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
            中心经度
          </label>
          <input
            type="number"
            step="any"
            value={centerLng}
            onChange={(e) => setCenterLng(Number(e.target.value))}
            className="w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 font-mono text-[11px] text-nexus-text-primary"
          />
        </div>
      </div>

      <ColorOpacityField
        label="距离环颜色"
        color={ringColor}
        opacity={ringOpacity}
        onColor={setRingColor}
        onOpacity={setRingOpacity}
        ariaColor="距离环颜色"
      />

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-nexus-text-muted">
          <span className="font-semibold uppercase tracking-wider">距离环标注透明度</span>
          <span className="tabular-nums text-nexus-text-secondary">{labelOpacity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={labelOpacity}
          onChange={(e) => setLabelOpacity(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>

      <p className="border-t border-white/[0.06] pt-3 text-[11px] font-semibold text-nexus-text-secondary">
        区域图层
      </p>

      <ColorOpacityField
        label="区域边线颜色"
        color={areaLineColor}
        opacity={areaLineOpacity}
        onColor={setAreaLineColor}
        onOpacity={setAreaLineOpacity}
        ariaColor="区域图层边线颜色"
      />

      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
          区域边线线型
        </label>
        <select
          value={areaLineStyle}
          onChange={(e) => setAreaLineStyle(e.target.value as typeof areaLineStyle)}
          className="w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 py-1.5 text-xs text-nexus-text-primary"
        >
          {AREA_LAYER_LINE_STYLE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
          <span>区域边线线宽</span>
          <span className="tabular-nums text-nexus-text-secondary">{areaLineWidth.toFixed(1)} px</span>
        </label>
        <input
          type="range"
          min={AREA_LAYER_LINE_WIDTH_MIN}
          max={AREA_LAYER_LINE_WIDTH_MAX}
          step={0.5}
          value={areaLineWidth}
          onChange={(e) => setAreaLineWidth(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <div className="mt-0.5 flex justify-between text-[9px] text-nexus-text-muted">
          <span>{AREA_LAYER_LINE_WIDTH_MIN}</span>
          <span>{AREA_LAYER_LINE_WIDTH_MAX}</span>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-nexus-text-muted">
          <span className="font-semibold uppercase tracking-wider">区域名称透明度</span>
          <span className="tabular-nums text-nexus-text-secondary">{areaLabelOpacity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={areaLabelOpacity}
          onChange={(e) => setAreaLabelOpacity(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <p className="mt-0.5 text-[9px] text-nexus-text-muted">名称颜色与区域边线一致</p>
      </div>
    </div>
  );
}

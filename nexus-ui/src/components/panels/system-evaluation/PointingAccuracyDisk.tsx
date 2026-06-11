"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDeltaDeg, filterPointingAccuracySamplesForCamera, type PointingAccuracySample } from "@/lib/system-eval-camera-api";

export const POINTING_DISK_RING_STEP_M = 2000;
export const POINTING_DISK_MAX_M = 12000;
export const POINTING_DISK_RING_COUNT = POINTING_DISK_MAX_M / POINTING_DISK_RING_STEP_M;
export const POINTING_DISK_SECTOR_COUNT = 12;
export const POINTING_DISK_SECTOR_DEG = 360 / POINTING_DISK_SECTOR_COUNT;

const COLOR_GRID = "rgba(255,255,255,0.14)";
const COLOR_GRID_FAINT = "rgba(255,255,255,0.08)";
const COLOR_EMPTY = "rgba(255,255,255,0.05)";
const COLOR_EMPTY_STROKE = "rgba(255,255,255,0.1)";
const COLOR_DATA = "rgba(75,158,255,0.55)";
const COLOR_DATA_STROKE = "rgba(75,158,255,0.85)";
const COLOR_SELECTED = "rgba(75,158,255,0.82)";
const COLOR_SELECTED_STROKE = "rgba(147,197,253,1)";
const COLOR_CENTER = "rgba(147,197,253,0.95)";
const COLOR_LABEL = "rgba(160,160,168,1)";

export interface PointingDiskCell {
  ring: number;
  sector: number;
  samples: PointingAccuracySample[];
  meanDeltaP: number | null;
  meanDeltaT: number | null;
}

export interface PointingDiskSelection {
  ring: number;
  sector: number;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function resolveSampleDistanceM(sample: PointingAccuracySample): number | null {
  const distance = toNumber(sample.distance);
  if (distance != null && distance > 0 && distance <= POINTING_DISK_MAX_M) {
    return distance;
  }

  const match = sample.range_band?.match(/(\d+)/);
  if (match) {
    const bandM = Number.parseInt(match[1], 10);
    if (Number.isFinite(bandM) && bandM > 0) {
      return Math.min(bandM + POINTING_DISK_RING_STEP_M / 2, POINTING_DISK_MAX_M);
    }
  }

  if (distance != null && distance > 0) {
    return Math.min(distance, POINTING_DISK_MAX_M);
  }
  return null;
}

export function getRingIndex(distanceM: number): number | null {
  if (distanceM <= 0 || distanceM > POINTING_DISK_MAX_M) return null;
  return Math.min(
    POINTING_DISK_RING_COUNT - 1,
    Math.floor((distanceM - 1) / POINTING_DISK_RING_STEP_M),
  );
}

export function getSectorIndex(azimuthDeg: number): number {
  const norm = ((azimuthDeg % 360) + 360) % 360;
  return Math.floor(norm / POINTING_DISK_SECTOR_DEG) % POINTING_DISK_SECTOR_COUNT;
}

function isSuccessfulSample(sample: PointingAccuracySample): boolean {
  if (sample.success === false) return false;
  return sample.success === true || sample.delta_p != null || sample.delta_t != null;
}

export function buildPointingDiskCells(
  samples: PointingAccuracySample[] | undefined,
  cameraEntityId?: string,
): PointingDiskCell[] {
  const scopedSamples = cameraEntityId?.trim()
    ? filterPointingAccuracySamplesForCamera(samples, cameraEntityId)
    : (samples ?? []);

  const map = new Map<string, PointingAccuracySample[]>();

  for (const sample of scopedSamples) {
    if (!isSuccessfulSample(sample)) continue;
    const distanceM = resolveSampleDistanceM(sample);
    const azimuth = toNumber(sample.azimuth);
    if (distanceM == null || azimuth == null) continue;

    const ring = getRingIndex(distanceM);
    if (ring == null) continue;
    const sector = getSectorIndex(azimuth);
    const key = `${ring}-${sector}`;
    const bucket = map.get(key) ?? [];
    bucket.push(sample);
    map.set(key, bucket);
  }

  const cells: PointingDiskCell[] = [];
  for (const [key, bucket] of map.entries()) {
    const [ringStr, sectorStr] = key.split("-");
    const ring = Number(ringStr);
    const sector = Number(sectorStr);
    const deltasP = bucket.map((s) => toNumber(s.delta_p)).filter((v): v is number => v != null);
    const deltasT = bucket.map((s) => toNumber(s.delta_t)).filter((v): v is number => v != null);
    cells.push({
      ring,
      sector,
      samples: bucket,
      meanDeltaP: deltasP.length ? deltasP.reduce((a, b) => a + b, 0) / deltasP.length : null,
      meanDeltaT: deltasT.length ? deltasT.reduce((a, b) => a + b, 0) / deltasT.length : null,
    });
  }
  return cells;
}

function polarPoint(cx: number, cy: number, r: number, azimuthDeg: number) {
  const rad = (azimuthDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.sin(rad),
    y: cy - r * Math.cos(rad),
  };
}

function sectorPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  azStart: number,
  azEnd: number,
): string {
  const largeArc = azEnd - azStart > 180 ? 1 : 0;
  const pOuterStart = polarPoint(cx, cy, outerR, azStart);
  const pOuterEnd = polarPoint(cx, cy, outerR, azEnd);

  if (innerR <= 0.5) {
    return [
      `M ${cx} ${cy}`,
      `L ${pOuterStart.x} ${pOuterStart.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${pOuterEnd.x} ${pOuterEnd.y}`,
      "Z",
    ].join(" ");
  }

  const pInnerEnd = polarPoint(cx, cy, innerR, azEnd);
  const pInnerStart = polarPoint(cx, cy, innerR, azStart);
  return [
    `M ${pOuterStart.x} ${pOuterStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${pOuterEnd.x} ${pOuterEnd.y}`,
    `L ${pInnerEnd.x} ${pInnerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${pInnerStart.x} ${pInnerStart.y}`,
    "Z",
  ].join(" ");
}

function ringLabel(ring: number): string {
  const innerKm = ring * (POINTING_DISK_RING_STEP_M / 1000);
  const outerKm = (ring + 1) * (POINTING_DISK_RING_STEP_M / 1000);
  return `${innerKm}–${outerKm} km`;
}

function sectorLabel(sector: number): string {
  const start = sector * POINTING_DISK_SECTOR_DEG;
  const end = (sector + 1) * POINTING_DISK_SECTOR_DEG;
  return `${start}°–${end}°`;
}

export function PointingAccuracyDisk({
  samples,
  cameraEntityId,
  className,
}: {
  samples?: PointingAccuracySample[];
  cameraEntityId?: string;
  className?: string;
}) {
  const [selection, setSelection] = useState<PointingDiskSelection | null>(null);

  const scopedSamples = useMemo(
    () => (cameraEntityId?.trim() ? filterPointingAccuracySamplesForCamera(samples, cameraEntityId) : (samples ?? [])),
    [samples, cameraEntityId],
  );

  const cellMap = useMemo(() => {
    const cells = buildPointingDiskCells(scopedSamples);
    const map = new Map<string, PointingDiskCell>();
    for (const cell of cells) {
      map.set(`${cell.ring}-${cell.sector}`, cell);
    }
    return map;
  }, [samples]);

  useEffect(() => {
    setSelection(null);
  }, [scopedSamples, cameraEntityId]);

  const selectedCell = useMemo(() => {
    if (!selection) return null;
    return cellMap.get(`${selection.ring}-${selection.sector}`) ?? null;
  }, [cellMap, selection]);

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 14;
  const ringStep = maxR / POINTING_DISK_RING_COUNT;

  const wedges: Array<{
    ring: number;
    sector: number;
    path: string;
    hasData: boolean;
    isSelected: boolean;
  }> = [];

  for (let ring = 0; ring < POINTING_DISK_RING_COUNT; ring += 1) {
    const innerR = ring * ringStep;
    const outerR = (ring + 1) * ringStep;
    for (let sector = 0; sector < POINTING_DISK_SECTOR_COUNT; sector += 1) {
      const azStart = sector * POINTING_DISK_SECTOR_DEG;
      const azEnd = azStart + POINTING_DISK_SECTOR_DEG;
      const hasData = cellMap.has(`${ring}-${sector}`);
      const isSelected = selection?.ring === ring && selection?.sector === sector;
      wedges.push({
        ring,
        sector,
        path: sectorPath(cx, cy, innerR, outerR, azStart, azEnd),
        hasData,
        isSelected,
      });
    }
  }

  const litCount = cellMap.size;
  const sampleCount = scopedSamples.filter(isSuccessfulSample).length;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-[220px] w-[220px] max-w-full"
          role="img"
          aria-label="指向准确度极坐标分布"
        >
          <circle cx={cx} cy={cy} r={maxR} fill="none" stroke={COLOR_GRID} strokeWidth={1} />
          {Array.from({ length: POINTING_DISK_RING_COUNT - 1 }, (_, i) => (
            <circle
              key={`ring-guide-${i}`}
              cx={cx}
              cy={cy}
              r={(i + 1) * ringStep}
              fill="none"
              stroke={COLOR_GRID_FAINT}
              strokeWidth={0.8}
              strokeDasharray="3 3"
            />
          ))}
          {Array.from({ length: POINTING_DISK_SECTOR_COUNT }, (_, i) => {
            const az = i * POINTING_DISK_SECTOR_DEG;
            const p = polarPoint(cx, cy, maxR, az);
            return (
              <line
                key={`sector-line-${i}`}
                x1={cx}
                y1={cy}
                x2={p.x}
                y2={p.y}
                stroke={COLOR_GRID_FAINT}
                strokeWidth={0.8}
              />
            );
          })}

          {wedges.map((w) => {
            const fill = w.hasData
              ? w.isSelected
                ? COLOR_SELECTED
                : COLOR_DATA
              : COLOR_EMPTY;
            const stroke = w.hasData
              ? w.isSelected
                ? COLOR_SELECTED_STROKE
                : COLOR_DATA_STROKE
              : COLOR_EMPTY_STROKE;
            return (
              <path
                key={`${w.ring}-${w.sector}`}
                d={w.path}
                fill={fill}
                stroke={stroke}
                strokeWidth={w.isSelected ? 1.4 : 0.8}
                style={{ cursor: w.hasData ? "pointer" : "default" }}
                onClick={() => {
                  if (!w.hasData) {
                    setSelection(null);
                    return;
                  }
                  setSelection({ ring: w.ring, sector: w.sector });
                }}
              />
            );
          })}

          <circle cx={cx} cy={cy} r={3.5} fill={COLOR_CENTER} />
          <text x={cx} y={11} textAnchor="middle" fill={COLOR_LABEL} fontSize={9}>
            N
          </text>
          <text x={cx} y={size - 3} textAnchor="middle" fill={COLOR_LABEL} fontSize={8}>
            12 km
          </text>
        </svg>
      </div>

      <p className="text-center text-[9px] text-nexus-text-muted">
        {litCount > 0
          ? `已点亮 ${litCount} 格（共 ${sampleCount} 条有效测量）`
          : sampleCount > 0
            ? "有测量记录，但距离或方位超出圆盘范围（0–12 km）"
            : "当前相机暂无测量数据，请先执行评估或切换已有数据的相机"}
      </p>
      {cameraEntityId?.trim() ? (
        <p className="text-center text-[8px] text-nexus-text-muted">相机 {cameraEntityId.trim()}</p>
      ) : null}

      <div className="flex flex-wrap justify-center gap-1 text-[8px] text-nexus-text-muted">
        {Array.from({ length: POINTING_DISK_RING_COUNT }, (_, ring) => (
          <span key={ring} className="rounded border border-nexus-border/40 px-1 py-0.5">
            {ringLabel(ring)}
          </span>
        ))}
      </div>

      {selectedCell ? (
        <div className="rounded border border-nexus-accent/30 bg-nexus-accent/10 px-2 py-1.5 text-[10px]">
          <p className="text-nexus-text-muted">
            距离 {ringLabel(selectedCell.ring)} · 方位 {sectorLabel(selectedCell.sector)}
            {selectedCell.samples.length > 1 ? ` · ${selectedCell.samples.length} 条` : ""}
          </p>
          <p className="mt-0.5 font-mono font-medium text-nexus-accent">
            ΔP {formatDeltaDeg(selectedCell.meanDeltaP ?? undefined)} · ΔT{" "}
            {formatDeltaDeg(selectedCell.meanDeltaT ?? undefined)}
          </p>
          {selectedCell.samples[0]?.track_id != null ? (
            <p className="mt-0.5 font-mono text-[9px] text-nexus-text-muted">
              航迹 {selectedCell.samples.map((s) => s.track_id).join(", ")}
            </p>
          ) : null}
        </div>
      ) : litCount > 0 ? (
        <p className="text-center text-[9px] text-nexus-text-muted">
          点击蓝色扇区查看该距离·方位段的 ΔP/ΔT
        </p>
      ) : null}
    </div>
  );
}

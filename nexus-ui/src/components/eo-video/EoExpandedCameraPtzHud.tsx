"use client";

import { useEffect, useMemo, useState } from "react";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  ensureEntitiesTrackTaskCache,
  getEntitiesTrackTaskCacheRow,
  isTrackTaskOwnerRowAllowed,
} from "@/lib/entities-track-task-cache";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { cn } from "@/lib/utils";

function normalizeDeg360(deg: number): number {
  let x = deg % 360;
  if (x < 0) x += 360;
  if (x >= 360) x -= 360;
  return x;
}

function formatNum(n: number | undefined, digits: number): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

const RULER_HALF_SPAN = 40;
const LONG_STEP = 10;

type Props = {
  expandedMode: boolean;
  entityId: string | undefined;
  /** 解析流地址中等：不叠 HUD */
  disabled?: boolean;
};

/**
 * 放大态光电：主 PTZ 相机（实体 hasPtz 且无 parent）时叠顶部方位刻度 + 左下 PTZ。
 * 刻度标签按「真北角 = 刻度位置 + panoOffset」折算（与 `parseCameraBearingDeg` 一致）；指示三角对应当前 P。
 */
export function EoExpandedCameraPtzHud({ expandedMode, entityId, disabled }: Props) {
  const id = entityId?.trim() ? canonicalEntityId(entityId) : "";
  const [ownerOk, setOwnerOk] = useState(false);

  useEffect(() => {
    if (!expandedMode || !id || disabled) {
      setOwnerOk(false);
      return;
    }
    let cancelled = false;
    const apply = () => {
      const row = getEntitiesTrackTaskCacheRow(id);
      setOwnerOk(Boolean(row && isTrackTaskOwnerRowAllowed(row)));
    };
    apply();
    void ensureEntitiesTrackTaskCache().then(() => {
      if (!cancelled) apply();
    });
    return () => {
      cancelled = true;
    };
  }, [expandedMode, id, disabled]);

  const dds = useEoCameraDdsStatusStore((s) => (id ? s.byEntityId[id] : undefined));

  const pan = dds?.ptzPanDeg;
  const tilt = dds?.ptzTiltDeg;
  const zoom = dds?.ptzZoom;
  const panoOff = dds?.panoOffsetDeg;

  const rulerModel = useMemo(() => {
    const p = Number.isFinite(pan) ? (pan as number) : 0;
    const off = Number.isFinite(panoOff) ? (panoOff as number) : 0;
    const min = p - RULER_HALF_SPAN;
    const max = p + RULER_HALF_SPAN;
    const span = max - min || 1;
    const ticks: { i: number; xPct: number; long: boolean; label: string }[] = [];
    const i0 = Math.floor(min);
    const i1 = Math.ceil(max);
    for (let i = i0; i <= i1; i++) {
      const xPct = ((i - min) / span) * 100;
      const long = i % LONG_STEP === 0;
      const label = long ? String(Math.round(normalizeDeg360(i + off))) : "";
      ticks.push({ i, xPct, long, label });
    }
    const pointerPct = ((p - min) / span) * 100;
    const trueNorth = Number.isFinite(pan) ? normalizeDeg360(p + off) : undefined;
    return { ticks, pointerPct, trueNorth, hasFinitePan: Number.isFinite(pan) };
  }, [pan, panoOff]);

  if (!expandedMode || !id || disabled || !ownerOk) return null;

  const panoOffFinite = Number.isFinite(panoOff);

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-[24] flex h-11 flex-col justify-end border-b border-white/[0.08] bg-gradient-to-b from-black/70 to-transparent px-1 pb-0.5 pt-1",
        )}
        aria-hidden
      >
        <div className="relative h-7 w-full select-none font-mono text-[9px] text-sky-100/85">
          {rulerModel.ticks.map((t) => (
            <div
              key={`t-${t.i}`}
              className="absolute bottom-0 flex flex-col items-center"
              style={{ left: `${t.xPct}%`, transform: "translateX(-50%)" }}
            >
              {t.long ? (
                <>
                  <span className="mb-0.5 whitespace-nowrap text-[8px] text-sky-200/90">{t.label}°</span>
                  <div className="h-3 w-px bg-sky-200/75" />
                </>
              ) : (
                <div className="h-2 w-px bg-white/35" />
              )}
            </div>
          ))}
          <div
            className="absolute bottom-0 flex flex-col items-center"
            style={{ left: `${rulerModel.pointerPct}%`, transform: "translateX(-50%)" }}
          >
            <div className="h-0 w-0 border-x-[5px] border-b-[7px] border-x-transparent border-b-amber-400 drop-shadow-sm" />
          </div>
        </div>
        {rulerModel.trueNorth !== undefined ? (
          <div className="truncate px-1 text-center text-[8px] text-sky-300/80">
            真北方位 {rulerModel.trueNorth.toFixed(1)}°
            {panoOffFinite ? "（P + panoOffset）" : ""}
          </div>
        ) : (
          <div className="h-2 shrink-0" />
        )}
      </div>

      <div
        className={cn(
          "pointer-events-none absolute bottom-14 left-2 z-[24] max-w-[min(92%,420px)] rounded border border-white/[0.12] bg-black/60 px-2 py-1 font-mono text-[10px] leading-snug text-sky-100/90 shadow-md backdrop-blur-[2px]",
        )}
      >
        <div className="text-[9px] font-medium text-sky-300/90">PTZ</div>
        <div>
          P {formatNum(pan, 2)}° · T {formatNum(tilt, 2)}° · Z {formatNum(zoom, 2)}
        </div>
        {rulerModel.trueNorth !== undefined ? (
          <div className="text-[9px] text-sky-400/85">真北 {rulerModel.trueNorth.toFixed(2)}°</div>
        ) : null}
      </div>
    </>
  );
}

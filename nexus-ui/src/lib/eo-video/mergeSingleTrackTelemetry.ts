import type { Track } from "@/lib/map-entity-model";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { EoDetectionBox } from "@/lib/eo-video/types";

function finiteNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") {
    const n = Number(v.valueOf());
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickFirstFinite(...vals: Array<number | undefined | null>): number | undefined {
  for (const v of vals) {
    if (v != null && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** 业务航迹号 / uniqueID 与 DDS `trackID`（正整数）对齐 */
function fieldMatchesDdsNum(ddsNum: number, field: string | undefined): boolean {
  if (field == null || String(field).trim() === "") return false;
  const n = Number(field);
  if (!Number.isFinite(n)) return false;
  return Math.trunc(n) === ddsNum;
}

export function findTrackByDdsTrackId(tracks: readonly Track[], ddsNum: number): Track | undefined {
  for (const t of tracks) {
    if (fieldMatchesDdsNum(ddsNum, t.trackId)) return t;
    if (fieldMatchesDdsNum(ddsNum, t.uniqueID)) return t;
    if (fieldMatchesDdsNum(ddsNum, t.showID)) return t;
    if (fieldMatchesDdsNum(ddsNum, t.id)) return t;
  }
  return undefined;
}

/**
 * 单目标标牌四元组：DDS 相机行 → 检测 WS meta → GIS 航迹（与 TargetPlacard / track-store 同源）。
 * 航迹 `speed` 与地图标牌一致为 m/s，供画布 `SPD … m/s`。
 */
export function mergeSingleTrackTelemetry(
  box: EoDetectionBox,
  ddsRow: EoCameraDdsStatusRow | undefined,
  tracks: readonly Track[],
): NonNullable<EoDetectionBox["singleTrackDetail"]> {
  const meta = box.singleTrackDetail ?? {};
  const tidFromDds = box.ddsTrackId != null && Number.isFinite(box.ddsTrackId) ? Math.trunc(box.ddsTrackId) : null;
  const tidFromWs = box.trackId != null && Number.isFinite(box.trackId) ? Math.trunc(box.trackId) : null;
  const tid = tidFromDds ?? tidFromWs;
  const tr = tid != null ? findTrackByDdsTrackId(tracks, tid) : undefined;

  const azimuthDeg = pickFirstFinite(meta.azimuthDeg, finiteNum(ddsRow?.azimuth), tr?.azimuth);

  let distanceM = pickFirstFinite(meta.distanceM, finiteNum(ddsRow?.distance), tr?.distance);

  const courseDeg = pickFirstFinite(meta.courseDeg, finiteNum(ddsRow?.course), tr?.course, tr?.heading);

  let speedMps = pickFirstFinite(meta.speedMps, finiteNum(ddsRow?.speed));
  if (speedMps == null && tr != null && Number.isFinite(tr.speed)) {
    speedMps = tr.speed;
  }

  const out: NonNullable<EoDetectionBox["singleTrackDetail"]> = {};
  if (azimuthDeg != null) out.azimuthDeg = azimuthDeg;
  if (distanceM != null) out.distanceM = distanceM;
  if (speedMps != null) out.speedMps = speedMps;
  if (courseDeg != null) out.courseDeg = courseDeg;
  return out;
}

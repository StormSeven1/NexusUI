import type { Track } from "@/lib/map-entity-model";
import { bearingDegFromPoint, haversineDistanceM } from "@/lib/eo-calc-record/geo";
import type { FusionRadarSlice } from "@/lib/eo-calc-record/resolveFusionRadarSources";

export type CalcRecordRectPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SeaCalcRecordInput = {
  seq: number;
  fuseTrack: Track;
  yy: FusionRadarSlice;
  jzt: FusionRadarSlice;
  camLat: number;
  camLng: number;
  rect: CalcRecordRectPx;
  p: number;
  t: number;
  z: number;
  shipName: string;
  trackTime: string;
  recordTime: string;
};

export type SkyCalcRecordInput = {
  lon: number;
  lat: number;
  alt: number;
  distance: number;
  p: number;
  t: number;
  z: number;
  trackTime: string;
  selfLon: number;
  selfLat: number;
  selfAlt: number;
  selfPosTime: string;
  fuseId: string;
};

function fmt6(n: number): string {
  return Number.isFinite(n) ? n.toFixed(6) : "0.000000";
}

/** 对齐 Qt `camConf/cam/cam{N}.txt` 一行 */
export function buildSeaCalcRecordLine(input: SeaCalcRecordInput): string {
  const t = input.fuseTrack;
  const shipLon = t.lng;
  const shipLat = t.lat;
  const shipsize = 0;
  const sizeRadian = 0;
  const distance =
    t.distance != null && Number.isFinite(t.distance)
      ? t.distance
      : haversineDistanceM(input.camLat, input.camLng, shipLat, shipLon);
  const azi0 = bearingDegFromPoint(input.camLat, input.camLng, shipLat, shipLon);
  const course = t.course ?? t.heading ?? 0;
  const speed = t.speed ?? 0;
  const lateral = speed * Math.sin(((course + 90 - azi0) * Math.PI) / 180);
  const { yy, jzt } = input;
  const r = input.rect;
  return [
    input.seq,
    fmt6(shipLon),
    fmt6(shipLat),
    fmt6(shipsize),
    fmt6(sizeRadian),
    fmt6(distance),
    fmt6(azi0),
    fmt6(yy.lon),
    fmt6(yy.lat),
    fmt6(yy.size),
    fmt6(yy.distance),
    fmt6(yy.azimuth),
    fmt6(jzt.lon),
    fmt6(jzt.lat),
    fmt6(jzt.size),
    fmt6(jzt.distance),
    fmt6(jzt.azimuth),
    Math.trunc(r.x),
    Math.trunc(r.y),
    Math.trunc(r.width),
    Math.trunc(r.height),
    fmt6(input.p),
    fmt6(input.t),
    fmt6(input.z),
    input.shipName,
    fmt6(course),
    fmt6(speed),
    fmt6(lateral),
    input.trackTime,
    input.recordTime,
  ].join(",");
}

/** 对齐 Qt `camConf/camsky/cam{N}.txt` 一行 */
export function buildSkyCalcRecordLine(input: SkyCalcRecordInput): string {
  return [
    fmt6(input.lon),
    fmt6(input.lat),
    fmt6(input.alt),
    fmt6(input.distance),
    fmt6(input.p),
    fmt6(input.t),
    fmt6(input.z),
    input.trackTime,
    fmt6(input.selfLon),
    fmt6(input.selfLat),
    fmt6(input.selfAlt),
    input.selfPosTime,
    input.fuseId,
  ].join(",");
}

export function formatCalcRecordTimestamp(d = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ms}s`
  );
}

export function formatTrackTimeFromIso(iso: string | undefined): string {
  if (!iso) return formatCalcRecordTimestamp();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatCalcRecordTimestamp();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ms}`;
}

import { mergedDronePose } from "@/components/map/modules/drones-maplibre";
import type { Track } from "@/lib/map-entity-model";
import {
  resolveCamServerSelfPosMapId,
  trackHasSelfReportSource,
} from "@/lib/map-gis-camera-task";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import type { DroneTelemetry } from "@/stores/drone-store";
import { useDroneStore } from "@/stores/drone-store";
import { useTrackStore } from "@/stores/track-store";

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function readDroneSpeedMps(payload: Record<string, unknown> | null | undefined): number {
  if (!payload) return 0;
  const direct = Number(payload.speed ?? payload.ground_speed ?? payload.groundSpeed);
  if (Number.isFinite(direct)) return direct;
  const sx = Number(payload.speed_x ?? 0);
  const sy = Number(payload.speed_y ?? 0);
  const sz = Number(payload.speed_z ?? 0);
  const v = Math.sqrt(sx * sx + sy * sy + sz * sz);
  return Number.isFinite(v) ? v : 0;
}

function readDroneAltitudeM(payload: Record<string, unknown> | null | undefined): number | undefined {
  if (!payload) return undefined;
  const h = Number(payload.height ?? payload.altitude ?? payload.alt ?? 0);
  return Number.isFinite(h) ? h : undefined;
}

function collectDroneMatchTokens(sn: string): string[] {
  const ds = useDroneStore.getState();
  const tokens = new Set<string>();
  const trimmed = sn.trim();
  if (trimmed) tokens.add(trimmed);
  const displayName = ds.drones[trimmed]?.displayName?.trim();
  if (displayName) tokens.add(displayName);
  for (const [eid, mapped] of Object.entries(ds.entityIdToDeviceSn)) {
    if (mapped === trimmed && eid.trim()) tokens.add(eid.trim());
  }
  return [...tokens];
}

function trackMetadataBlob(t: Track): string {
  return [t.name, t.trackAlias, t.sensor, t.targetType, t.showID, t.uniqueID, t.trackId]
    .filter((v) => v != null && String(v).trim() !== "")
    .join(" ");
}

function trackMatchesDroneTokens(t: Track, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const blob = trackMetadataBlob(t);
  return tokens.some((tok) => tok && blob.includes(tok));
}

function isSelfReportLayerTrack(t: Track): boolean {
  if (resolveTrackLayerKey(t) === "uav_pose_track") return true;
  return trackHasSelfReportSource(t);
}

function mergeDronePoseIntoTrack(
  track: Track,
  tele: DroneTelemetry,
  pose: { lat: number; lng: number; headingDeg: number },
): Track {
  const posePayload = tele.highFreq ?? tele.status;
  const speed = readDroneSpeedMps(posePayload);
  const altitude = readDroneAltitudeM(posePayload);
  const selfPosId = resolveCamServerSelfPosMapId(track);
  const idStr = selfPosId != null ? String(selfPosId) : track.showID;
  return {
    ...track,
    id: idStr,
    showID: idStr,
    ...(selfPosId != null ? { uniqueID: idStr, trackId: idStr } : {}),
    lat: pose.lat,
    lng: pose.lng,
    heading: pose.headingDeg,
    course: pose.headingDeg,
    speed,
    ...(altitude !== undefined ? { altitude } : {}),
    isAirTrack: true,
    isUav: true,
    trackLayerKey: track.trackLayerKey ?? "uav_pose_track",
  };
}

function buildSyntheticSelfReportTrack(
  sn: string,
  tele: DroneTelemetry,
  pose: { lat: number; lng: number; headingDeg: number },
): Track {
  const posePayload = tele.highFreq ?? tele.status;
  const label = tele.displayName?.trim() || sn;
  return {
    id: `drone-self-report:${sn}`,
    showID: `drone-self-report:${sn}`,
    uniqueID: "",
    name: label,
    type: "air",
    disposition: "friendly",
    lat: pose.lat,
    lng: pose.lng,
    heading: pose.headingDeg,
    course: pose.headingDeg,
    speed: readDroneSpeedMps(posePayload),
    sensor: "自报位",
    lastUpdate: tele.updatedAt,
    starred: false,
    isAirTrack: true,
    isUav: true,
    trackLayerKey: "uav_pose_track",
    ...(readDroneAltitudeM(posePayload) !== undefined
      ? { altitude: readDroneAltitudeM(posePayload) }
      : {}),
  };
}

const TOKEN_MATCH_MAX_DISTANCE_M = 800;
const PROXIMITY_MATCH_MAX_DISTANCE_M = 250;

/**
 * 地图无人机自报位/高频图标 → 相机跟踪用航迹快照。
 * 优先匹配 store 中 `uav_pose_track` / 含自报位源的航迹（按 SN/entityId/名称或近距离），
 * 坐标与速度取当前高频/状态；无匹配时合成自报位航迹（仅 IM，POS 可能因无 numeric target_id 跳过）。
 */
export function resolveTrackForDroneSelfReport(sn: string): Track | null {
  const trimmedSn = sn.trim();
  if (!trimmedSn) return null;

  const tele = useDroneStore.getState().drones[trimmedSn];
  if (!tele) return null;

  const pose = mergedDronePose(tele);
  if (!pose) return null;

  const tokens = collectDroneMatchTokens(trimmedSn);
  const tracks = useTrackStore.getState().tracks;
  const selfReportTracks = tracks.filter(isSelfReportLayerTrack);

  for (const t of selfReportTracks) {
    if (!trackMatchesDroneTokens(t, tokens)) continue;
    const d = haversineM(pose.lat, pose.lng, t.lat, t.lng);
    if (d <= TOKEN_MATCH_MAX_DISTANCE_M) {
      return mergeDronePoseIntoTrack(t, tele, pose);
    }
  }

  let bestProx: Track | null = null;
  let bestDist = Infinity;
  for (const t of selfReportTracks) {
    const d = haversineM(pose.lat, pose.lng, t.lat, t.lng);
    if (d <= PROXIMITY_MATCH_MAX_DISTANCE_M && d < bestDist) {
      bestDist = d;
      bestProx = t;
    }
  }
  if (bestProx) return mergeDronePoseIntoTrack(bestProx, tele, pose);

  return buildSyntheticSelfReportTrack(trimmedSn, tele, pose);
}

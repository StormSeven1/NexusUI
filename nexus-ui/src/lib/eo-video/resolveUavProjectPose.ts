/**
 * 从 MQTT 遥测 / drone-store 拼出航迹投影所需姿态。
 * 优先 MQTT OSD（与周士胜算法一致）；缺字段时用 WS high_freq / drone_status 兜底。
 */

import type { UavMqttTelemetry } from "@/hooks/useUavMqttDockState";
import type { DroneTelemetry } from "@/stores/drone-store";
import { getDroneMapRenderingConfig } from "@/lib/map-app-config";
import type { UavProjectPose } from "@/lib/eo-video/uavLonLatProject";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readGimbalFromPayload(raw: Record<string, unknown> | null | undefined): {
  roll: number | null;
  pitch: number | null;
  yaw: number | null;
} {
  if (!raw) return { roll: null, pitch: null, yaw: null };
  const nested = raw.gimbal;
  const g =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : null;
  return {
    roll: num(raw.gimbal_roll ?? g?.roll),
    pitch: num(raw.gimbal_pitch ?? g?.pitch),
    yaw: num(raw.gimbal_yaw ?? g?.yaw),
  };
}

function latestDronePayload(tele: DroneTelemetry | null | undefined): Record<string, unknown> | null {
  if (!tele) return null;
  const cfg = getDroneMapRenderingConfig();
  const now = Date.now();
  if (
    tele.highFreq &&
    tele.highFreqReceivedAt != null &&
    now - tele.highFreqReceivedAt < cfg.highFreqPositionMaxAgeMs
  ) {
    return tele.highFreq;
  }
  return tele.status;
}

/**
 * 拼出完整投影姿态；任一关键字段缺失则返回 null（本帧跳过投影）。
 */
export function resolveUavProjectPose(
  mqtt: UavMqttTelemetry | null | undefined,
  droneTele: DroneTelemetry | null | undefined,
): UavProjectPose | null {
  const raw = latestDronePayload(droneTele);
  const gStore = readGimbalFromPayload(raw);

  const longitude = mqtt?.longitude ?? (raw ? num(raw.longitude ?? raw.lng ?? raw.lon) : null) ?? droneTele?.lng ?? null;
  const latitude = mqtt?.latitude ?? (raw ? num(raw.latitude ?? raw.lat) : null) ?? droneTele?.lat ?? null;
  const heightM =
    mqtt?.heightM ??
    (raw ? num(raw.height ?? raw.altitude ?? raw.alt) : null) ??
    null;

  const gimbalRollDeg = mqtt?.gimbalRollDeg ?? gStore.roll ?? 0;
  const gimbalPitchDeg = mqtt?.gimbalPitchDeg ?? gStore.pitch ?? null;
  const gimbalYawDeg =
    mqtt?.gimbalYawDeg ??
    gStore.yaw ??
    mqtt?.attitudeHeadDeg ??
    droneTele?.headingDeg ??
    null;

  if (
    longitude == null ||
    latitude == null ||
    heightM == null ||
    !Number.isFinite(heightM) ||
    gimbalPitchDeg == null ||
    gimbalYawDeg == null
  ) {
    return null;
  }
  if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) return null;

  return {
    longitude,
    latitude,
    heightM,
    gimbalRollDeg,
    gimbalPitchDeg,
    gimbalYawDeg,
  };
}

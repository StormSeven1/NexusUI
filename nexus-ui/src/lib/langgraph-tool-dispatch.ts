/**
 * LangGraph SSE `tool_call` 与 Qt `GPTInterfaceWgt.cpp` 中 `finished` 后发射信号再统计的逻辑对齐：
 * 在 Web 端直接根据当前 `useTrackStore` 航迹计算并生成用户可见文案（不依赖工作流里的进度字符串）。
 */

import {
  dispatchLangGraphUavControl,
  langGraphCommandToUavAction,
} from "@/lib/langgraph-eo-uav-command-bridge";
import type { Track } from "@/lib/map-entity-model";
import { useTrackStore } from "@/stores/track-store";

/** 与 C++ `slot_FindTragetsInMile` 一致：`mile * 1.85 * 1000`（海里→米阈值） */
function nauticalMilesToThresholdMeters(nm: number): number {
  return nm * 1.85 * 1000;
}

/** 与 C++ `slot_FindTragetsOverSpeed` 一致：节→m/s 阈值 `speed * 1.852 / 3.6` */
function knotsToSpeedMps(kn: number): number {
  return (kn * 1.852) / 3.6;
}

function parseNumberish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.replace(/[^\d.-]/g, "");
    if (!m) return null;
    const n = parseFloat(m);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function countByDistance(tracks: Track[], thresholdM: number, comparison: string): number {
  let n = 0;
  for (const t of tracks) {
    const d = t.distance;
    if (d == null || !Number.isFinite(d)) continue;
    if (comparison === "less_than") {
      if (d < thresholdM) n++;
    } else if (comparison === "greater_than") {
      if (d > thresholdM) n++;
    }
  }
  return n;
}

function countBySpeed(tracks: Track[], thresholdMps: number, comparison: string): number {
  let n = 0;
  for (const t of tracks) {
    const sp = t.speed;
    if (!Number.isFinite(sp)) continue;
    if (comparison === "greater_than") {
      if (sp > thresholdMps) n++;
    } else if (comparison === "less_than") {
      if (sp < thresholdMps) n++;
    }
  }
  return n;
}

function findTrackById(idStr: string): Track | null {
  const id = idStr.trim();
  if (!id) return null;
  const tracks = useTrackStore.getState().tracks;
  for (const t of tracks) {
    if (t.showID === id || t.uniqueID === id || t.trackId === id) return t;
    if (t.trackId != null && String(t.trackId) === id) return t;
  }
  return null;
}

/**
 * 处理 LangGraph `event === "tool_call"` 时 `data` 对象（含 `matched_command`、`extracted_parameters`）。
 * @returns 要追加到助手气泡的文案；不需要追加则返回 null
 */
export async function executeLangGraphToolCallFromData(
  data: Record<string, unknown>,
): Promise<string | null> {
  const cmd = String(data.matched_command ?? "").trim();
  if (!cmd) return null;

  const ex = (data.extracted_parameters as Record<string, unknown>) ?? {};
  const tracks = useTrackStore.getState().tracks;

  if (cmd === "target_query_by_distance") {
    const mile = parseNumberish(ex.distance);
    if (mile == null) return null;
    const comparison = String(ex.comparison ?? "less_than").trim() || "less_than";
    const thresholdM = nauticalMilesToThresholdMeters(mile);
    const num = countByDistance(tracks, thresholdM, comparison);
    if (comparison === "greater_than") {
      return `${mile}海里以外的目标有${num}个`;
    }
    return `${mile}海里以内的目标有${num}个`;
  }

  if (cmd === "target_query_by_speed") {
    const speedKn = parseNumberish(ex.speed);
    if (speedKn == null) return null;
    const comparison = String(ex.comparison ?? "greater_than").trim() || "greater_than";
    const thresholdMps = knotsToSpeedMps(speedKn);
    const num = countBySpeed(tracks, thresholdMps, comparison);
    if (comparison === "greater_than") {
      return `高于${speedKn}节的目标有${num}个`;
    }
    return `低于${speedKn}节的目标有${num}个`;
  }

  if (cmd === "target_query_details") {
    const tid =
      ex.target_id != null
        ? typeof ex.target_id === "string"
          ? ex.target_id
          : String(ex.target_id)
        : "";
    const t = findTrackById(tid);
    if (!t) {
      return `未在当前航迹列表中找到目标 id=${tid}。`;
    }
    const lat = t.lat;
    const lng = t.lng;
    const dis = t.distance;
    const az = t.azimuth;
    const sp = t.speed;
    const parts = [
      `目标 ${tid}`,
      `经度 ${lng.toFixed(3)}°，纬度 ${lat.toFixed(3)}°`,
      dis != null && Number.isFinite(dis) ? `距离 ${dis.toFixed(1)} m` : null,
      az != null && Number.isFinite(az) ? `方位 ${az.toFixed(1)}°` : null,
      Number.isFinite(sp) ? `速度 ${sp.toFixed(2)} m/s` : null,
    ].filter(Boolean);
    return parts.join("，");
  }

  const uavAction = langGraphCommandToUavAction(cmd);
  if (uavAction) {
    const result = await dispatchLangGraphUavControl(uavAction);
    return result.message;
  }

  return `已识别指令「${cmd}」，Web 端暂未实现与 Qt 完全相同的地图联动；可在后续版本接线。`;
}

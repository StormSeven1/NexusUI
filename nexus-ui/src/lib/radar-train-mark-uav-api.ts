/**
 * 探鸟雷达训练真值：手动「标为无人机」API（CustomBackend /api/radar-train-labels）。
 */
import { getHttpConfig } from "@/lib/map-app-config";
import type { Track } from "@/lib/map-entity-model";
import {
  extractBirdPihaoFromFusion,
  isBirdRadarFusionSourceItem,
} from "@/lib/fuse-air-bird-capture";
import { resolveUniqueIdFromTrack } from "@/lib/alarm-confirm-api";

function backendBase(): string {
  return getHttpConfig().backendUrl.replace(/\/$/, "");
}

export type MarkFuseAirUavResult =
  | { ok: true; pihao: number; message: string }
  | { ok: false; message: string };

function birdSourceMeta(track: Track): { name?: string; dataSourceId?: string } {
  const item = track.fusionSources?.find(isBirdRadarFusionSourceItem);
  if (!item) return {};
  return {
    name: item.sourceName ? String(item.sourceName) : undefined,
    dataSourceId: item.dataSourceId != null ? String(item.dataSourceId) : undefined,
  };
}

/** 从对空融合航迹解析探鸟批号；无探鸟源则无法写入 CSV is_uav */
export function resolveFuseAirBirdPihaoForMark(track: Track): number | null {
  return extractBirdPihaoFromFusion(track);
}

export async function markFuseAirTrackAsUav(track: Track): Promise<MarkFuseAirUavResult> {
  const pihao = resolveFuseAirBirdPihaoForMark(track);
  if (pihao == null) {
    return { ok: false, message: "当前对空融合航迹无探鸟批号，无法标记（CSV is_uav 按探鸟批号写入）" };
  }
  const bird = birdSourceMeta(track);
  const uniqueId = resolveUniqueIdFromTrack(track);
  try {
    const res = await fetch(`${backendBase()}/api/radar-train-labels/mark-uav`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pihao,
        fuse_unique_id: uniqueId,
        fuse_track_id: track.trackId ?? track.uniqueID ?? track.showID,
        show_id: track.showID,
        bird_radar_source_name: bird.name,
        bird_radar_data_source_id: bird.dataSourceId,
        fusion_sources: track.fusionSources ?? [],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      detail?: string;
    };
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        message: String(data.message ?? data.detail ?? `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      pihao,
      message: String(data.message ?? `已标为无人机（批号 ${pihao}）`),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function unmarkFuseAirTrackAsUav(pihao: number): Promise<MarkFuseAirUavResult> {
  const p = Math.trunc(Number(pihao));
  if (!Number.isFinite(p) || p <= 0) {
    return { ok: false, message: "无效探鸟批号" };
  }
  try {
    const res = await fetch(`${backendBase()}/api/radar-train-labels/unmark-uav`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pihao: p }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      detail?: string;
    };
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        message: String(data.message ?? data.detail ?? `HTTP ${res.status}`),
      };
    }
    return {
      ok: true,
      pihao: p,
      message: String(data.message ?? `已取消无人机标记（批号 ${p}）`),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

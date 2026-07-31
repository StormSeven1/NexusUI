/**
 * 对空融合航迹探鸟采集条件：
 * - 自动：自报位 + 探鸟雷达
 * - 手动：右键「标为无人机」（有探鸟批号即可）
 */
import type { Track, TrackFusionSourceItem } from "@/lib/map-entity-model";
import { trackHasSelfReportSource } from "@/lib/map-gis-camera-task";
import { resolveTrackLayerKey, type TrackLayerResolveInput } from "@/lib/track-layer-visibility";

export function isBirdRadarFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim();
  if (name.includes("探鸟")) return true;
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  if (ds === "9" || ds === "bird_radar" || ds === "birdradar") return true;
  if (ds.includes("bird") && ds.includes("radar")) return true;
  return false;
}

export type FuseAirBirdCaptureCandidate = {
  fuseTrackId: string;
  birdPihao: number;
  selfReportIds: number[];
  /** auto=自报位+探鸟；manual=右键标为无人机 */
  source: "auto" | "manual";
};

export function extractBirdPihaoFromFusion(track: Track): number | null {
  const item = track.fusionSources?.find(isBirdRadarFusionSourceItem);
  if (!item?.trackId) return null;
  const n = Number(String(item.trackId).trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** 自动条件：对空融合同时含自报位 + 探鸟 */
export function fuseAirTrackQualifiesForBirdCapture(
  track: TrackLayerResolveInput & Pick<Track, "fusionSources" | "sensor">,
): boolean {
  if (resolveTrackLayerKey(track) !== "fuse_air") return false;
  if (!trackHasSelfReportSource(track)) return false;
  return track.fusionSources?.some(isBirdRadarFusionSourceItem) ?? false;
}

function collectSelfReportIds(track: Track): number[] {
  const selfReportIds: number[] = [];
  for (const fs of track.fusionSources ?? []) {
    if (!String(fs.sourceName ?? "").includes("自报位")) continue;
    const id = Number(String(fs.trackId ?? "").trim());
    if (Number.isFinite(id) && id > 0) selfReportIds.push(Math.trunc(id));
  }
  return selfReportIds;
}

/**
 * 可开始采集的候选：自动真值 ∪ 本地已手动标记的对空融合（有探鸟批号）。
 * @param manualPihaoByShowId 右键「标为无人机」本地缓存（showID → 探鸟批号）
 */
export function listFuseAirBirdCaptureCandidates(
  tracks: readonly Track[],
  manualPihaoByShowId: Record<string, number> = {},
): FuseAirBirdCaptureCandidate[] {
  const byPihao = new Map<number, FuseAirBirdCaptureCandidate>();

  for (const t of tracks) {
    if (fuseAirTrackQualifiesForBirdCapture(t)) {
      const birdPihao = extractBirdPihaoFromFusion(t);
      if (birdPihao == null) continue;
      byPihao.set(birdPihao, {
        fuseTrackId: t.showID || t.uniqueID || String(birdPihao),
        birdPihao,
        selfReportIds: collectSelfReportIds(t),
        source: "auto",
      });
    }
  }

  for (const t of tracks) {
    if (resolveTrackLayerKey(t) !== "fuse_air") continue;
    const marked = manualPihaoByShowId[t.showID];
    const birdPihao =
      typeof marked === "number" && marked > 0 ? marked : extractBirdPihaoFromFusion(t);
    if (birdPihao == null) continue;
    // 本地已标记，或 marked 表里有该 showID
    if (typeof marked !== "number" || marked <= 0) continue;
    if (byPihao.has(birdPihao)) continue;
    byPihao.set(birdPihao, {
      fuseTrackId: t.showID || t.uniqueID || String(birdPihao),
      birdPihao,
      selfReportIds: collectSelfReportIds(t),
      source: "manual",
    });
  }

  // 仅有本地标记、航迹已消失时：仍允许凭标记批号通过前端预检（后端真值表为准）
  for (const [showId, pihao] of Object.entries(manualPihaoByShowId)) {
    const p = Math.trunc(Number(pihao));
    if (!Number.isFinite(p) || p <= 0) continue;
    if (byPihao.has(p)) continue;
    byPihao.set(p, {
      fuseTrackId: showId || String(p),
      birdPihao: p,
      selfReportIds: [],
      source: "manual",
    });
  }

  return [...byPihao.values()].sort((a, b) => a.birdPihao - b.birdPihao);
}

export function describeBirdCaptureBlockReason(
  tracks: readonly Track[],
  manualPihaoByShowId: Record<string, number> = {},
): string {
  if (Object.keys(manualPihaoByShowId).length > 0) {
    return "后端暂无可用无人机真值，请稍后重试或重新「标为无人机」";
  }
  const fuseAir = tracks.filter((t) => resolveTrackLayerKey(t) === "fuse_air");
  if (fuseAir.length === 0) {
    return "当前没有对空融合航迹；可对含探鸟源的对空融合右键「标为无人机」后再采";
  }
  const withBird = fuseAir.filter((t) => t.fusionSources?.some(isBirdRadarFusionSourceItem));
  if (withBird.length === 0) {
    return "当前对空融合不含探鸟雷达来源，无法标记/采集";
  }
  const withSelf = withBird.filter((t) => trackHasSelfReportSource(t));
  if (withSelf.length === 0) {
    return "当前没有自报位+探鸟融合；请对目标右键「标为无人机」后再开始采集";
  }
  return "无法开始探鸟采集";
}

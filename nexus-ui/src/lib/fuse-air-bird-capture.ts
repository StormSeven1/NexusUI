/**
 * 对空融合航迹是否满足「自报位 + 探鸟雷达」探鸟采集条件。
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
};

export function extractBirdPihaoFromFusion(track: Track): number | null {
  const item = track.fusionSources?.find(isBirdRadarFusionSourceItem);
  if (!item?.trackId) return null;
  const n = Number(String(item.trackId).trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function fuseAirTrackQualifiesForBirdCapture(
  track: TrackLayerResolveInput & Pick<Track, "fusionSources" | "sensor">,
): boolean {
  if (resolveTrackLayerKey(track) !== "fuse_air") return false;
  if (!trackHasSelfReportSource(track)) return false;
  return track.fusionSources?.some(isBirdRadarFusionSourceItem) ?? false;
}

export function listFuseAirBirdCaptureCandidates(tracks: readonly Track[]): FuseAirBirdCaptureCandidate[] {
  const out: FuseAirBirdCaptureCandidate[] = [];
  for (const t of tracks) {
    if (!fuseAirTrackQualifiesForBirdCapture(t)) continue;
    const birdPihao = extractBirdPihaoFromFusion(t);
    if (birdPihao == null) continue;
    const selfReportIds: number[] = [];
    for (const fs of t.fusionSources ?? []) {
      if (!String(fs.sourceName ?? "").includes("自报位")) continue;
      const id = Number(String(fs.trackId ?? "").trim());
      if (Number.isFinite(id) && id > 0) selfReportIds.push(Math.trunc(id));
    }
    out.push({
      fuseTrackId: t.showID || t.uniqueID || String(birdPihao),
      birdPihao,
      selfReportIds,
    });
  }
  return out;
}

export function describeBirdCaptureBlockReason(tracks: readonly Track[]): string {
  const fuseAir = tracks.filter((t) => resolveTrackLayerKey(t) === "fuse_air");
  if (fuseAir.length === 0) {
    return "当前没有对空融合航迹，无法开始探鸟采集";
  }
  const withSelf = fuseAir.filter((t) => trackHasSelfReportSource(t));
  if (withSelf.length === 0) {
    return "当前对空融合航迹中没有带自报位的无人机，无法开始探鸟采集";
  }
  const withBird = withSelf.filter((t) => t.fusionSources?.some(isBirdRadarFusionSourceItem));
  if (withBird.length === 0) {
    return "当前融合航迹不含探鸟雷达来源，无法开始探鸟采集";
  }
  return "无法开始探鸟采集";
}

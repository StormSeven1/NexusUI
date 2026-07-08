import type { Track } from "@/lib/map-entity-model";
import { bearingDegFromPoint, haversineDistanceM } from "@/lib/eo-calc-record/geo";

export type FusionRadarSlice = {
  lon: number;
  lat: number;
  size: number;
  distance: number;
  azimuth: number;
};

const EMPTY_SLICE: FusionRadarSlice = {
  lon: 0,
  lat: 0,
  size: 0,
  distance: 0,
  azimuth: 0,
};

function layerFromFusionItem(item: { sourceName?: string; dataSourceId?: string | number }): "wharf" | "jingzi" | null {
  const name = String(item.sourceName ?? "").toLowerCase();
  const ds = String(item.dataSourceId ?? "").toLowerCase();
  const blob = `${name} ${ds}`;
  if (/jingzi|靖子|radar_track2|radar2/.test(blob)) return "jingzi";
  if (/wharf|码头|yuanyao|远遥|radar_track1|radar1/.test(blob)) return "wharf";
  return null;
}

function findRadarTrackByFusionId(tracks: readonly Track[], fusionTrackId: string | number | undefined, layer: "wharf" | "jingzi"): Track | null {
  if (fusionTrackId == null) return null;
  const tid = String(fusionTrackId).trim();
  if (!tid) return null;
  const layerKey = layer === "wharf" ? "radar_wharf" : "radar_jingzi";
  for (const t of tracks) {
    if (t.trackLayerKey !== layerKey) continue;
    if (t.trackId === tid || t.showID === tid || t.uniqueID === tid) return t;
  }
  return null;
}

function sliceFromTrack(t: Track | null, camLat: number, camLng: number, radarLat?: number, radarLng?: number): FusionRadarSlice {
  if (!t) return { ...EMPTY_SLICE };
  const refLat = radarLat ?? camLat;
  const refLng = radarLng ?? camLng;
  const distance =
    t.distance != null && Number.isFinite(t.distance)
      ? t.distance
      : haversineDistanceM(refLat, refLng, t.lat, t.lng);
  const azimuth =
    t.azimuth != null && Number.isFinite(t.azimuth)
      ? t.azimuth
      : bearingDegFromPoint(refLat, refLng, t.lat, t.lng);
  return {
    lon: t.lng,
    lat: t.lat,
    size: 0,
    distance,
    azimuth,
  };
}

/**
 * 从融合航迹 `fusionSources` 解析远遥(码头)/靖子头雷达分量，对齐 Qt `fusion.trackID[0]` / `[2]`。
 */
export function resolveFusionRadarSources(
  fuseTrack: Track,
  allTracks: readonly Track[],
  camLat: number,
  camLng: number,
): { yy: FusionRadarSlice; jzt: FusionRadarSlice } {
  const sources = fuseTrack.fusionSources ?? [];
  let yyTrack: Track | null = null;
  let jztTrack: Track | null = null;

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]!;
    const layer = layerFromFusionItem(s);
    if (layer === "wharf" && !yyTrack) {
      yyTrack = findRadarTrackByFusionId(allTracks, s.trackId, "wharf");
    } else if (layer === "jingzi" && !jztTrack) {
      jztTrack = findRadarTrackByFusionId(allTracks, s.trackId, "jingzi");
    }
    if (i === 0 && !yyTrack) yyTrack = findRadarTrackByFusionId(allTracks, s.trackId, "wharf");
    if (i === 2 && !jztTrack) jztTrack = findRadarTrackByFusionId(allTracks, s.trackId, "jingzi");
  }

  return {
    yy: sliceFromTrack(yyTrack, camLat, camLng),
    jzt: sliceFromTrack(jztTrack, camLat, camLng, camLat, camLng),
  };
}

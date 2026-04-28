import { getTrackIdModeConfig } from "@/lib/map-app-config";
import type { Track } from "@/lib/map-entity-model";

/** 一键处置 POST body.targetInfo（与 V2 buildOneClickDisposalRequestBody 对齐） */
export function buildTargetInfoFromTrack(track: Track) {
  const { distinguishSeaAir } = getTrackIdModeConfig();
  const isAir = track.isAirTrack === true;
  let targetId: string;
  if (distinguishSeaAir) {
    targetId = isAir ? String(track.trackId || track.id) : String(track.uniqueID || track.id);
  } else {
    targetId = String(track.trackId || track.uniqueID || track.id);
  }
  return {
    targetId,
    targetType: isAir ? 1 : 0,
    longitude: track.lng,
    latitude: track.lat,
    speed: track.speed,
    course: track.course ?? track.heading,
  };
}

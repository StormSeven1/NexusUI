import type { Track } from "@/lib/map-entity-model";

/** 一键处置 POST body.targetInfo（与 V2 buildOneClickDisposalRequestBody 对齐） */
export function buildTargetInfoFromTrack(track: Track) {
  const isAir = track.isAirTrack === true;
  const targetId = String(track.uniqueID || track.showID || track.id);
  return {
    targetId,
    targetType: isAir ? 1 : 0,
    longitude: track.lng,
    latitude: track.lat,
    speed: track.speed,
    course: track.course ?? track.heading,
  };
}

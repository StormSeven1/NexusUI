import type { Track } from "@/lib/map-entity-model";
import {
  buildAimTrackCollectMapDblClickPayload,
  isAimTrackCollectStandaloneMapDblClickTrack,
  isSelfReportStandaloneTrack,
  parseEoCameraIndex,
  resolveAimTrackCollectMapDblClickDomainType,
  resolveAimTrackCollectMapDblClickFusionId,
  resolveAimTrackCollectRadarSourcesSuffix,
} from "@/lib/eo-aim-collect/buildAimTrackCollectPayload";
import { listTrackTaskOwnerEntityIds } from "@/lib/entities-track-task-cache";
import { useTrackStore } from "@/stores/track-store";

/**
 * 态势双击：对 hasPtz、无 parent、非第三方相机发 StreamTrack（triggerType=3）。
 * - 对空融合：首段 `1_融合ID`，末段 `0_自报位_1_探鸟_2_KU`（缺源填 0）。
 * - 独立自报位 / 探鸟 / KU：默认融合 ID=0 + 仅对应槽；若挂到对空融合则填融合 ID 与三源。
 * - 对海 / 远遥：保持原协议（0=AIS，1=远遥，2=靖子头）。
 * - 自报位双击：aimType=2；其余空中 aimType=1。
 */
export async function dispatchAimTrackCollectMapDblClick(track: Track): Promise<void> {
  const owners = listTrackTaskOwnerEntityIds();
  if (owners.length === 0) {
    console.warn("[map-track-dblclick] ③ triggerType=3 跳过：无光电主相机");
    return;
  }

  const allTracks = useTrackStore.getState().tracks;
  const isStandalone = isAimTrackCollectStandaloneMapDblClickTrack(track);
  const fusionExternalTargetId = resolveAimTrackCollectMapDblClickFusionId(track, allTracks);
  const radarSourcesSuffix = resolveAimTrackCollectRadarSourcesSuffix(track, allTracks);
  const domainType = resolveAimTrackCollectMapDblClickDomainType(track, allTracks);
  // 自报位（船/无人机）双击：aimType=2（与对海0/对空1区分）
  const aimType = isSelfReportStandaloneTrack(track) ? 2 : domainType;

  if (!isStandalone && (fusionExternalTargetId == null || fusionExternalTargetId <= 0)) {
    console.warn("[map-track-dblclick] ③ triggerType=3 跳过：缺少融合 external_target_id（同 check）", {
      showID: track.showID,
      trackId: track.trackId,
      externalTargetId: track.externalTargetId,
      trackLayerKey: track.trackLayerKey,
    });
    return;
  }

  console.log("[map-track-dblclick] ③ triggerType=3 →", owners.join(", "), {
    isStandalone,
    domainType,
    aimType,
    fusionExternalTargetId: fusionExternalTargetId ?? 0,
    radarSourcesSuffix,
    sensor: track.sensor,
    fusionSources: track.fusionSources,
    trackLayerKey: track.trackLayerKey,
  });

  // 串行：gRPC StreamTrack 单飞，并发会 busy→502
  for (const ownerId of owners) {
    if (parseEoCameraIndex(ownerId) == null) continue;
    try {
      const payload = buildAimTrackCollectMapDblClickPayload({
        entityId: ownerId,
        targetTrack: track,
        fusionExternalTargetId: fusionExternalTargetId ?? 0,
        radarSourcesSuffix,
        domainType,
        aimType,
      });
      console.info("[map-track-dblclick] ③ send", {
        ownerId,
        cameraIndex: payload.cameraIndex,
        aimType: payload.aimType,
        triggerType: payload.triggerType,
        trackPoints: payload.trackPoints,
      });
      const res = await fetch("/api/eo-aim-track-collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || data.ok === false) {
        console.warn("[map-track-dblclick] ③ fail", ownerId, data.detail || data.error || res.status);
        continue;
      }
      console.log("[map-track-dblclick] ③ ok", ownerId);
    } catch (err: unknown) {
      console.warn("[map-track-dblclick] ③ error", ownerId, err);
    }
  }
}

import type { Track } from "@/lib/map-entity-model";
import {
  buildAimTrackCollectMapDblClickPayload,
  parseEoCameraIndex,
  resolveAimTrackCollectFusionExternalTargetId,
  resolveAimTrackCollectRadarSourcesSuffix,
} from "@/lib/eo-aim-collect/buildAimTrackCollectPayload";
import { listTrackTaskOwnerEntityIds } from "@/lib/entities-track-task-cache";

/**
 * 态势双击：对 hasPtz、无 parent、非第三方相机发 StreamTrack（triggerType=3）。
 * trackPoints 中融合/三源雷达 ID 与光电界面对准采集 check（triggerType=1）同源解析。
 */
export async function dispatchAimTrackCollectMapDblClick(track: Track): Promise<void> {
  const owners = listTrackTaskOwnerEntityIds();
  if (owners.length === 0) {
    console.warn("[map-track-dblclick] ③ triggerType=3 跳过：无光电主相机");
    return;
  }

  const fusionExternalTargetId = resolveAimTrackCollectFusionExternalTargetId(track);
  const radarSourcesSuffix = resolveAimTrackCollectRadarSourcesSuffix(track);

  if (fusionExternalTargetId == null || fusionExternalTargetId <= 0) {
    console.warn("[map-track-dblclick] ③ triggerType=3 跳过：缺少融合 external_target_id（同 check）", {
      showID: track.showID,
      trackId: track.trackId,
      externalTargetId: track.externalTargetId,
    });
    return;
  }

  console.log("[map-track-dblclick] ③ triggerType=3 →", owners.join(", "), {
    fusionExternalTargetId,
    radarSourcesSuffix,
    sensor: track.sensor,
    fusionSources: track.fusionSources,
  });

  await Promise.all(
    owners.map(async (ownerId) => {
      if (parseEoCameraIndex(ownerId) == null) return;
      try {
        const payload = buildAimTrackCollectMapDblClickPayload({
          entityId: ownerId,
          targetTrack: track,
          fusionExternalTargetId,
          radarSourcesSuffix,
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
          return;
        }
        console.log("[map-track-dblclick] ③ ok", ownerId);
      } catch (err: unknown) {
        console.warn("[map-track-dblclick] ③ error", ownerId, err);
      }
    }),
  );
}

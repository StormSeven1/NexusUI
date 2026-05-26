import type { Track } from "@/lib/map-entity-model";
import {
  buildImportantTrackTaskBody,
  CameraManagementClient,
} from "@/lib/camera-management-client";
import {
  ensureEntitiesTrackTaskCache,
  listTrackTaskOwnerEntityIds,
} from "@/lib/entities-track-task-cache";
import {
  buildImportantTrackTargetFromTrack,
  buildThirdPartyPosFieldsFromTrack,
} from "@/lib/map-gis-camera-task";
import { postThirdPartyPosTask } from "@/lib/eo-video/thirdPartyPosTaskClient";
import { evaluateThirdPartyTaskHttpResponse } from "@/lib/thirdPartyTaskServiceResponse";
import { resolveShowIdFromAlarm } from "@/lib/alarm-track-match";
import { getDefaultEoCameraTaskBackendBaseUrl, getTrackIdModeConfig } from "@/lib/map-app-config";
import type { AlertData } from "@/stores/alert-store";
import { getRenderCache } from "@/stores/track-store";
import { useTargetProfileStore } from "@/stores/target-profile-store";
import { useDockStore } from "@/stores/dock-store";
import { useAppConfigStore } from "@/stores/app-config-store";

/**
 * 告警 trackId → 航迹 showID（与 AlertPanel / 地图选中一致）。
 */
export function resolveShowIdFromAlarmTrackId(
  alarmTrackId: string,
  shadowTracks: ReadonlyMap<string, Track>,
  alertHint?: Pick<AlertData, "uniqueID" | "fuseType">,
): string | null {
  if (alertHint?.uniqueID || alertHint?.fuseType === 0 || alertHint?.fuseType === 1) {
    return resolveShowIdFromAlarm({ trackId: alarmTrackId, ...alertHint }, shadowTracks);
  }
  if (!getTrackIdModeConfig().distinguishSeaAir) {
    return resolveShowIdFromAlarm({ trackId: alarmTrackId }, shadowTracks);
  }
  if (getRenderCache().has(alarmTrackId)) return alarmTrackId;
  if (shadowTracks.has(alarmTrackId)) return alarmTrackId;
  for (const [, t] of getRenderCache()) {
    if (t.trackId === alarmTrackId) return t.showID;
  }
  for (const [, t] of shadowTracks) {
    if (t.trackId === alarmTrackId) return t.showID;
  }
  return null;
}

/** 告警 trackId → 航迹对象（渲染层优先，其次影子层） */
export function resolveTrackFromAlarmTrackId(
  alarmTrackId: string,
  shadowTracks: ReadonlyMap<string, Track>,
  alertHint?: Pick<AlertData, "uniqueID" | "fuseType">,
): Track | null {
  const showId = resolveShowIdFromAlarmTrackId(alarmTrackId, shadowTracks, alertHint);
  if (!showId) return null;
  return getRenderCache().get(showId) ?? shadowTracks.get(showId) ?? null;
}

/**
 * GIS 双击航迹查证：打开目标档案 + 智能助手，下发 POS 与重点关注采集任务。
 * 与 `Map2D` 航迹 `dblclick` 行为一致。
 */
async function dispatchThirdPartyPosTaskLogged(
  posFields: NonNullable<ReturnType<typeof buildThirdPartyPosFieldsFromTrack>>,
  posBackend: string,
): Promise<void> {
  const posBffBody = {
    backendBaseUrl: posBackend,
    ownerEntityId: "",
    specEntityId: "",
    ...posFields,
  };
  console.log(
    "[map-track-dblclick] ① ThirdPartyCamPosTask（第三方高速相机 POS）→ POST /api/camera-task/third-party-pos\n",
    JSON.stringify(posBffBody, null, 2),
  );
  console.log("[map-track-dblclick] ① 上游", `${posBackend}/api/v1/tasks`);
  try {
    const res = await postThirdPartyPosTask({
      backendBaseUrl: posBackend,
      fields: posFields,
    });
    const text = await res.text().catch(() => "");
    const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
    console.log("[map-track-dblclick] ① ThirdPartyCamPosTask 响应", {
      httpStatus: res.status,
      accepted: outcome.accepted,
      summary: outcome.logLine,
      bodyPreview: text.slice(0, 600),
    });
  } catch (err: unknown) {
    console.warn("[map-track-dblclick] ① ThirdPartyCamPosTask 请求异常", err);
  }
}

export async function runGisTrackVerification(track: Track): Promise<void> {
  useTargetProfileStore.getState().setFocusedShowId(track.showID);
  const dock = useDockStore.getState();
  dock.assignPanelToPartition("target-profile", "right-0");
  dock.assignPanelToPartition("chat", "right-1");

  const cfg = await useAppConfigStore.getState().ensureLoaded();
  const target = buildImportantTrackTargetFromTrack(track);
  const posBackend = getDefaultEoCameraTaskBackendBaseUrl();
  const posFields = buildThirdPartyPosFieldsFromTrack(track);

  console.group("[map-track-dblclick] 双击航迹 · 下发相机任务");
  console.log("航迹", {
    showID: track.showID,
    uniqueID: track.uniqueID,
    trackId: track.trackId,
    type: track.type,
    lat: track.lat,
    lng: track.lng,
    speed: track.speed,
    course: track.course ?? track.heading,
  });
  console.log(
    "[map-track-dblclick] 分路说明：① ThirdPartyCamPosTask=高速相机 UDP 引导（targetId=uniqueID）；② TargetCollectionIMChildTask=各 PTZ 主相机重点关注（trackID=trackId）",
  );
  console.log("[map-track-dblclick] ② IM 任务 targetcollection 预览", target);

  let posPromise: Promise<void>;
  if (posFields) {
    posPromise = dispatchThirdPartyPosTaskLogged(posFields, posBackend);
  } else {
    console.warn(
      "[map-track-dblclick] ① ThirdPartyCamPosTask 跳过：航迹缺少合法 uniqueID 或经纬度",
      { showID: track.showID, uniqueID: track.uniqueID, lat: track.lat, lng: track.lng },
    );
    posPromise = Promise.resolve();
  }

  const cm = cfg.cameraManagement;
  if (!cm) {
    console.warn("[map-track-dblclick] ② cameraManagement 未配置，未发送 TargetCollectionIMChildTask");
    await posPromise;
    console.groupEnd();
    return;
  }
  try {
    await ensureEntitiesTrackTaskCache();
  } catch (err: unknown) {
    console.error("[map-track-dblclick] ② 实体快照加载失败，未发送 IM 任务", err);
    await posPromise;
    console.groupEnd();
    return;
  }
  const owners = listTrackTaskOwnerEntityIds();
  if (owners.length === 0) {
    console.warn(
      "[map-track-dblclick] ② 无可用 owner（需 hasPtz=1 且 parent_device_id 为空），未发送 IM 任务",
    );
    await posPromise;
    console.groupEnd();
    return;
  }

  const client = CameraManagementClient.fromConfig(cm);
  if (!client) {
    console.warn("[map-track-dblclick] ② CameraManagementClient 初始化失败");
    await posPromise;
    console.groupEnd();
    return;
  }
  console.log(
    "[map-track-dblclick] ② TargetCollectionIMChildTask（光电 PTZ 主相机）",
    `共 ${owners.length} 台 → ${client.publishUrl}`,
    owners,
  );

  for (const ownerId of owners) {
    const body = buildImportantTrackTaskBody(cm, ownerId, target, { taskIdSuffix: ownerId });
    console.log(
      `[map-track-dblclick] ② TargetCollectionIMChildTask owner=${ownerId}\n`,
      JSON.stringify(body, null, 2),
    );
    const res = await client.publishTask(body);
    if (res.networkError) {
      console.warn("[map-track-dblclick] ② IM 请求失败", {
        ownerId,
        url: client.publishUrl,
        networkError: res.networkError,
      });
      continue;
    }
    console.log("[map-track-dblclick] ② IM 响应", {
      ownerId,
      status: res.status,
      ok: res.ok,
      executionState: res.executionState ?? "",
      errorMessage: res.errorMessage ?? "",
      bodyPreview: (res.rawText ?? "").slice(0, 600),
    });
  }

  await posPromise;
  console.groupEnd();
}

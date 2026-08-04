import type { Track } from "@/lib/map-entity-model";
import {
  buildImportantTrackTaskBody,
  buildLookAtChildTaskBody,
  CameraManagementClient,
} from "@/lib/camera-management-client";
import {
  ensureEntitiesTrackTaskCache,
  listTrackTaskOwnerEntityIds,
} from "@/lib/entities-track-task-cache";
import {
  buildImportantTrackTargetFromTrack,
  buildThirdPartyPosFieldsFromTrack,
  isMapTrackDblClickLookAtOnlyEligible,
  resolveCamServerSelfPosMapId,
  resolveCamServerShipTaskIds,
} from "@/lib/map-gis-camera-task";
import { postThirdPartyPosTask } from "@/lib/eo-video/thirdPartyPosTaskClient";
import { postYuan8GuideTask } from "@/lib/eo-video/yuan8TaskClient";
import { postEoBurnInPlacard } from "@/lib/eo-video/eoBurnInPlacardClient";
import { evaluateThirdPartyTaskHttpResponse } from "@/lib/thirdPartyTaskServiceResponse";
import { resolveShowIdFromAlarm } from "@/lib/alarm-track-match";
import { getDefaultEoCameraTaskBackendBaseUrl, getTrackIdModeConfig } from "@/lib/map-app-config";
import type { AlertData } from "@/stores/alert-store";
import { getRenderCache, useTrackStore } from "@/stores/track-store";
import { useTargetProfileStore } from "@/stores/target-profile-store";
import { useDockStore } from "@/stores/dock-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import { resolveTrackForDroneSelfReport } from "@/lib/resolve-track-for-drone-self-report";
import { dispatchAimTrackCollectMapDblClick } from "@/lib/eo-aim-collect/dispatchAimTrackCollectMapDblClick";

async function dispatchBurnInPlacardForOwners(
  track: Track,
  owners: readonly string[],
): Promise<void> {
  if (owners.length === 0) return;
  const allTracks = useTrackStore.getState().tracks;
  const shipTask = resolveCamServerShipTaskIds(track, allTracks);
  // 无有效航迹 ID（空白对准 / 合成自报位等）不画标牌
  if (!(shipTask.targetId > 0)) {
    console.log("[map-track-dblclick] ④ burn-in placard 跳过：无有效 trackId", {
      showID: track.showID,
      uniqueID: track.uniqueID,
      trackId: track.trackId,
    });
    return;
  }
  const isAir =
    track.type === "air" ||
    track.trackLayerKey === "fuse_air" ||
    track.trackLayerKey === "bird_radar" ||
    track.trackLayerKey === "auto_bird_radar";

  await Promise.all(
    owners.map(async (ownerId) => {
      try {
        const r = await postEoBurnInPlacard({
          entityId: ownerId,
          trackId: shipTask.targetId,
          isAir,
        });
        if (!r.ok) {
          console.warn("[map-track-dblclick] ④ burn-in placard 失败", ownerId, r.error ?? "", r.detail ?? "");
        } else {
          console.log("[map-track-dblclick] ④ burn-in placard ok", ownerId, {
            trackId: shipTask.targetId,
          });
        }
      } catch (err: unknown) {
        console.warn("[map-track-dblclick] ④ burn-in placard 异常", ownerId, err);
      }
    }),
  );
}
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
 * GIS 双击航迹查证：聚焦目标档案并下发 POS / 重点关注采集任务（不自动切到智能助手）。
 * 与 `Map2D` 航迹 `dblclick` 行为一致；查证 SSE 由 `TaskStatusVerifyChatHost` 写入会话。
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

async function dispatchYuan8GuideTaskLogged(
  track: Track,
  posBackend: string,
): Promise<void> {
  if (!Number.isFinite(track.lng) || !Number.isFinite(track.lat)) {
    console.warn("[map-track-dblclick] ①b Yuan8 GUIDE 跳过：航迹缺经纬度", {
      showID: track.showID,
      lat: track.lat,
      lng: track.lng,
    });
    return;
  }
  const body = {
    backendBaseUrl: posBackend,
    ownerEntityId: "",
    targetLon: track.lng,
    targetLat: track.lat,
    targetAlt: Number.isFinite(track.altitude) ? Number(track.altitude) : 0,
  };
  console.log(
    "[map-track-dblclick] ①b ThirdPartyYuan8GuideTask（8院经纬高引导）→ POST /api/camera-task/yuan8-guide\n",
    JSON.stringify(body, null, 2),
  );
  try {
    const res = await postYuan8GuideTask({
      backendBaseUrl: posBackend,
      targetLon: body.targetLon,
      targetLat: body.targetLat,
      targetAlt: body.targetAlt,
      ownerEntityId: "",
    });
    const text = await res.text().catch(() => "");
    const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
    console.log("[map-track-dblclick] ①b Yuan8 GUIDE 响应", {
      httpStatus: res.status,
      accepted: outcome.accepted,
      summary: outcome.logLine,
      bodyPreview: text.slice(0, 600),
    });
  } catch (err: unknown) {
    console.warn("[map-track-dblclick] ①b Yuan8 GUIDE 请求异常", err);
  }
}

/** 地图双击无人机自报位/高频图标：与双击融合航迹相同，下发 POS + 光电重点关注采集 */
export async function runGisDroneSelfReportVerification(sn: string): Promise<void> {
  const track = resolveTrackForDroneSelfReport(sn);
  if (!track) {
    console.warn("[map-drone-dblclick] 未找到无人机遥测或有效坐标", { sn });
    return;
  }
  const selfPosId = resolveCamServerSelfPosMapId(track);
  console.info("[map-drone-dblclick] 命中高频三角", {
    sn,
    showID: track.showID,
    uniqueID: track.uniqueID,
    camServerSelfPosMapId: selfPosId,
    syntheticNoTargetId: selfPosId == null && String(track.showID).startsWith("drone-self-report:"),
    lat: track.lat,
    lng: track.lng,
    altitude: track.altitude,
  });
  await runGisTrackVerification(track);
}

export async function runGisTrackVerification(track: Track): Promise<void> {
  useTargetProfileStore.getState().setFocusedShowId(track.showID);
  const dock = useDockStore.getState();
  dock.assignPanelToPartition("target-profile", "right-0");

  const cfg = await useAppConfigStore.getState().ensureLoaded();
  const allTracks = useTrackStore.getState().tracks;
  const target = buildImportantTrackTargetFromTrack(track, allTracks);
  const posBackend = getDefaultEoCameraTaskBackendBaseUrl();
  const posFields = buildThirdPartyPosFieldsFromTrack(track);

  console.group("[map-track-dblclick] 双击航迹 · 下发相机任务");
  console.log("航迹", {
    showID: track.showID,
    uniqueID: track.uniqueID,
    trackId: track.trackId,
    camServerSelfPosMapId: resolveCamServerSelfPosMapId(track),
    type: track.type,
    trackLayerKey: track.trackLayerKey,
    trackType: posFields?.trackType ?? null,
    shipTask: resolveCamServerShipTaskIds(track, allTracks),
    lat: track.lat,
    lng: track.lng,
    speed: track.speed,
    course: track.course ?? track.heading,
  });
  const lookAtOnly =
    cfg.cameraManagement?.mapTrackDblClickLookAtOnly === true &&
    isMapTrackDblClickLookAtOnlyEligible(track);

  console.log(
    "[map-track-dblclick] 分路说明：① ThirdPartyCamPosTask=第三方高速相机 POS；①b Yuan8 GUIDE=8院经纬高引导；② 光电 PTZ；③ 对准采集；④ burn-in placard",
  );
  console.log("[map-track-dblclick] ② 模式", lookAtOnly ? "LookAtChild（仅转到位置）" : "TargetCollectionIM", {
    mapTrackDblClickLookAtOnly: cfg.cameraManagement?.mapTrackDblClickLookAtOnly === true,
    eligible: isMapTrackDblClickLookAtOnlyEligible(track),
    trackLayerKey: track.trackLayerKey,
  });
  if (!lookAtOnly) {
    console.log("[map-track-dblclick] ② IM 任务 targetcollection 预览", target);
  }

  let posPromise: Promise<void>;
  if (posFields) {
    posPromise = Promise.all([
      dispatchThirdPartyPosTaskLogged(posFields, posBackend),
      dispatchYuan8GuideTaskLogged(track, posBackend),
    ]).then(() => undefined);
  } else {
    console.warn(
      "[map-track-dblclick] ① ThirdPartyCamPosTask 跳过：航迹缺少合法 uniqueID 或经纬度",
      { showID: track.showID, uniqueID: track.uniqueID, lat: track.lat, lng: track.lng },
    );
    posPromise = dispatchYuan8GuideTaskLogged(track, posBackend);
  }

  try {
    await ensureEntitiesTrackTaskCache();
  } catch (err: unknown) {
    console.error("[map-track-dblclick] 实体快照加载失败，②③ 均未发送", err);
    await posPromise;
    console.groupEnd();
    return;
  }

  const owners = listTrackTaskOwnerEntityIds();
  const placardPromise = dispatchBurnInPlacardForOwners(track, owners).catch((err: unknown) => {
    console.warn("[map-track-dblclick] ④ burn-in placard 异常", err);
  });
  const aimCollectPromise = dispatchAimTrackCollectMapDblClick(track).catch((err: unknown) => {
    console.warn("[map-track-dblclick] ③ 对准采集 triggerType=3 异常", err);
  });

  const cm = cfg.cameraManagement;
  if (!cm) {
    console.warn("[map-track-dblclick] ② cameraManagement 未配置，未发送光电任务");
    await Promise.all([posPromise, aimCollectPromise, placardPromise]);
    console.groupEnd();
    return;
  }
  if (owners.length === 0) {
    console.warn(
      "[map-track-dblclick] ② 无可用光电 PTZ 主相机（需 hasPtz、无 parent、非第三方），未发送光电任务",
    );
    await Promise.all([posPromise, aimCollectPromise, placardPromise]);
    console.groupEnd();
    return;
  }

  const client = CameraManagementClient.fromConfig(cm);
  if (!client) {
    console.warn("[map-track-dblclick] ② CameraManagementClient 初始化失败");
    await Promise.all([posPromise, aimCollectPromise, placardPromise]);
    console.groupEnd();
    return;
  }

  if (lookAtOnly) {
    const checkTime =
      cm.mapTrackDblClickLookAtCheckTime !== undefined ? cm.mapTrackDblClickLookAtCheckTime : 0;
    const shipTask = resolveCamServerShipTaskIds(track, allTracks);
    const lookAt = {
      latitude: Number.isFinite(track.lat) ? track.lat : 0,
      longitude: Number.isFinite(track.lng) ? track.lng : 0,
      trackID: shipTask.targetId,
      shipType: shipTask.shipType,
      checkTime,
    };
    console.log(
      "[map-track-dblclick] ② LookAtChildTask（仅转到位置，跳过单目标/左右搜）",
      `共 ${owners.length} 台 → ${client.publishUrl}`,
      owners,
      lookAt,
    );
    for (const ownerId of owners) {
      const body = buildLookAtChildTaskBody(cm, ownerId, lookAt, { taskIdSuffix: ownerId });
      console.log(
        `[map-track-dblclick] ② LookAtChildTask owner=${ownerId}\n`,
        JSON.stringify(body, null, 2),
      );
      const res = await client.publishTask(body);
      if (res.networkError) {
        console.warn("[map-track-dblclick] ② LookAt 请求失败", {
          ownerId,
          url: client.publishUrl,
          networkError: res.networkError,
        });
        continue;
      }
      console.log("[map-track-dblclick] ② LookAt 响应", {
        ownerId,
        status: res.status,
        ok: res.ok,
        executionState: res.executionState ?? "",
        errorMessage: res.errorMessage ?? "",
        bodyPreview: (res.rawText ?? "").slice(0, 600),
      });
    }
  } else {
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
  }

  await Promise.all([posPromise, aimCollectPromise, placardPromise]);
  console.groupEnd();
}

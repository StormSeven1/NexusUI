"use client";

import { useEffect } from "react";
import { normThirdPartyEntityId, subscribeThirdPartyCameraWsHub } from "@/lib/eo-video/thirdPartyCameraWsHub";
import {
  formatPanVehicleDeg,
  requestThirdPartyPtzFovFlush,
  resolveThirdPartyPtzFovRows,
  thirdPartyDetectAlertId,
  THIRD_PARTY_DETECT_ALERT_TYPE,
} from "@/lib/third-party-ptz-fov";
import { ensureEntitiesTrackTaskCache } from "@/lib/entities-track-task-cache";
import { useAlertStore } from "@/stores/alert-store";
import { useAssetStore } from "@/stores/asset-store";
import { useEoThirdPartyUdpDevStatusStore } from "@/stores/eo-third-party-udp-dev-status-store";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import { recordThirdPartyCameraReceived } from "@/stores/network-stats-store";

function syncThirdPartyDetectionAlerts(): void {
  const menuRows = useMapGisCameraMenuStore.getState().rows;
  const assets = useAssetStore.getState().assets;
  const udpByEntityId = useEoThirdPartyUdpDevStatusStore.getState().byEntityId;
  const rows = resolveThirdPartyPtzFovRows(
    menuRows,
    assets,
    useEoCameraDdsStatusStore.getState().byEntityId,
    udpByEntityId,
  );
  const activeTargetIds = new Set(rows.filter((r) => r.hasTarget).map((r) => r.entityId));

  for (const row of rows) {
    if (!row.hasTarget) continue;
    useAlertStore.getState().upsertAlarm({
      id: thirdPartyDetectAlertId(row.entityId),
      severity: "warning",
      type: THIRD_PARTY_DETECT_ALERT_TYPE,
      source: "第三方相机",
      message: `${row.name}在${formatPanVehicleDeg(row.panVehicleDeg)}度发现可疑目标`,
      timestamp: new Date().toISOString(),
      lat: row.lat,
      lng: row.lng,
      bearingDeg: row.panVehicleDeg,
    });
  }

  const alertState = useAlertStore.getState();
  for (const a of alertState.alerts) {
    if (a.type !== THIRD_PARTY_DETECT_ALERT_TYPE) continue;
    const entityId = a.id.startsWith("third-party-detect:")
      ? a.id.slice("third-party-detect:".length)
      : "";
    if (!entityId) continue;
    if (!activeTargetIds.has(entityId)) {
      useAlertStore.getState().removeAlarmById(a.id);
    }
  }
}

/** 第三方 UDP 高频帧：地图扇形刷新合并到 ≤10Hz，避免拖垮主线程与其它 WebRTC */
const THIRD_PARTY_MAP_FOV_FLUSH_MS = 100;
const THIRD_PARTY_ALERT_SYNC_MS = 200;

/** 地图视场 + 告警：全局订阅第三方相机 WS（不依赖光电窗口是否打开） */
export function useThirdPartyCameraGlobalMapFeed(): void {
  useEffect(() => {
    void ensureEntitiesTrackTaskCache();
    void useMapGisCameraMenuStore.getState().ensureLoaded();

    let fovFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let alertSyncTimer: ReturnType<typeof setTimeout> | null = null;

    const schedulePtzFovFlush = () => {
      if (fovFlushTimer != null) return;
      fovFlushTimer = setTimeout(() => {
        fovFlushTimer = null;
        requestThirdPartyPtzFovFlush();
      }, THIRD_PARTY_MAP_FOV_FLUSH_MS);
    };

    const scheduleAlertSync = () => {
      if (alertSyncTimer != null) return;
      alertSyncTimer = setTimeout(() => {
        alertSyncTimer = null;
        syncThirdPartyDetectionAlerts();
      }, THIRD_PARTY_ALERT_SYNC_MS);
    };

    const unsubHub = subscribeThirdPartyCameraWsHub({
      onDevStatusBasic: (rec) => {
        useEoThirdPartyUdpDevStatusStore.getState().ingestDevStatusBasic(rec);
      },
      onBinaryFrameMeta: (parsed) => {
        recordThirdPartyCameraReceived(parsed.entityId || undefined);
        const key = normThirdPartyEntityId(parsed.entityId);
        if (!key) return;
        useEoThirdPartyUdpDevStatusStore.getState().ingestImageReport(key, parsed.boxes.length > 0);
        schedulePtzFovFlush();
      },
    });

    const unsubUdp = useEoThirdPartyUdpDevStatusStore.subscribe(scheduleAlertSync);
    const unsubDds = useEoCameraDdsStatusStore.subscribe(scheduleAlertSync);
    const unsubAssets = useAssetStore.subscribe(scheduleAlertSync);
    const unsubMenu = useMapGisCameraMenuStore.subscribe(scheduleAlertSync);

    syncThirdPartyDetectionAlerts();

    return () => {
      unsubHub();
      unsubUdp();
      unsubDds();
      unsubAssets();
      unsubMenu();
      if (fovFlushTimer != null) clearTimeout(fovFlushTimer);
      if (alertSyncTimer != null) clearTimeout(alertSyncTimer);
    };
  }, []);
}

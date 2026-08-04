"use client";

import { useEffect } from "react";
import { normThirdPartyEntityId, subscribeThirdPartyCameraWsHub } from "@/lib/eo-video/thirdPartyCameraWsHub";
import { requestThirdPartyPtzFovFlush } from "@/lib/third-party-ptz-fov";
import { ensureEntitiesTrackTaskCache } from "@/lib/entities-track-task-cache";
import { useEoThirdPartyUdpDevStatusStore } from "@/stores/eo-third-party-udp-dev-status-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import { recordThirdPartyCameraReceived } from "@/stores/network-stats-store";

/** 第三方 UDP 高频帧：地图扇形刷新合并到 ≤10Hz，避免拖垮主线程与其它 WebRTC */
const THIRD_PARTY_MAP_FOV_FLUSH_MS = 100;

/**
 * 地图视场：全局订阅第三方相机 WS（不依赖光电窗口是否打开）。
 * 检测告警改由 camServer SystemAlarm（5s 同 box_id）→ useSystemAlarmPoll，不再本地 upsert。
 */
export function useThirdPartyCameraGlobalMapFeed(): void {
  useEffect(() => {
    void ensureEntitiesTrackTaskCache();
    void useMapGisCameraMenuStore.getState().ensureLoaded();

    let fovFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const schedulePtzFovFlush = () => {
      if (fovFlushTimer != null) return;
      fovFlushTimer = setTimeout(() => {
        fovFlushTimer = null;
        requestThirdPartyPtzFovFlush();
      }, THIRD_PARTY_MAP_FOV_FLUSH_MS);
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

    return () => {
      unsubHub();
      if (fovFlushTimer != null) clearTimeout(fovFlushTimer);
    };
  }, []);
}

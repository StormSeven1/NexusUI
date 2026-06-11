"use client";

import { useEffect, useMemo } from "react";
import { allocateSmartWindowTargets } from "@/lib/eo-video/eoSmartWindowSwitch";
import type { EoVideoStreamsConfig } from "@/lib/eo-video/types";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useEoDroneDdsStatusStore } from "@/stores/eo-drone-dds-status-store";
import { useEoVideoSmartWindowStore } from "@/stores/eo-video-smart-window-store";
import { useEoVideoStreamSelectionSyncStore } from "@/stores/eo-video-stream-selection-sync-store";

export interface UseEoVideoSmartWindowArgs {
  panelId: string;
  enabled: boolean;
  cfg: EoVideoStreamsConfig | null;
  activeStreamId: string;
  onSelectStream: (streamId: string) => void;
  pageEntity?: string;
}

/**
 * 智能窗口：检测到无人机/相机执行任务时，自动切换主画面到对应设备。
 * - 其它光电窗已在显示的设备不再抢占
 * - 多个智能窗按 panelId 顺序分配不同执行中设备
 * - 无人机优先且锁定不可抢占，直至该机变为空闲
 */
export function useEoVideoSmartWindow({
  panelId,
  enabled,
  cfg,
  activeStreamId,
  onSelectStream,
  pageEntity,
}: UseEoVideoSmartWindowArgs): void {
  const cameraByEntityId = useEoCameraDdsStatusStore((s) => s.byEntityId);
  const droneByEntityId = useEoDroneDdsStatusStore((s) => s.byEntityId);
  const mainBySyncKey = useEoVideoStreamSelectionSyncStore((s) => s.mainBySyncKey);
  const enabledByPanelId = useEoVideoSmartWindowStore((s) => s.enabledByPanelId);
  const lockedUavStreamByPanelId = useEoVideoSmartWindowStore((s) => s.lockedUavStreamByPanelId);
  const setLockedUavStream = useEoVideoSmartWindowStore((s) => s.setLockedUavStream);

  const smartPanels = useMemo(
    () =>
      Object.entries(enabledByPanelId)
        .filter(([, on]) => on)
        .map(([id]) => ({
          panelId: id,
          activeStreamId: mainBySyncKey[id]?.trim() ?? "",
          lockedUavStreamId: lockedUavStreamByPanelId[id] ?? null,
        })),
    [enabledByPanelId, mainBySyncKey, lockedUavStreamByPanelId],
  );

  const allocation = useMemo(() => {
    if (!cfg?.streams.length || smartPanels.length === 0) return null;
    return allocateSmartWindowTargets({
      streams: cfg.streams,
      cameraByEntityId,
      droneByEntityId,
      allPanelMainStreams: mainBySyncKey,
      smartPanels,
      pageEntity,
    });
  }, [cfg, cameraByEntityId, droneByEntityId, mainBySyncKey, smartPanels, pageEntity]);

  useEffect(() => {
    const pid = panelId.trim();
    if (!enabled || !pid || !cfg?.streams.length || !allocation) return;

    const { targetStreamId, nextLockedUavStreamId } = allocation[pid] ?? {
      targetStreamId: null,
      nextLockedUavStreamId: null,
    };
    const curLock = lockedUavStreamByPanelId[pid] ?? null;

    if (nextLockedUavStreamId !== curLock) {
      setLockedUavStream(pid, nextLockedUavStreamId);
    }

    if (!targetStreamId || targetStreamId === activeStreamId.trim()) return;
    if (!cfg.streams.some((s) => s.id === targetStreamId)) return;
    onSelectStream(targetStreamId);
  }, [
    panelId,
    enabled,
    cfg,
    allocation,
    activeStreamId,
    onSelectStream,
    lockedUavStreamByPanelId,
    setLockedUavStream,
  ]);
}

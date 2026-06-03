"use client";

import { useEffect, useRef, useState } from "react";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { isCameraExecutionActive, parsePositiveTrackId } from "@/lib/eo-video/formatEoDdsTaskOverlay";

/** 与右下角任务条 `useEoVideoDdsTaskLine` 一致：离开 EXECUTING / 航迹号后延迟清空 */
export const EO_CAMERA_DDS_EXECUTING_HOLD_MS = 3000;

export interface EoCameraDdsHeldTrackUi {
  trackId: number | null;
  trackAlias: string;
  /** 单目标标牌标题（圆标旁航迹名 / T{n}） */
  overlayTitle: string | null;
}

const EMPTY_HELD: EoCameraDdsHeldTrackUi = {
  trackId: null,
  trackAlias: "",
  overlayTitle: null,
};

/** 曾误把根载荷 `name`（相机状态/标题）写入 trackAlias，此处过滤后再当航迹别名 */
export function sanitizeDdsTrackAliasForOverlay(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/相机/.test(t) && /状态/.test(t)) return "";
  return t;
}

function parseTrackIdFromRow(row: EoCameraDdsStatusRow | undefined): number | null {
  if (!row) return null;
  return parsePositiveTrackId(row.trackID) ?? parsePositiveTrackId(row.targetID);
}

function parseAliasFromRow(row: EoCameraDdsStatusRow | undefined): string {
  if (!row) return "";
  const av = row.trackAlias;
  if (typeof av === "string" && av.trim()) return sanitizeDdsTrackAliasForOverlay(av);
  if (av != null && String(av).trim()) return sanitizeDdsTrackAliasForOverlay(String(av));
  return "";
}

function snapshotFromRow(row: EoCameraDdsStatusRow | undefined): EoCameraDdsHeldTrackUi {
  const trackId = parseTrackIdFromRow(row);
  const trackAlias = parseAliasFromRow(row);
  const overlayTitle = trackId != null ? trackAlias || `T${trackId}` : null;
  return { trackId, trackAlias, overlayTitle };
}

/**
 * 单目标叠层航迹号 / 别名：EXECUTING 且有航迹号时立即更新；
 * 航迹号丢失或任务非执行态后保留 3s；期间再次 EXECUTING+航迹号则刷新计时。
 */
export function useEoCameraDdsHeldTrackUi(camId: string): EoCameraDdsHeldTrackUi {
  const [held, setHeld] = useState<EoCameraDdsHeldTrackUi>(EMPTY_HELD);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActiveRef = useRef<EoCameraDdsHeldTrackUi>(EMPTY_HELD);
  const wasActiveRef = useRef(false);
  const prevCamIdRef = useRef("");

  const row = useEoCameraDdsStatusStore((s) => (camId ? s.byEntityId[camId] : undefined));

  useEffect(() => {
    const clearHold = () => {
      if (holdTimerRef.current != null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };

    if (prevCamIdRef.current !== camId) {
      clearHold();
      prevCamIdRef.current = camId;
      lastActiveRef.current = EMPTY_HELD;
      wasActiveRef.current = false;
      setHeld(EMPTY_HELD);
    }

    if (!camId) {
      clearHold();
      setHeld(EMPTY_HELD);
      return clearHold;
    }

    const snap = snapshotFromRow(row);
    const executing = isCameraExecutionActive(row?.executionState);
    const active = executing && snap.trackId != null;

    if (active) {
      clearHold();
      wasActiveRef.current = true;
      lastActiveRef.current = snap;
      setHeld(snap);
      return clearHold;
    }

    if (wasActiveRef.current && lastActiveRef.current.trackId != null) {
      wasActiveRef.current = false;
      setHeld(lastActiveRef.current);
      clearHold();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        lastActiveRef.current = EMPTY_HELD;
        setHeld(EMPTY_HELD);
      }, EO_CAMERA_DDS_EXECUTING_HOLD_MS);
      return clearHold;
    }

    if (!holdTimerRef.current) {
      setHeld(EMPTY_HELD);
    }

    return clearHold;
  }, [camId, row]);

  return held;
}

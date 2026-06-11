"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectionRectsToEoBoxes, headersMatch } from "@/lib/eo-video/detectionSyncUtils";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { useEoDetectionStore } from "@/stores/eo-detection-store";

const ENTRY_STALE_MS = 2000;
const MAX_REUSE_MISSING_FRAMES = 30;

type DetectionEntriesByCameraId = ReturnType<typeof useEoDetectionStore.getState>["entriesByCameraId"];
type DetectionEntry = DetectionEntriesByCameraId[string][number];
const EMPTY_ENTRIES: DetectionEntry[] = [];

export function useEoSyncedDetections({
  entityId,
  enabled,
  encodedSyncHub,
  videoIntrinsicWidth = 0,
  videoIntrinsicHeight = 0,
  videoRef,
}: {
  entityId: string;
  enabled: boolean;
  encodedSyncHub?: EoEncodedSyncHub;
  videoIntrinsicWidth?: number;
  videoIntrinsicHeight?: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [boxState, setBoxState] = useState<{ key: string; boxes: EoDetectionBox[] }>({
    key: "",
    boxes: [],
  });
  const [, setReuseState] = useState<{
    key: string;
    boxes: EoDetectionBox[];
    missingFrames: number;
  }>({
    key: "",
    boxes: [],
    missingFrames: 0,
  });
  const [diagState, setDiagState] = useState<{ key: string; diag: string }>({
    key: "",
    diag: "",
  });

  const normalizedEntityId = useMemo(() => entityId.trim(), [entityId]);
  const sessionKey = normalizedEntityId;
  const entriesByCameraId = useEoDetectionStore((s) => s.entriesByCameraId);
  const entries = useMemo(() => {
    if (!normalizedEntityId) return EMPTY_ENTRIES;
    return entriesByCameraId[normalizedEntityId] ?? EMPTY_ENTRIES;
  }, [entriesByCameraId, normalizedEntityId]);
  const entriesRef = useRef(entries);
  const initialDiag = enabled ? "检测框来自主 WS，总线已统一接入" : "";

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;
    let timer: number | null = null;
    let frameCallbackId: number | null = null;
    let stopped = false;

    const process = () => {
      if (stopped) return;
      const now = Date.now();
      const entries = entriesRef.current;
      const recentEntries = entries.filter((entry) => now - entry.receivedAt <= ENTRY_STALE_MS);
      let matched = null as DetectionEntry | null;
      let hasPresentationSnapshot = false;

      if (encodedSyncHub) {
        const lags = [0, 1, 2, 3, 4, 5, 6, 8, 10];
        outer: for (const lag of lags) {
          const snapshot = encodedSyncHub.snapshotForPresentation(lag);
          if (!snapshot) continue;
          hasPresentationSnapshot = true;
          for (let index = recentEntries.length - 1; index >= 0; index -= 1) {
            const entry = recentEntries[index];
            if (entry && headersMatch(entry.header, snapshot.syncHeader)) {
              matched = entry;
              break outer;
            }
          }
        }
      }

      if (!matched && !hasPresentationSnapshot) {
        matched = recentEntries[recentEntries.length - 1] ?? null;
      }

      if (!matched) {
        setReuseState((prev) => {
          const sameSession = prev.key === sessionKey;
          const nextMissingFrames = sameSession ? prev.missingFrames + 1 : 1;
          if (sameSession && prev.boxes.length > 0 && nextMissingFrames <= MAX_REUSE_MISSING_FRAMES) {
            setBoxState({ key: sessionKey, boxes: prev.boxes });
            setDiagState({
              key: sessionKey,
              diag: `检测框复用第 ${nextMissingFrames} 帧（最多 ${MAX_REUSE_MISSING_FRAMES} 帧）`,
            });
            return { key: sessionKey, boxes: prev.boxes, missingFrames: nextMissingFrames };
          }
          setBoxState({ key: sessionKey, boxes: [] });
          setDiagState({ key: sessionKey, diag: "当前相机暂无检测框" });
          return { key: sessionKey, boxes: [], missingFrames: 0 };
        });
        return;
      }

      const nextBoxes = detectionRectsToEoBoxes(
        matched.rects,
        video.videoWidth || videoIntrinsicWidth,
        video.videoHeight || videoIntrinsicHeight,
        "det",
        "accent",
      );
      if (nextBoxes.length === 0) {
        setReuseState((prev) => {
          const sameSession = prev.key === sessionKey;
          const nextMissingFrames = sameSession ? prev.missingFrames + 1 : 1;
          if (sameSession && prev.boxes.length > 0 && nextMissingFrames <= MAX_REUSE_MISSING_FRAMES) {
            setBoxState({ key: sessionKey, boxes: prev.boxes });
            setDiagState({
              key: sessionKey,
              diag: `检测框复用第 ${nextMissingFrames} 帧（最多 ${MAX_REUSE_MISSING_FRAMES} 帧）`,
            });
            return { key: sessionKey, boxes: prev.boxes, missingFrames: nextMissingFrames };
          }
          setBoxState({ key: sessionKey, boxes: [] });
          setDiagState({ key: sessionKey, diag: "当前相机暂无检测框" });
          return { key: sessionKey, boxes: [], missingFrames: 0 };
        });
        return;
      }
      setBoxState({
        key: sessionKey,
        boxes: nextBoxes,
      });
      setReuseState({ key: sessionKey, boxes: nextBoxes, missingFrames: 0 });
      setDiagState({ key: sessionKey, diag: `当前检测框数量：${matched.rects.length}` });
    };

    const onFrame = () => {
      process();
      if (!stopped && typeof video.requestVideoFrameCallback === "function") {
        frameCallbackId = video.requestVideoFrameCallback(() => onFrame());
      }
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallbackId = video.requestVideoFrameCallback(() => onFrame());
    } else {
      timer = window.setInterval(process, 40);
    }

    return () => {
      stopped = true;
      if (timer != null) window.clearInterval(timer);
      if (frameCallbackId != null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCallbackId);
      }
    };
  }, [encodedSyncHub, enabled, sessionKey, videoIntrinsicHeight, videoIntrinsicWidth, videoRef]);

  return {
    boxes: boxState.key === sessionKey ? boxState.boxes : [],
    diag: initialDiag || (diagState.key === sessionKey ? diagState.diag : ""),
  };
}

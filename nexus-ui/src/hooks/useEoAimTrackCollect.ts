"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useTrackStore } from "@/stores/track-store";
import {
  isCameraSingleTrackDetectionActive,
} from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { resolveTrackByDdsId } from "@/lib/eo-calc-record/resolveTargetTrack";
import {
  buildAimTrackCollectEndPayload,
  buildAimTrackCollectPayload,
  resolveAimTrackCollectDdsTrackId,
  resolveAimTrackCollectFusionExternalTargetId,
  resolveAimTrackCollectRadarSourcesSuffix,
} from "@/lib/eo-aim-collect/buildAimTrackCollectPayload";
import type {
  AimTrackCollectBlockReason,
  AimTrackCollectRequest,
} from "@/lib/eo-aim-collect/aimTrackCollectTypes";

export type UseEoAimTrackCollectArgs = {
  entityId: string | undefined;
  detectionBoxes: readonly EoDetectionBox[];
  onBottomFeedback?: (payload: { text: string; tone?: "success" | "error" | "warn" }) => void;
};

const BLOCK_HINT: Record<AimTrackCollectBlockReason, string> = {
  not_single_track: "当前未进行单目标跟踪，无法采集",
  no_target: "缺少目标航迹信息，无法采集",
  invalid_camera: "当前流不是本机相机实体，无法采集",
};

export function useEoAimTrackCollect({
  entityId,
  detectionBoxes,
  onBottomFeedback,
}: UseEoAimTrackCollectArgs) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastStartPayloadRef = useRef<AimTrackCollectRequest | null>(null);

  const tracks = useTrackStore((s) => s.tracks);
  const ddsRow = useEoCameraDdsStatusStore((s) => (entityId ? s.byEntityId[entityId] : undefined));

  const hasSingleTrackBox = useMemo(
    () => detectionBoxes.some((b) => b.variant === "singleTrack"),
    [detectionBoxes],
  );

  const ddsSingleTrackActive = useMemo(
    () => isCameraSingleTrackDetectionActive(ddsRow),
    [ddsRow],
  );

  const singleTrackActive = hasSingleTrackBox || ddsSingleTrackActive;

  const ddsTrackId = useMemo(
    () => resolveAimTrackCollectDdsTrackId(ddsRow, detectionBoxes),
    [ddsRow, detectionBoxes],
  );

  const targetTrack = useMemo(
    () => resolveTrackByDdsId(tracks, ddsTrackId),
    [tracks, ddsTrackId],
  );

  const fusionExternalTargetId = useMemo(
    () => (targetTrack ? resolveAimTrackCollectFusionExternalTargetId(targetTrack) : null),
    [targetTrack],
  );

  const radarSourcesSuffix = useMemo(
    () => (targetTrack ? resolveAimTrackCollectRadarSourcesSuffix(targetTrack, tracks) : null),
    [targetTrack, tracks],
  );

  const blockReason = useMemo((): AimTrackCollectBlockReason | null => {
    if (!entityId?.trim() || !/^camera_\d{3}$/i.test(entityId.trim())) {
      return "invalid_camera";
    }
    if (!singleTrackActive) return "not_single_track";
    if (ddsTrackId == null || ddsTrackId <= 0 || !targetTrack) return "no_target";
    if (fusionExternalTargetId == null || fusionExternalTargetId <= 0) return "no_target";
    if (!radarSourcesSuffix) return "no_target";
    if (!Number.isFinite(targetTrack.lat) || !Number.isFinite(targetTrack.lng)) return "no_target";
    return null;
  }, [
    entityId,
    singleTrackActive,
    ddsTrackId,
    targetTrack,
    fusionExternalTargetId,
    radarSourcesSuffix,
  ]);

  const postAimTrackCollect = useCallback(
    async (payload: AimTrackCollectRequest): Promise<{ ok: true } | { ok: false; msg: string }> => {
      console.info("[eo-aim-track-collect] gRPC trackPoints", {
        triggerType: payload.triggerType,
        cameraIndex: payload.cameraIndex,
        aimType: payload.aimType,
        trackPoints: payload.trackPoints,
      });
      try {
        const res = await fetch("/api/eo-aim-track-collect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          detail?: string;
        };
        if (!res.ok || data.ok === false) {
          const msg = data.detail || data.error || `HTTP ${res.status}`;
          return { ok: false, msg };
        }
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, msg };
      }
    },
    [],
  );

  const resolveEndPayload = useCallback((): AimTrackCollectRequest | null => {
    if (lastStartPayloadRef.current) {
      return buildAimTrackCollectEndPayload(lastStartPayloadRef.current);
    }
    if (!entityId || !targetTrack || fusionExternalTargetId == null || !radarSourcesSuffix) {
      return null;
    }
    return buildAimTrackCollectEndPayload(
      buildAimTrackCollectPayload({
        entityId,
        aimPath: "",
        ddsRow,
        detectionBoxes,
        targetTrack,
        fusionExternalTargetId,
        radarSourcesSuffix,
      }),
    );
  }, [ddsRow, detectionBoxes, entityId, fusionExternalTargetId, radarSourcesSuffix, targetTrack]);

  const endCollect = useCallback(
    async (opts?: { silent?: boolean }) => {
      const payload = resolveEndPayload();
      if (!payload) {
        lastStartPayloadRef.current = null;
        setChecked(false);
        return;
      }

      setBusy(true);
      try {
        const result = await postAimTrackCollect(payload);
        if (!result.ok) {
          if (opts?.silent) {
            lastStartPayloadRef.current = null;
            setChecked(false);
          } else {
            onBottomFeedback?.({ text: `对准采集结束上报失败：${result.msg}`, tone: "error" });
          }
          return;
        }

        lastStartPayloadRef.current = null;
        setChecked(false);
        if (!opts?.silent) {
          onBottomFeedback?.({ text: "对准采集已结束", tone: "success" });
        }
      } finally {
        setBusy(false);
      }
    },
    [onBottomFeedback, postAimTrackCollect, resolveEndPayload],
  );

  useEffect(() => {
    if (!singleTrackActive && checked) {
      void endCollect({ silent: true });
    }
  }, [checked, endCollect, singleTrackActive]);

  const toggleCollect = useCallback(async () => {
    if (checked) {
      await endCollect();
      return;
    }

    if (blockReason) {
      if (blockReason === "no_target") {
        console.warn("[eo-aim-track-collect] 缺少目标航迹信息", {
          ddsTrackId,
          targetShowId: targetTrack?.showID,
          targetTrackId: targetTrack?.trackId,
          fusionExternalTargetId,
          radarSourcesSuffix,
        });
      }
      onBottomFeedback?.({ text: BLOCK_HINT[blockReason], tone: "warn" });
      return;
    }
    if (
      !entityId ||
      !targetTrack ||
      ddsTrackId == null ||
      fusionExternalTargetId == null ||
      !radarSourcesSuffix
    ) {
      onBottomFeedback?.({ text: BLOCK_HINT.no_target, tone: "warn" });
      return;
    }

    setBusy(true);
    try {
      const payload = buildAimTrackCollectPayload({
        entityId,
        aimPath: "",
        ddsRow,
        detectionBoxes,
        targetTrack,
        fusionExternalTargetId,
        radarSourcesSuffix,
      });

      const result = await postAimTrackCollect(payload);
      if (!result.ok) {
        onBottomFeedback?.({ text: `对准采集上报失败：${result.msg}`, tone: "error" });
        return;
      }

      lastStartPayloadRef.current = payload;
      setChecked(true);
      onBottomFeedback?.({ text: "对准采集已上报", tone: "success" });
    } finally {
      setBusy(false);
    }
  }, [
    blockReason,
    checked,
    ddsRow,
    ddsTrackId,
    detectionBoxes,
    endCollect,
    entityId,
    fusionExternalTargetId,
    onBottomFeedback,
    postAimTrackCollect,
    radarSourcesSuffix,
    targetTrack,
  ]);

  return {
    supported: Boolean(entityId?.trim()),
    checked,
    busy,
    blockReason,
    toggleCollect,
  };
}

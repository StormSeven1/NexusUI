"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useTrackStore } from "@/stores/track-store";
import { useAssetStore } from "@/stores/asset-store";
import { isCameraExecutionActive } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { parsePositiveTrackId } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import {
  buildSeaCalcRecordLine,
  buildSkyCalcRecordLine,
  formatCalcRecordTimestamp,
  formatTrackTimeFromIso,
} from "@/lib/eo-calc-record/buildRecordLine";
import { captureAnnotatedJpegBlob, pickSingleTrackRect } from "@/lib/eo-calc-record/captureAnnotatedFrame";
import { resolveFusionRadarSources } from "@/lib/eo-calc-record/resolveFusionRadarSources";
import { isAirCalcRecordTrack, resolveCalcRecordBaselineTargetId, resolveTrackByDdsId } from "@/lib/eo-calc-record/resolveTargetTrack";
import { toast } from "sonner";

const NO_RECT_MS = 1200;

export type CalcRecordLocationPoint = { p: number; distance: number };

type PendingCalcRecordSample = {
  line: string;
  recordTime: string;
  imageBlob?: Blob;
};

export type UseEoCalcRecordControllerArgs = {
  entityId: string | undefined;
  cameraName: string;
  detectionBoxes: readonly EoDetectionBox[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  snapshotCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onClientLog?: (line: string) => void;
};

export function useEoCalcRecordController({
  entityId,
  cameraName,
  detectionBoxes,
  videoRef,
  snapshotCanvasRef,
  onClientLog,
}: UseEoCalcRecordControllerArgs) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSessionLabel, setRecordSessionLabel] = useState("");
  const [sessionStartLine, setSessionStartLine] = useState<number | null>(null);
  const [recordKind, setRecordKind] = useState<"sea" | "sky">("sea");
  const [rowCount, setRowCount] = useState(0);
  const [locationPoints, setLocationPoints] = useState<CalcRecordLocationPoint[]>([]);
  const [aimSeaBusy, setAimSeaBusy] = useState(false);
  const [aimSkyBusy, setAimSkyBusy] = useState(false);
  const [stableTracking, setStableTracking] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [nfsSynced, setNfsSynced] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const lastPosRef = useRef<{ lat: number; lng: number; alt: number } | null>(null);
  const captureBusyRef = useRef(false);
  const pendingSamplesRef = useRef<PendingCalcRecordSample[]>([]);
  const expectedFileLineRef = useRef(1);
  const lastSingleTrackMsRef = useRef(0);
  const noRectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tracks = useTrackStore((s) => s.tracks);
  const ddsRow = useEoCameraDdsStatusStore((s) => (entityId ? s.byEntityId[entityId] : undefined));
  const assets = useAssetStore((s) => s.assets);

  const ddsTrackId = useMemo(() => {
    if (!ddsRow) return null;
    return parsePositiveTrackId(ddsRow.trackID) ?? parsePositiveTrackId(ddsRow.targetID);
  }, [ddsRow]);

  const targetTrack = useMemo(() => resolveTrackByDdsId(tracks, ddsTrackId), [tracks, ddsTrackId]);

  /** 对齐 Qt `m_nCurFuseID` / DDS `target_id`，不用 `track.name`（如 buoy） */
  const baselineTargetId = useMemo(
    () => resolveCalcRecordBaselineTargetId(ddsTrackId, targetTrack),
    [ddsTrackId, targetTrack],
  );

  const cameraGeo = useMemo(() => {
    if (!entityId) return null;
    const a = assets.find((x) => x.id === entityId);
    if (a && Number.isFinite(a.lat) && Number.isFinite(a.lng) && !(a.lat === 0 && a.lng === 0)) {
      return { lat: a.lat, lng: a.lng };
    }
    return null;
  }, [assets, entityId]);

  const log = useCallback(
    (line: string) => {
      onClientLog?.(`${new Date().toLocaleTimeString()} [跟踪采集] ${line}`);
    },
    [onClientLog],
  );

  const hasSingleTrackBox = useMemo(
    () => detectionBoxes.some((b) => b.variant === "singleTrack"),
    [detectionBoxes],
  );

  useEffect(() => {
    if (hasSingleTrackBox) {
      lastSingleTrackMsRef.current = Date.now();
      setStableTracking(true);
      if (noRectTimerRef.current) {
        clearTimeout(noRectTimerRef.current);
        noRectTimerRef.current = null;
      }
      return;
    }
    if (noRectTimerRef.current) clearTimeout(noRectTimerRef.current);
    noRectTimerRef.current = setTimeout(() => {
      if (Date.now() - lastSingleTrackMsRef.current >= NO_RECT_MS) {
        setStableTracking(false);
        if (recording) {
          setRecording(false);
          log("检测框丢失，已停止记录");
        }
      }
      noRectTimerRef.current = null;
    }, NO_RECT_MS);
    return () => {
      if (noRectTimerRef.current) {
        clearTimeout(noRectTimerRef.current);
        noRectTimerRef.current = null;
      }
    };
  }, [hasSingleTrackBox, recording, log]);

  const ddsExecuting = isCameraExecutionActive(ddsRow?.executionState);
  /** 必须 DDS 已绑定 target_id 且能在航迹库中解析到目标 */
  const canRecord = Boolean(
    entityId &&
      ddsTrackId != null &&
      ddsTrackId > 0 &&
      targetTrack &&
      stableTracking &&
      (hasSingleTrackBox || ddsExecuting),
  );

  const recordBlockReason = useMemo(() => {
    if (!entityId) return "未选择相机";
    if (ddsTrackId == null || ddsTrackId <= 0) return "DDS 未绑定 target_id（请先在地图绑定航迹）";
    if (!targetTrack) return "航迹库中未找到该 target_id";
    if (!stableTracking) return "单目标检测框不稳定或已丢失";
    if (!hasSingleTrackBox && !ddsExecuting) return "无单目标框且相机未在执行跟踪";
    return null;
  }, [entityId, ddsTrackId, targetTrack, stableTracking, hasSingleTrackBox, ddsExecuting]);

  const sessionActive = recording || recordSessionLabel.length > 0;

  const ptz = useMemo(
    () => ({
      p: ddsRow?.ptzPanDeg ?? 0,
      t: ddsRow?.ptzTiltDeg ?? 0,
      z: ddsRow?.ptzZoom ?? 0,
    }),
    [ddsRow],
  );

  const captureSample = useCallback(async () => {
    if (!entityId || !targetTrack || !canRecord || captureBusyRef.current) return;
    const lat = targetTrack.lat;
    const lng = targetTrack.lng;
    const alt = targetTrack.altitude ?? 0;
    const prev = lastPosRef.current;
    if (prev && Math.abs(prev.lat - lat) < 1e-7 && Math.abs(prev.lng - lng) < 1e-7 && Math.abs(prev.alt - alt) < 1e-3) {
      return;
    }
    lastPosRef.current = { lat, lng, alt };

    const video = videoRef.current;
    const vw = video?.videoWidth ?? 0;
    const vh = video?.videoHeight ?? 0;
    const rect = pickSingleTrackRect(detectionBoxes, vw, vh);
    const recordTime = formatCalcRecordTimestamp();
    const trackTime = formatTrackTimeFromIso(targetTrack.lastUpdate);
    const isAir = isAirCalcRecordTrack(targetTrack);
    const kind: "sea" | "sky" = isAir ? "sky" : "sea";
    setRecordKind(kind);

    let line = "";
    if (kind === "sea") {
      const camLat = cameraGeo?.lat ?? 0;
      const camLng = cameraGeo?.lng ?? 0;
      const { yy, jzt } = resolveFusionRadarSources(targetTrack, tracks, camLat, camLng);
      const seq = expectedFileLineRef.current + rowCount;
      line = buildSeaCalcRecordLine({
        seq,
        fuseTrack: targetTrack,
        yy,
        jzt,
        camLat,
        camLng,
        rect: rect ?? { x: 0, y: 0, width: 0, height: 0 },
        p: ptz.p,
        t: ptz.t,
        z: ptz.z,
        shipName: targetTrack.name || targetTrack.showID,
        trackTime,
        recordTime,
      });
    } else {
      line = buildSkyCalcRecordLine({
        lon: lng,
        lat,
        alt,
        distance: targetTrack.distance ?? 0,
        p: ptz.p,
        t: ptz.t,
        z: ptz.z,
        trackTime,
        selfLon: 0,
        selfLat: 0,
        selfAlt: 0,
        selfPosTime: trackTime,
        fuseId: targetTrack.showID,
      });
    }

    captureBusyRef.current = true;
    try {
      const imageBlob = await captureAnnotatedJpegBlob({
        video,
        snapshotCanvas: snapshotCanvasRef.current,
        rect,
      });
      pendingSamplesRef.current.push({
        line,
        recordTime,
        imageBlob: imageBlob ?? undefined,
      });
      const pending = pendingSamplesRef.current.length;
      setPendingSyncCount(pending);
      setRowCount((c) => c + 1);
      setLocationPoints((pts) => [...pts, { p: ptz.p, distance: targetTrack.distance ?? 0 }]);
      log(`已采样第 ${pending} 条（待写入 200T）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`采样失败：${msg}`);
      toast.error("跟踪采集采样失败", { description: msg });
    } finally {
      captureBusyRef.current = false;
    }
  }, [
    entityId,
    targetTrack,
    canRecord,
    detectionBoxes,
    videoRef,
    snapshotCanvasRef,
    cameraGeo,
    tracks,
    ptz,
    rowCount,
    log,
  ]);

  useEffect(() => {
    if (!recording || !canRecord) return;
    void captureSample();
  }, [recording, canRecord, targetTrack?.lat, targetTrack?.lng, targetTrack?.altitude, captureSample]);

  const startRecording = useCallback(async () => {
    if (!entityId) {
      toast.warning("未选择相机");
      return;
    }

    const isAir = targetTrack ? isAirCalcRecordTrack(targetTrack) : false;
    const kind: "sea" | "sky" = isAir ? "sky" : "sea";
    const label = formatCalcRecordTimestamp().replace(/\./g, "-");

    setRecordKind(kind);
    setRecordSessionLabel(label);
    setSessionStartLine(null);
    pendingSamplesRef.current = [];
    setPendingSyncCount(0);
    setNfsSynced(false);
    lastPosRef.current = null;
    setRowCount(0);
    setLocationPoints([]);
    setRecording(true);

    if (!canRecord) {
      toast.info("采集会话已开始", {
        description: recordBlockReason ?? "等待记录条件满足后自动采样",
      });
    }

    let nextFileLine = 1;
    try {
      const res = await fetch(
        `/api/eo-calc-record/count?entityId=${encodeURIComponent(entityId)}&kind=${kind}`,
      );
      const data = (await res.json()) as { totalLines?: number; nextSeq?: number; camConfPath?: string };
      if (typeof data.totalLines === "number") {
        nextFileLine = data.totalLines + 1;
      }
      expectedFileLineRef.current = nextFileLine;
      if (typeof data.camConfPath === "string" && data.camConfPath) {
        log(`200T 已有 ${data.totalLines ?? 0} 行 · ${data.camConfPath}${data.nextSeq != null ? ` · 下一序号 ${data.nextSeq}` : ""}`);
      }
    } catch {
      expectedFileLineRef.current = nextFileLine;
    }

    log(`开始采集（数据暂存，点「更新数据」写入 200T cam${entityId.replace(/^camera_/i, "")}.txt）`);
  }, [entityId, targetTrack, canRecord, recordBlockReason, log]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    log(`停止记录，共 ${rowCount} 条`);
  }, [rowCount, log]);

  const toggleRecording = useCallback(
    (start: boolean) => {
      if (start) void startRecording();
      else stopRecording();
    },
    [startRecording, stopRecording],
  );

  const resetSessionState = useCallback(() => {
    pendingSamplesRef.current = [];
    setPendingSyncCount(0);
    setNfsSynced(false);
    setSessionStartLine(null);
    setRecordSessionLabel("");
    setRowCount(0);
    setLocationPoints([]);
    lastPosRef.current = null;
  }, []);

  const syncSessionToNfs = useCallback(async () => {
    if (!entityId) return;
    const samples = pendingSamplesRef.current;
    if (samples.length === 0) {
      toast.warning("暂无待更新数据", { description: "请先采集至少一条记录" });
      return;
    }
    setSyncBusy(true);
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 90_000);
      let res: Response;
      try {
        res = await fetch("/api/eo-calc-record/sync-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId,
            kind: recordKind,
            cameraName,
            samples: samples.map((s) => ({ line: s.line, recordTime: s.recordTime })),
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new Error(
            "更新超时（90s）。200T NFS 可能卡住，请在宿主机执行：sudo umount -l /mnt/nfs_200T && sudo mount /mnt/nfs_200T 后重试",
          );
        }
        throw e;
      } finally {
        window.clearTimeout(timer);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        writtenCount?: number;
        firstLineNo?: number;
        camConfPath?: string;
        mode?: "nfs" | "staging";
        stagingHint?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
      }

      if (sessionStartLine == null && typeof data.firstLineNo === "number") {
        setSessionStartLine(data.firstLineNo);
      }
      pendingSamplesRef.current = [];
      setPendingSyncCount(0);
      setNfsSynced(data.mode !== "staging");
      const camLabel = entityId.replace(/^camera_/i, "");
      if (data.mode === "staging") {
        toast.warning(`NFS 不可用，${data.writtenCount ?? samples.length} 条已暂存本地`, {
          description: data.stagingHint ?? data.camConfPath,
          duration: 12000,
        });
      } else {
        toast.success(`已更新 ${data.writtenCount ?? samples.length} 条到 200T cam${camLabel}.txt`);
      }
      log(
        data.mode === "staging"
          ? (data.stagingHint ?? `已暂存 ${data.writtenCount ?? samples.length} 条 · ${data.camConfPath ?? ""}`)
          : `已更新 ${data.writtenCount ?? samples.length} 条到 200T${data.camConfPath ? ` · ${data.camConfPath}` : ""}${data.firstLineNo != null ? ` · 自第 ${data.firstLineNo} 行` : ""}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`更新 200T 失败：${msg}`);
      toast.error("更新数据失败", { description: msg });
    } finally {
      setSyncBusy(false);
    }
  }, [entityId, recordKind, cameraName, sessionStartLine, log]);

  const deleteSession = useCallback(async () => {
    if (!entityId || rowCount === 0) {
      toast.warning("当前无本次记录可删");
      return;
    }
    if (sessionStartLine != null) {
      try {
        const res = await fetch("/api/eo-calc-record/delete-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId, kind: recordKind, startLine: sessionStartLine }),
        });
        const data = (await res.json()) as { ok?: boolean };
        if (!data.ok) throw new Error("delete_failed");
        log(`已从 200T 删除自第 ${sessionStartLine} 行起的记录`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("删除 200T 数据失败", { description: msg });
        return;
      }
    } else {
      log("已清除未写入 200T 的本地采样");
    }
    toast.success("已删除本次记录");
    resetSessionState();
  }, [entityId, rowCount, sessionStartLine, recordKind, log, resetSessionState]);

  const requestAimParam = useCallback(
    async (aimKind: 0 | 1) => {
      if (!entityId) return;
      const setBusy = aimKind === 0 ? setAimSeaBusy : setAimSkyBusy;
      setBusy(true);
      try {
        const res = await fetch("/api/eo-calc-record/aim-param", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId, aimKind }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; hint?: string; detail?: string; body?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.detail ?? data.hint ?? data.error ?? `HTTP ${res.status}`);
        }
        toast.success(aimKind === 0 ? "对海对准参数已请求生成" : "对空对准参数已请求生成");
        log(`对准生成完成 aimKind=${aimKind}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("对准生成失败", { description: msg });
      } finally {
        setBusy(false);
      }
    },
    [entityId, log],
  );

  return {
    dialogOpen,
    setDialogOpen,
    recording,
    canRecord,
    recordBlockReason,
    sessionActive,
    canStartSession: Boolean(entityId),
    cameraName,
    baselineTargetId,
    recordSessionLabel,
    rowCount,
    pendingSyncCount,
    nfsSynced,
    syncBusy,
    locationPoints,
    aimSeaBusy,
    aimSkyBusy,
    toggleRecording,
    syncSessionToNfs,
    deleteSession,
    requestAimParam,
    resetDefaultParams: () => toast.info("恢复默认参数需通过光电任务接口，暂未接入"),
  };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import { postEoPtzMove, postEoPtzStop, type EoPtzDirection, type EoPtzMoveSpeed } from "@/lib/eo-video/eoPtzTaskClient";
import {
  resolvePtzDragFromDelta,
  ptzSpeedChanged,
  ptzDirectionChangeNeedsStop,
  PTZ_SLOW_DRAG_ENTER_MS,
  isQuickFlickGesture,
  quickFlickPulseBudget,
  resolvePtzFlickRelease,
  type EoPtzDragDirection,
} from "@/lib/eo-video/eoPtzDrag";
import { readEoPtzTaskResponse } from "@/lib/eo-video/cameraTaskResult";
import { postUavCameraAim } from "@/lib/eo-video/postUavCameraAim";
import type { EoDetectionBox, EoVideoIceServer } from "@/lib/eo-video/types";
import { cn } from "@/lib/utils";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { isCameraSingleTrackDetectionActive } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import {
  armEoSingleTrackUserLatch,
  clearEoSingleTrackUserLatch,
} from "@/lib/eo-video/eoSingleTrackUserLatch";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { EoDetectionOverlay } from "./EoDetectionOverlay";
import { EoPtzDragArrowOverlay, type EoPtzDragArrowBox } from "./EoPtzDragArrowOverlay";
import { EoVideoDetectionLayer } from "./EoVideoDetectionLayer";
import { resolveEoVideoObjectFit } from "@/lib/eo-video/eoVideoObjectFit";
import { EoVideoViewport } from "./EoVideoViewport";

/** 按下后超过该像素即显示拖动箭头（早于云台方向触发阈值，便于看见反馈） */
const PTZ_ARROW_SHOW_MIN_PX = 4;
/** 松手后发 stop 前最短 hold（慢画箭头路径）；快甩用 quickFlickPulseBudget */
const PTZ_DRAG_STOP_MIN_HOLD_MS = 280;
const PTZ_STOP_RETRY_MS = 100;
/** 同方向持续拖时周期性重发 move（须 ≤ KEEPALIVE） */
const PTZ_DRAG_MOVE_RESEND_MS = 360;
const PTZ_DRAG_MOVE_RETRY_MS = 150;
const PTZ_DRAG_MOVE_KEEPALIVE_MS = 400;

/** 无人机 camera_aim 单次指针手势（松手发 HTTP，device/payload 在按下时快照） */
type UavAimGestureSession = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  deviceSn: string;
  payloadIndex: string;
};

/** 对齐 PtzMainWidget::CheckFindRect：取框中心与画面中心 (0.5,0.5) 归一化距离最近的检测框 */
function pickDetectionBoxClosestToVideoCenter(boxes: EoDetectionBox[]): EoDetectionBox | null {
  if (!boxes.length) return null;
  let best: EoDetectionBox | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    const mx = b.x + b.w / 2;
    const my = b.y + b.h / 2;
    const d = (mx - 0.5) ** 2 + (my - 0.5) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** 双击落点附近的海/空多目标框（补全 hitTest 漏检，避免误取消） */
function pickMultiTargetBoxNearPoint(
  boxes: EoDetectionBox[],
  normalizedX: number,
  normalizedY: number,
  maxNormDist = 0.08,
): EoDetectionBox | null {
  let best: EoDetectionBox | null = null;
  let bestD = maxNormDist ** 2;
  for (const b of boxes) {
    if (b.variant === "singleTrack") continue;
    const mx = b.x + b.w / 2;
    const my = b.y + b.h / 2;
    const d = (mx - normalizedX) ** 2 + (my - normalizedY) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** 参见 `postUavCameraAim` / Qt `UavAimAt5` */
export type UavCameraAimUiContext = {
  /** 与 uavtabboard 一致：机场 gateway SN */
  airportDeviceSn: string;
  payloadIndex: string;
  /** Qt：`!gConfig->airportInfoMap[...].droneInDock`，仅舱外机载画面发 aim */
  allowAim: boolean;
  /** 已取控制权（对齐 `CheckCameraRoot`） */
  hasControlAuth: boolean;
};

export interface EoVideoPlayStageProps {
  /** 与视频区同宽的容器 ref（检测叠加层 letterbox 对齐依赖） */
  stageRef: React.RefObject<HTMLDivElement | null>;
  signalingUrl: string;
  iceServers: EoVideoIceServer[];
  streamLabel?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  peerConnectionRef: React.MutableRefObject<RTCPeerConnection | null>;
  exposePeerForDetection?: boolean;
  entityId?: string;
  detectionEnabled?: boolean;
  onDetectionDiagnostic?: (line: string, hoverDetail?: string) => void;
  selectedBoxId?: string | null;
  onSelectBox?: (boxId: string | null) => void;
  taskBackendBaseUrl: string;
  onSaveTaskBackendBaseUrl: (url: string) => void;
  snapshotSavePath: string;
  recordSavePath: string;
  onSaveCapturePaths: (snapshotPath: string, recordPath: string) => void;
  /** 已通过 File System Access API 绑定的本机文件夹展示名（无则空） */
  captureLocalFolderLabel: string;
  captureLocalFolderSupported: boolean;
  onPickCaptureLocalFolder: () => void | Promise<void>;
  onClearCaptureLocalFolder: () => void | Promise<void>;
  onSingleTrackTask: (payload: {
    rectId: number;
    rectType: number;
    x: number;
    y: number;
    width: number;
    height: number;
    trackAction?: 0 | 1;
  }) => Promise<void>;
  /** 双击与本地校验日志（写入视频下方调试区） */
  onTaskClientLog?: (line: string) => void;
  /** 当前检测框（用于空白处双击按距中心最近选框） */
  detectionBoxes?: EoDetectionBox[];
  onDetectionBoxesChange?: (boxes: EoDetectionBox[]) => void;
  className?: string;
  /** @deprecated 旧：同步到底部右侧文案；请改用 onBottomCenterToast（中间 3s） */
  onOverlayTaskLine?: (line: string) => void;
  /** 底部状态条中间提示（3s 自动消失）；右下角 `taskLine` 由父级保留占位 */
  onBottomCenterToast?: (payload: { text: string; tone?: "success" | "error" | "warn" }) => void;
  /** 为右侧悬浮工具列让位，设置按钮与配置面板右移 */
  sideToolbarReserved?: boolean;
  /**
   * 父级据此启用截图/录屏按钮。WebCodecs+检测 模式下画面在 Canvas，仅监视 video 尺寸会永远为不可截图。
   */
  onCaptureReadyChange?: (ready: boolean) => void;
  /** WebCodecs 路径：与 `captureEoPlaybackToPngBlob` 的 canvas 参数对应 */
  snapshotCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  /**
   * 无人机主画面：按住拖动、松开发 `camera_aim`（对齐 `PtzMainWidget::UavAimAt5`，与光电实体 PTZ 拖动互斥）。
   */
  uavCameraAim?: UavCameraAimUiContext | null;
  /** 放大态：单目标检测标签显示航迹信息（与 Qt DrawCircleTag 标题栏扩展语义对齐） */
  expandedMode?: boolean;
  /** 订阅 DDS `trackAlias` 用的相机实体 id（见 EoVideoPanel `cameraDdsEntityId`） */
  ddsCameraEntityId?: string;
  /** 无人机：任务服务 `deviceSn`（机场 gateway SN） */
  uavAirportSn?: string | null;
  /** 无人机双击：`DroneIMGTracking` */
  onUavImgTrackingTask?: (payload: { rectId: number; videoDetectType: 0 | 1 }) => Promise<void>;
  /** 无人机：取消图像跟踪（`SendUavStopTask`） */
  onUavStopTrackingTask?: () => Promise<void>;
  /** 是否处于无人机单目标跟踪态（本地 + DDS） */
  uavTrackingActive?: boolean;
}

/**
 * 单路播放区：WebRTC + 取景角标 +（可选）实体检测叠加。
 */
export function EoVideoPlayStage({
  stageRef,
  signalingUrl,
  iceServers,
  streamLabel,
  videoRef,
  peerConnectionRef,
  exposePeerForDetection,
  entityId,
  detectionEnabled,
  onDetectionDiagnostic,
  selectedBoxId,
  onSelectBox,
  taskBackendBaseUrl,
  onSingleTrackTask,
  onTaskClientLog,
  detectionBoxes = [],
  onDetectionBoxesChange,
  className,
  onOverlayTaskLine,
  onBottomCenterToast,
  sideToolbarReserved = false,
  onCaptureReadyChange,
  snapshotCanvasRef,
  uavCameraAim = null,
  expandedMode = false,
  ddsCameraEntityId,
  uavAirportSn = null,
  onUavImgTrackingTask,
  onUavStopTrackingTask,
  uavTrackingActive = false,
}: EoVideoPlayStageProps) {
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskHint, setTaskHint] = useState("");
  const [ptzDragArrow, setPtzDragArrow] = useState<EoPtzDragArrowBox | null>(null);
  const trimmedEntityId = entityId?.trim() ?? "";
  const ddsLookupKey = useMemo(() => {
    const raw = (ddsCameraEntityId ?? trimmedEntityId).trim();
    if (!raw) return "";
    return canonicalEntityId(raw) || raw;
  }, [ddsCameraEntityId, trimmedEntityId]);
  const ddsSingleTrackActive = useEoCameraDdsStatusStore((s) =>
    ddsLookupKey ? isCameraSingleTrackDetectionActive(s.byEntityId[ddsLookupKey]) : false,
  );
  const showDetection = Boolean(trimmedEntityId && detectionEnabled);
  const isUavEntity = /^uav-/i.test(trimmedEntityId);
  /** 与 Qt 一致：相机实体即可双击发任务；检测 WS 关闭时仍要有叠层接收双击 */
  const showTrackHitLayer = Boolean(trimmedEntityId && /^camera_[0-9]{3}$/i.test(trimmedEntityId));
  const canSendSingleTrack = /^camera_[0-9]{3}$/i.test(trimmedEntityId);
  const canSendUavImgTrack = isUavEntity && Boolean(uavAirportSn?.trim() && onUavImgTrackingTask);
  /** 相机可交互叠层；无人机仅穿透双击，不挡 camera_aim 拖拽 */
  const detectionInteractive = canSendSingleTrack;
  /** 视频与检测叠层同一 fit（默认 fill 拉伸，与 Qt 一致；见 NEXT_PUBLIC_EO_VIDEO_OBJECT_FIT） */
  const videoObjectFit = resolveEoVideoObjectFit();
  const encodedSyncHub = useMemo(() => createEoEncodedSyncHub(), []);
  const videoReceiverRef = useRef<RTCRtpReceiver | null>(null);
  const webCodecsPresentationRef = useRef<EoWebCodecsPresentation>({
    active: false,
    width: 0,
    height: 0,
    canvas: null,
    lastRenderedRtpTimestamp: 0,
    videoFallbackActive: false,
    presentationEpoch: 0,
  });
  const [overlayIntrinsic, setOverlayIntrinsic] = useState<{ w?: number; h?: number }>({});

  useEffect(() => {
    const syncReady = () => {
      const v = videoRef.current;
      const wc = webCodecsPresentationRef.current;
      const videoOk = Boolean(v && v.videoWidth > 0 && v.videoHeight > 0);
      const wcOk = Boolean(wc.active && wc.width > 0 && wc.height > 0 && wc.canvas);
      onCaptureReadyChange?.(wcOk || videoOk);
      if (snapshotCanvasRef) {
        snapshotCanvasRef.current = wcOk ? wc.canvas : null;
      }
      if (wcOk) {
        setOverlayIntrinsic((prev) =>
          prev.w === wc.width && prev.h === wc.height ? prev : { w: wc.width, h: wc.height },
        );
      } else if (videoOk && v) {
        setOverlayIntrinsic((prev) =>
          prev.w === v.videoWidth && prev.h === v.videoHeight
            ? prev
            : { w: v.videoWidth, h: v.videoHeight },
        );
      } else {
        setOverlayIntrinsic((prev) =>
          prev.w === undefined && prev.h === undefined ? prev : {},
        );
      }
    };
    syncReady();
    const v = videoRef.current;
    if (v) {
      v.addEventListener("loadeddata", syncReady);
      v.addEventListener("loadedmetadata", syncReady);
      v.addEventListener("canplay", syncReady);
      v.addEventListener("playing", syncReady);
      v.addEventListener("resize", syncReady);
    }
    const id = window.setInterval(syncReady, 400);
    return () => {
      if (v) {
        v.removeEventListener("loadeddata", syncReady);
        v.removeEventListener("loadedmetadata", syncReady);
        v.removeEventListener("canplay", syncReady);
        v.removeEventListener("playing", syncReady);
        v.removeEventListener("resize", syncReady);
      }
      window.clearInterval(id);
    };
  }, [onCaptureReadyChange, snapshotCanvasRef, videoRef]);

  const dragStateRef = useRef<{
    active: boolean;
    /** 每次 pointerdown 递增；队列任务用快照校验，避免 pointerup 后误跳过 move */
    session: number;
    pointerId: number | null;
    startX: number;
    startY: number;
    /** pointerdown 时刻，用于识别快拖 */
    startedAt: number;
    lastDx: number;
    lastDy: number;
    /** 松手后拒绝新的 move（releaseFlush 除外） */
    stopRequested: boolean;
    /** 本手势是否已成功发过 move */
    moveSent: boolean;
    direction: EoPtzDirection | null;
    /** 已过 3s 长按阈值，由定时器或 pointermove 置位 */
    longPressMode: boolean;
  }>({
    active: false,
    session: 0,
    pointerId: null,
    startX: 0,
    startY: 0,
    startedAt: 0,
    lastDx: 0,
    lastDy: 0,
    stopRequested: false,
    moveSent: false,
    direction: null,
    longPressMode: false,
  });
  /** move/stop 串行，避免并发 fetch 在 BFF/gRPC 侧乱序 */
  const ptzDragQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ptzDragMoveMetaRef = useRef<{
    dir: EoPtzDirection | null;
    speed: EoPtzMoveSpeed;
    sentAt: number;
    confirmed: boolean;
  }>({
    dir: null,
    speed: { pan: 0.5, tilt: 0.5 },
    sentAt: 0,
    confirmed: false,
  });
  /** 对齐 PtzMainWidget::wheelEvent：节流间隔约 350ms × 刻度步数 */
  const wheelZoomLockUntilRef = useRef(0);
  const wheelZoomStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ptzArrowRafRef = useRef<number | null>(null);
  const ptzArrowPendingRef = useRef<EoPtzDragArrowBox | null>(null);
  const ptzDragKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ptzLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startDragPtzRef = useRef<(opts?: { force?: boolean; releaseFlush?: boolean }) => void>(() => {});
  const ensurePtzDragKeepAliveRef = useRef<() => void>(() => {});

  const resolveDragMove = useCallback(() => {
    const st = dragStateRef.current;
    const gestureMs = Math.max(0, Date.now() - st.startedAt);
    return resolvePtzDragFromDelta(st.lastDx, st.lastDy, gestureMs);
  }, []);

  const uavAimSessionRef = useRef<UavAimGestureSession | null>(null);
  const uavCameraAimRef = useRef(uavCameraAim);
  uavCameraAimRef.current = uavCameraAim;

  const logClient = useCallback(
    (line: string) => {
      onTaskClientLog?.(`${new Date().toLocaleTimeString()} ${line}`);
    },
    [onTaskClientLog],
  );

  const logClientForUavRef = useRef(logClient);
  logClientForUavRef.current = logClient;

  const rectTypeFromBoxId = (boxId: string | null | undefined): number => {
    const id = (boxId ?? "").toLowerCase();
    if (id.startsWith("plane")) return 2; // m_nPlaneType
    if (id.startsWith("boat")) return 4; // m_nShipType
    if (id.startsWith("single")) return 4;
    return 4;
  };

  const rectTypeFromDetectionBox = (box: EoDetectionBox | null | undefined): number => {
    if (box?.rectTypeId != null && Number.isFinite(box.rectTypeId) && box.rectTypeId > 0) {
      return box.rectTypeId;
    }
    return rectTypeFromBoxId(box?.id);
  };

  /** Qt `SendUavFlightTask`：`videoDetectType` 0 海 / 1 空 */
  const uavVideoDetectTypeFromBox = (box: EoDetectionBox, rawRectType: number): 0 | 1 => {
    const id = box.id.toLowerCase();
    if (id.startsWith("plane") || id.startsWith("bird")) return 1;
    if (rawRectType === 1 || rawRectType === 2) return 1;
    return 0;
  };

  const enqueuePtzDragOp = useCallback((op: () => Promise<void>) => {
    const next = ptzDragQueueRef.current.then(op, op);
    ptzDragQueueRef.current = next.catch(() => {});
    return next;
  }, []);

  const clearPtzLongPressTimer = useCallback(() => {
    if (ptzLongPressTimerRef.current != null) {
      clearTimeout(ptzLongPressTimerRef.current);
      ptzLongPressTimerRef.current = null;
    }
  }, []);

  const clearPtzDragKeepAlive = useCallback(() => {
    if (ptzDragKeepAliveRef.current != null) {
      clearInterval(ptzDragKeepAliveRef.current);
      ptzDragKeepAliveRef.current = null;
    }
  }, []);

  const ensurePtzDragKeepAlive = useCallback(() => {
    if (!dragStateRef.current.longPressMode) return;
    clearPtzDragKeepAlive();
    ptzDragKeepAliveRef.current = setInterval(() => {
      const st = dragStateRef.current;
      if (!st.active || st.stopRequested || !st.longPressMode) {
        clearPtzDragKeepAlive();
        return;
      }
      startDragPtzRef.current();
    }, PTZ_DRAG_MOVE_KEEPALIVE_MS);
  }, [clearPtzDragKeepAlive]);

  ensurePtzDragKeepAliveRef.current = ensurePtzDragKeepAlive;

  const beginPtzLongPressIfReady = useCallback(() => {
    const st = dragStateRef.current;
    if (!st.active || st.stopRequested || st.longPressMode) return;
    const gestureMs = Math.max(0, Date.now() - st.startedAt);
    if (gestureMs < PTZ_SLOW_DRAG_ENTER_MS) return;
    const { direction } = resolvePtzDragFromDelta(st.lastDx, st.lastDy, gestureMs);
    if (!direction) return;
    st.longPressMode = true;
    startDragPtzRef.current({ force: true });
    ensurePtzDragKeepAliveRef.current();
  }, []);

  const schedulePtzLongPressTimer = useCallback(() => {
    clearPtzLongPressTimer();
    ptzLongPressTimerRef.current = setTimeout(() => {
      ptzLongPressTimerRef.current = null;
      beginPtzLongPressIfReady();
    }, PTZ_SLOW_DRAG_ENTER_MS);
  }, [beginPtzLongPressIfReady, clearPtzLongPressTimer]);

  const postDragMoveInternal = useCallback(
    async (override?: { dx: number; dy: number; gestureMs: number; flick?: boolean }) => {
    const { direction: dir, speed } = override
      ? override.flick
        ? resolvePtzFlickRelease(override.dx, override.dy, override.gestureMs)
        : resolvePtzDragFromDelta(override.dx, override.dy, override.gestureMs)
      : resolveDragMove();
    if (!dir) return false;

    const res = await postEoPtzMove({
      entityId: trimmedEntityId,
      backendBaseUrl: taskBackendBaseUrl,
      direction: dir,
      speed,
    });
    const outcome = await readEoPtzTaskResponse(res);
    if (!outcome.executed) {
      logClient(
        `拖动云台 ${dir} 未执行 HTTP ${res.status}${outcome.detail ? `: ${outcome.detail.slice(0, 120)}` : ""}`,
      );
      return false;
    }
    const meta = ptzDragMoveMetaRef.current;
    meta.dir = dir;
    meta.speed = speed;
    meta.sentAt = Date.now();
    meta.confirmed = true;
    dragStateRef.current.direction = dir;
    dragStateRef.current.moveSent = true;
    return true;
  },
    [logClient, resolveDragMove, taskBackendBaseUrl, trimmedEntityId],
  );

  const postDragStopInternal = useCallback(async () => {
    const res = await postEoPtzStop({ entityId: trimmedEntityId, backendBaseUrl: taskBackendBaseUrl });
    const outcome = await readEoPtzTaskResponse(res);
    if (!outcome.executed) {
      logClient(
        `拖动云台停止未确认 HTTP ${res.status}${outcome.detail ? `: ${outcome.detail.slice(0, 120)}` : ""}`,
      );
    }
    return outcome.executed;
  }, [logClient, taskBackendBaseUrl, trimmedEntityId]);

  const postDragStopConfirmed = useCallback(async () => {
    const ok = await postDragStopInternal();
    if (!ok) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, PTZ_STOP_RETRY_MS);
      });
      await postDragStopInternal();
    }
  }, [postDragStopInternal]);

  const stopDragPtz = useCallback(() => {
    const stopSession = dragStateRef.current.session;
    const gestureStartedAt = dragStateRef.current.startedAt;
    const dirSnapshot = ptzDragMoveMetaRef.current.dir ?? dragStateRef.current.direction;
    const hadMove = ptzDragMoveMetaRef.current.confirmed || dragStateRef.current.moveSent;
    const dxSnapshot = dragStateRef.current.lastDx;
    const dySnapshot = dragStateRef.current.lastDy;

    clearPtzDragKeepAlive();
    clearPtzLongPressTimer();

    return enqueuePtzDragOp(async () => {
      const staleSession = () => dragStateRef.current.session !== stopSession;

      const meta = ptzDragMoveMetaRef.current;
      const gestureMs = Math.max(0, Date.now() - gestureStartedAt);
      const flickDist = Math.hypot(dxSnapshot, dySnapshot);
      const resolved = resolvePtzFlickRelease(dxSnapshot, dySnapshot, gestureMs);
      const dir = resolved.direction ?? meta.dir ?? dragStateRef.current.direction ?? dirSnapshot;
      const shouldStop = Boolean(dir) || hadMove || meta.confirmed;
      const isQuickDrag = isQuickFlickGesture(gestureMs, flickDist);

      if (dir && isQuickDrag) {
        const { burstCount, pulseGapMs, holdMs } = quickFlickPulseBudget(flickDist);
        const burstOverride = { dx: dxSnapshot, dy: dySnapshot, gestureMs, flick: true as const };
        for (let i = 0; i < burstCount; i += 1) {
          try {
            await postDragMoveInternal(burstOverride);
          } catch (e) {
            logClient(`快甩 move 失败：${e instanceof Error ? e.message : String(e)}`);
          }
          if (i < burstCount - 1 && pulseGapMs > 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, pulseGapMs);
            });
          }
        }
        if (holdMs > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, holdMs);
          });
        }
      } else if (dir && !staleSession()) {
        const holdLeft = PTZ_DRAG_STOP_MIN_HOLD_MS - (Date.now() - meta.sentAt);
        if (holdLeft > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, holdLeft);
          });
        }
      }

      if (shouldStop) {
        try {
          dragStateRef.current.stopRequested = true;
          await postDragStopConfirmed();
        } catch (e) {
          logClient(`拖动云台停止失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (staleSession()) return;

      meta.dir = null;
      meta.speed = { pan: 0.12, tilt: 0.12 };
      meta.sentAt = 0;
      meta.confirmed = false;
      dragStateRef.current.direction = null;
      dragStateRef.current.moveSent = false;
      dragStateRef.current.stopRequested = false;
    });
  }, [clearPtzDragKeepAlive, clearPtzLongPressTimer, enqueuePtzDragOp, logClient, postDragMoveInternal, postDragStopConfirmed]);

  const startDragPtz = useCallback(
    (opts?: { force?: boolean; releaseFlush?: boolean }) => {
      const { direction: dir, speed } = resolveDragMove();
      if (!dir) return;

      const dragSession = dragStateRef.current.session;
      const force = opts?.force === true;
      const releaseFlush = opts?.releaseFlush === true;
      void enqueuePtzDragOp(async () => {
        const st = dragStateRef.current;
        if (st.session !== dragSession) return;
        if (!releaseFlush && st.stopRequested) return;

        const meta = ptzDragMoveMetaRef.current;
        const gestureMs = Math.max(0, Date.now() - st.startedAt);
        if (!releaseFlush && gestureMs < PTZ_SLOW_DRAG_ENTER_MS && !st.longPressMode) {
          return;
        }
        if (!force) {
          if (meta.dir === dir && meta.confirmed && !ptzSpeedChanged(meta.speed, speed)) {
            if (Date.now() - meta.sentAt < PTZ_DRAG_MOVE_RESEND_MS) return;
          } else if (meta.dir === dir && !meta.confirmed) {
            if (Date.now() - meta.sentAt < PTZ_DRAG_MOVE_RETRY_MS) return;
          }
        }
        if (meta.dir && ptzDirectionChangeNeedsStop(meta.dir as EoPtzDragDirection, dir)) {
          try {
            await postDragStopInternal();
          } catch (e) {
            logClient(`换向停止失败：${e instanceof Error ? e.message : String(e)}`);
          }
          meta.dir = null;
          meta.speed = { pan: 0.5, tilt: 0.5 };
          meta.sentAt = 0;
          meta.confirmed = false;
        }

        try {
          logClient(
            `拖动云台方向=${dir} pan=${speed.pan.toFixed(2)} tilt=${speed.tilt.toFixed(2)}`,
          );
          const ok = await postDragMoveInternal();
          if (!ok) {
            meta.dir = dir;
            meta.speed = speed;
            meta.sentAt = Date.now();
            meta.confirmed = false;
            dragStateRef.current.direction = null;
          }
        } catch (e) {
          meta.dir = dir;
          meta.speed = speed;
          meta.sentAt = Date.now();
          meta.confirmed = false;
          dragStateRef.current.direction = null;
          logClient(`拖动云台 ${dir} 异常：${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },
    [enqueuePtzDragOp, logClient, postDragMoveInternal, postDragStopInternal, resolveDragMove],
  );

  startDragPtzRef.current = startDragPtz;

  useEffect(() => {
    if (!canSendSingleTrack) return;
    const root = stageRef.current;
    if (!root) return;

    const cancelPtzArrowFrame = () => {
      if (ptzArrowRafRef.current != null) {
        cancelAnimationFrame(ptzArrowRafRef.current);
        ptzArrowRafRef.current = null;
      }
    };

    const queuePtzArrow = (next: EoPtzDragArrowBox | null) => {
      ptzArrowPendingRef.current = next;
      if (ptzArrowRafRef.current != null) return;
      ptzArrowRafRef.current = requestAnimationFrame(() => {
        ptzArrowRafRef.current = null;
        setPtzDragArrow(ptzArrowPendingRef.current);
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      clearPtzDragKeepAlive();
      clearPtzLongPressTimer();
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      dragStateRef.current.session += 1;
      ptzDragQueueRef.current = Promise.resolve();
      ptzDragMoveMetaRef.current = {
        dir: null,
        speed: { pan: 0.5, tilt: 0.5 },
        sentAt: 0,
        confirmed: false,
      };
      dragStateRef.current.active = true;
      dragStateRef.current.stopRequested = false;
      dragStateRef.current.moveSent = false;
      dragStateRef.current.longPressMode = false;
      dragStateRef.current.startedAt = Date.now();
      dragStateRef.current.pointerId = e.pointerId;
      dragStateRef.current.startX = e.clientX;
      dragStateRef.current.startY = e.clientY;
      dragStateRef.current.lastDx = 0;
      dragStateRef.current.lastDy = 0;
      dragStateRef.current.direction = null;
      schedulePtzLongPressTimer();
    };

    const onPointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || st.pointerId !== e.pointerId) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      st.lastDx = dx;
      st.lastDy = dy;
      const r = root.getBoundingClientRect();
      const dist = Math.hypot(dx, dy);
      if (dist > PTZ_ARROW_SHOW_MIN_PX) {
        queuePtzArrow({
          x0: st.startX - r.left,
          y0: st.startY - r.top,
          x1: e.clientX - r.left,
          y1: e.clientY - r.top,
          w: r.width,
          h: r.height,
        });
      } else {
        cancelPtzArrowFrame();
        ptzArrowPendingRef.current = null;
        setPtzDragArrow(null);
      }
      const gestureMs = Math.max(0, Date.now() - st.startedAt);
      const { direction } = resolvePtzDragFromDelta(dx, dy, gestureMs);
      if (!direction) return;
      if (gestureMs >= PTZ_SLOW_DRAG_ENTER_MS) {
        if (!st.longPressMode) {
          st.longPressMode = true;
        }
        startDragPtz();
        ensurePtzDragKeepAlive();
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || st.pointerId !== e.pointerId) return;
      clearPtzDragKeepAlive();
      clearPtzLongPressTimer();
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      st.lastDx = e.clientX - st.startX;
      st.lastDy = e.clientY - st.startY;
      st.active = false;
      st.pointerId = null;
      st.longPressMode = false;
      const gestureMs = Math.max(0, Date.now() - st.startedAt);
      const flickDist = Math.hypot(st.lastDx, st.lastDy);
      const isQuick = isQuickFlickGesture(gestureMs, flickDist);
      if (!isQuick && resolvePtzDragFromDelta(st.lastDx, st.lastDy, gestureMs).direction) {
        startDragPtz({ force: true, releaseFlush: true });
      }
      void stopDragPtz();
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      clearPtzDragKeepAlive();
      clearPtzLongPressTimer();
      const st = dragStateRef.current;
      st.active = false;
      st.pointerId = null;
      void stopDragPtz();
    };
  }, [
    canSendSingleTrack,
    clearPtzDragKeepAlive,
    clearPtzLongPressTimer,
    ensurePtzDragKeepAlive,
    schedulePtzLongPressTimer,
    stageRef,
    startDragPtz,
    stopDragPtz,
  ]);

  const uavAimInteractionsEnabled = Boolean(
    uavCameraAim?.airportDeviceSn?.trim() &&
      uavCameraAim?.payloadIndex?.trim() &&
      uavCameraAim.allowAim &&
      uavCameraAim.hasControlAuth,
  );

  /**
   * 无人机：拖拽松开发 camera_aim（与光电 PTZ 一致：`pointermove`/`pointerup` 绑在 window，不设 pointerCapture）。
   * 依赖 `signalingUrl`：流地址就绪后常会重挂组件，补绑监听；`uavAimInteractionsEnabled` 仅随舱外/控制权等变化。
   * Qt：`vectorAB = press - release`，`D = center + vectorAB`，`dx = D.x/w`，`dy = D.y/h`
   */
  useEffect(() => {
    if (!uavAimInteractionsEnabled) return;
    const root = stageRef.current;
    if (!root) return;

    const cancelPtzArrowFrame = () => {
      if (ptzArrowRafRef.current != null) {
        cancelAnimationFrame(ptzArrowRafRef.current);
        ptzArrowRafRef.current = null;
      }
    };

    const queuePtzArrow = (next: EoPtzDragArrowBox | null) => {
      ptzArrowPendingRef.current = next;
      if (ptzArrowRafRef.current != null) return;
      ptzArrowRafRef.current = requestAnimationFrame(() => {
        ptzArrowRafRef.current = null;
        setPtzDragArrow(ptzArrowPendingRef.current);
      });
    };

    const logUav = (line: string) => {
      logClientForUavRef.current?.(line);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tgt = e.target;
      if (tgt instanceof Element && tgt.closest?.("button, [role='button'], a, input, textarea, select")) {
        return;
      }
      const ctx = uavCameraAimRef.current;
      if (
        !ctx ||
        !ctx.airportDeviceSn.trim() ||
        !ctx.payloadIndex.trim() ||
        !ctx.allowAim ||
        !ctx.hasControlAuth
      ) {
        return;
      }
      const r = root.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      ) {
        return;
      }

      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      uavAimSessionRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        deviceSn: ctx.airportDeviceSn.trim(),
        payloadIndex: ctx.payloadIndex.trim(),
      };
      /** 削弱浏览器默认拖拽/长按菜单与图片拖动；无人机画面无双击跟踪 */
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const sess = uavAimSessionRef.current;
      if (!sess || sess.pointerId !== e.pointerId) return;
      const r = root.getBoundingClientRect();
      const dx = e.clientX - sess.startClientX;
      const dy = e.clientY - sess.startClientY;
      const dist = Math.hypot(dx, dy);
      if (dist > PTZ_ARROW_SHOW_MIN_PX) {
        queuePtzArrow({
          x0: sess.startClientX - r.left,
          y0: sess.startClientY - r.top,
          x1: e.clientX - r.left,
          y1: e.clientY - r.top,
          w: r.width,
          h: r.height,
        });
      } else {
        cancelPtzArrowFrame();
        ptzArrowPendingRef.current = null;
        setPtzDragArrow(null);
      }
    };

    const finish = (e: PointerEvent) => {
      const sess = uavAimSessionRef.current;
      if (!sess || sess.pointerId !== e.pointerId) return;

      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      uavAimSessionRef.current = null;

      const rr = root.getBoundingClientRect();
      const nw = rr.width;
      const nh = rr.height;
      if (nw <= 0 || nh <= 0) return;

      const relPressX = sess.startClientX - rr.left;
      const relPressY = sess.startClientY - rr.top;
      const relReleaseX = e.clientX - rr.left;
      const relReleaseY = e.clientY - rr.top;

      const vx = relPressX - relReleaseX;
      const vy = relPressY - relReleaseY;
      if (Math.abs(vx) < 1e-9 && Math.abs(vy) < 1e-9) return;

      const cx = nw / 2;
      const cy = nh / 2;
      const Dx = cx + vx;
      const Dy = cy + vy;
      const normX = Dx / nw;
      const normY = Dy / nh;

      const deviceSn = sess.deviceSn;
      const payloadIndex = sess.payloadIndex;

      void (async () => {
        try {
          logUav(`拖动瞄准 camera_aim 归一化 (${normX.toFixed(4)}, ${normY.toFixed(4)})`);
          const res = await postUavCameraAim({
            deviceSn,
            payloadIndex,
            x: normX,
            y: normY,
            cameraType: "zoom",
            locked: false,
          });
          if (!res.ok) {
            logUav(`camera_aim HTTP 失败 ${res.status}${res.detail ? `: ${res.detail.slice(0, 200)}` : ""}`);
          }
        } catch (err) {
          logUav(`camera_aim 异常：${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", finish, { passive: true });
    window.addEventListener("pointercancel", finish, { passive: true });
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      uavAimSessionRef.current = null;
    };
  }, [uavAimInteractionsEnabled, signalingUrl]);

  useEffect(() => {
    if (!canSendSingleTrack) return;
    const root = stageRef.current;
    if (!root) return;

    const clearWheelStopTimer = () => {
      if (wheelZoomStopTimerRef.current) {
        clearTimeout(wheelZoomStopTimerRef.current);
        wheelZoomStopTimerRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const combined = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (combined === 0) return;

      const rect = root.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

      if (dragStateRef.current.active) return;

      const now = Date.now();
      if (now < wheelZoomLockUntilRef.current) {
        e.preventDefault();
        return;
      }

      /** 与 Qt「delta>0 变倍+」的常见鼠标方向对齐：向上滚（deltaY<0）→ ZOOM_IN */
      const direction: EoPtzDirection = combined < 0 ? "ZOOM_IN" : "ZOOM_OUT";
      const numSteps = Math.max(1, Math.round(Math.abs(combined) / 120));
      const cooldownMs = 350 * numSteps;

      e.preventDefault();
      e.stopPropagation();

      wheelZoomLockUntilRef.current = now + cooldownMs;
      clearWheelStopTimer();

      void (async () => {
        try {
          const res = await postEoPtzMove({
            entityId: trimmedEntityId,
            backendBaseUrl: taskBackendBaseUrl,
            direction,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            logClient(`滚轮变倍 ${direction} 失败 HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
          }
        } catch (err) {
          logClient(`滚轮变倍异常：${err instanceof Error ? err.message : String(err)}`);
        }
      })();

      wheelZoomStopTimerRef.current = setTimeout(() => {
        wheelZoomStopTimerRef.current = null;
        void postEoPtzStop({ entityId: trimmedEntityId, backendBaseUrl: taskBackendBaseUrl }).then(
          (res) => {
            if (!res.ok) {
              void res.text().then((t) => {
                logClient(`滚轮变倍停止失败 HTTP ${res.status}${t ? `: ${t.slice(0, 100)}` : ""}`);
              });
            }
          },
          (err) => logClient(`滚轮变倍停止异常：${err instanceof Error ? err.message : String(err)}`),
        );
      }, 320);
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      clearWheelStopTimer();
      wheelZoomLockUntilRef.current = 0;
      void postEoPtzStop({ entityId: trimmedEntityId, backendBaseUrl: taskBackendBaseUrl }).catch(() => {});
    };
  }, [canSendSingleTrack, logClient, stageRef, taskBackendBaseUrl, trimmedEntityId]);

  const handleDoubleClickPoint = useCallback(
    async (payload: { normalizedX: number; normalizedY: number; hitBoxId: string | null; hitBox: EoDetectionBox | null }) => {
      logClient(
        `双击命中 norm=(${payload.normalizedX.toFixed(4)},${payload.normalizedY.toFixed(4)}) box=${payload.hitBoxId ?? "无"}`,
      );

      if (canSendUavImgTrack) {
        if (taskBusy) {
          logClient("中止：上一无人机跟踪任务仍在发送中");
          return;
        }
        const nearMulti = pickMultiTargetBoxNearPoint(
          detectionBoxes,
          payload.normalizedX,
          payload.normalizedY,
        );
        const hitIsMultiTargetBox =
          (payload.hitBox != null && payload.hitBox.variant !== "singleTrack") || nearMulti != null;

        if (uavTrackingActive && !hitIsMultiTargetBox) {
          logClient("已在无人机图像跟踪：双击空白/非多目标框 -> 发送停止任务");
          setTaskBusy(true);
          setTaskHint("正在取消无人机跟踪…");
          try {
            await onUavStopTrackingTask?.();
            setTaskHint("已发送取消无人机跟踪");
            logClient("HTTP 流程结束（取消 DroneIMGTracking）");
          } catch (e) {
            setTaskHint(`取消失败：${e instanceof Error ? e.message : String(e)}`);
            logClient(`HTTP 失败（取消）：${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setTaskBusy(false);
          }
          return;
        }

        let hit = payload.hitBox ?? nearMulti;
        if (!hit && selectedBoxId) {
          hit = detectionBoxes.find((b) => b.id === selectedBoxId) ?? null;
        }
        if (!hit) {
          setTaskHint("当前无检测框，无法发起无人机跟踪");
          logClient("中止：无检测框（对齐 Qt getCurrentRect 为空）");
          return;
        }

        let rectId = -1;
        if (hit.trackId !== undefined && Number.isFinite(hit.trackId)) {
          rectId = Math.trunc(hit.trackId);
        } else {
          const hm = hit.id.match(/-(\d+)$/);
          rectId = hm ? Number(hm[1]) : -1;
        }
        if (rectId <= 0) {
          setTaskHint("检测框 id 无法解析为跟踪号");
          logClient(`中止：rectId 无效 hit.id=${hit.id}`);
          return;
        }

        const rawRectType = rectTypeFromDetectionBox(hit);
        const videoDetectType = uavVideoDetectTypeFromBox(hit, rawRectType);
        logClient(
          `准备 DroneIMGTracking rectID=${rectId} videoDetectType=${videoDetectType} airport=${uavAirportSn?.trim() ?? ""}`,
        );
        setTaskBusy(true);
        setTaskHint("正在发送无人机目标跟踪任务…");
        try {
          await onUavImgTrackingTask!({ rectId, videoDetectType });
          setTaskHint("无人机目标跟踪任务已发送");
          logClient("HTTP 流程结束（DroneIMGTracking）");
        } catch (e) {
          setTaskHint(`发送失败：${e instanceof Error ? e.message : String(e)}`);
          logClient(`HTTP 失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setTaskBusy(false);
        }
        return;
      }

      if (!canSendSingleTrack) {
        setTaskHint("当前非相机实体，未发送目标跟踪任务");
        logClient("中止：非 camera_XXX 实体");
        return;
      }
      if (taskBusy) {
        logClient("中止：上一跟踪任务仍在发送中");
        return;
      }

      const inSingleTrackUi =
        ddsSingleTrackActive || detectionBoxes.some((b) => b.variant === "singleTrack");
      const nearMulti = pickMultiTargetBoxNearPoint(
        detectionBoxes,
        payload.normalizedX,
        payload.normalizedY,
      );
      const hitIsMultiTargetBox =
        (payload.hitBox != null && payload.hitBox.variant !== "singleTrack") || nearMulti != null;
      const shouldCancelSingleTrack = inSingleTrackUi && !hitIsMultiTargetBox;

      if (shouldCancelSingleTrack) {
        logClient(
          `已在单目标跟踪：双击${payload.hitBox ? `框 ${payload.hitBox.id}` : "空白"} -> 发送取消跟踪（trackAction=0）`,
        );
        setTaskBusy(true);
        setTaskHint("正在取消目标跟踪…");
        try {
          clearEoSingleTrackUserLatch(trimmedEntityId);
          await onSingleTrackTask({
            rectId: 0,
            rectType: 0,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            trackAction: 0,
          });
          setTaskHint("已发送取消跟踪任务");
          logClient("HTTP 流程结束（取消跟踪）");
        } catch (e) {
          setTaskHint(`取消失败：${e instanceof Error ? e.message : String(e)}`);
          logClient(`HTTP 失败（取消）：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setTaskBusy(false);
        }
        return;
      }

      let hit = payload.hitBox ?? nearMulti;
      if (!hit && selectedBoxId) {
        hit = detectionBoxes.find((b) => b.id === selectedBoxId) ?? null;
      }
      if (!hit) {
        const near = pickDetectionBoxClosestToVideoCenter(
          detectionBoxes.filter((b) => b.variant !== "singleTrack"),
        );
        if (near) {
          hit = near;
          logClient(
            `空白双击：按 Qt CheckFindRect 取距画面中心最近的框 id=${near.id} centerNorm=(${(near.x + near.w / 2).toFixed(3)},${(near.y + near.h / 2).toFixed(3)})`,
          );
        }
      }

      const video = videoRef.current;
      const wc = webCodecsPresentationRef.current;
      const presentationVw =
        (video?.videoWidth ?? 0) > 0
          ? video!.videoWidth
          : wc.active && wc.width > 0
            ? wc.width
            : overlayIntrinsic.w ?? 0;
      const presentationVh =
        (video?.videoHeight ?? 0) > 0
          ? video!.videoHeight
          : wc.active && wc.height > 0
            ? wc.height
            : overlayIntrinsic.h ?? 0;
      const vw = (hit?.frameWidth ?? 0) > 0 ? hit!.frameWidth! : presentationVw;
      const vh = (hit?.frameHeight ?? 0) > 0 ? hit!.frameHeight! : presentationVh;
      if (vw <= 0 || vh <= 0) {
        setTaskHint("视频分辨率未就绪，稍后重试");
        logClient(`中止：画面未就绪 vw=${vw} vh=${vh} pres=${presentationVw}x${presentationVh}`);
        return;
      }

      let x = 0;
      let y = 0;
      let width = 0;
      let height = 0;
      let rectId = -1;
      let rectType = 4;

      if (hit) {
        if (
          (hit.frameWidth ?? 0) > 0 &&
          (presentationVw > 0 || presentationVh > 0) &&
          (hit.frameWidth !== presentationVw || hit.frameHeight !== presentationVh)
        ) {
          logClient(
            `检测帧 ${hit.frameWidth}x${hit.frameHeight} ≠ 呈现 ${presentationVw}x${presentationVh}，跟踪 bbox 用检测帧`,
          );
        }
        x = hit.x * vw;
        y = hit.y * vh;
        width = hit.w * vw;
        height = hit.h * vh;
        rectType = rectTypeFromDetectionBox(hit);
        if (hit.trackId !== undefined && Number.isFinite(hit.trackId)) {
          rectId = Math.trunc(hit.trackId);
        } else {
          const hm = hit.id.match(/-(\d+)$/);
          rectId = hm ? Number(hm[1]) : -1;
        }
      } else {
        setTaskHint("当前无检测框，无法发起跟踪");
        logClient("中止：无检测框（对齐 Qt CheckFindRect 结果为空）");
        return;
      }
      x = Math.max(0, Math.min(vw - width, x));
      y = Math.max(0, Math.min(vh - height, y));

      if (rectId < 0) {
        setTaskHint("检测框 id 无法解析为跟踪号");
        logClient(`中止：rectId 无效 hit.id=${hit.id}`);
        return;
      }

      logClient(
        `准备请求 rectId=${rectId} rectType=${rectType} 像素框 x=${Math.round(x)} y=${Math.round(y)} w=${Math.round(width)} h=${Math.round(height)}`,
      );
      const cameraMetaTask = {
        entityId: trimmedEntityId,
        taskType: "SingleTrack",
        trackAction: 1,
        rectId,
        rectType,
        boundingBox: {
          x,
          y,
          width,
          height,
        },
      };
      logClient(`CameraMetaTask => ${JSON.stringify(cameraMetaTask)}`);
      armEoSingleTrackUserLatch(trimmedEntityId);
      setTaskBusy(true);
      setTaskHint("正在发送目标跟踪任务…");
      try {
        await onSingleTrackTask({ rectId, rectType, x, y, width, height, trackAction: 1 });
        setTaskHint("目标跟踪任务已发送");
        logClient("HTTP 流程结束（见下方请求/返回区）");
      } catch (e) {
        setTaskHint(`发送失败：${e instanceof Error ? e.message : String(e)}`);
        logClient(`HTTP 失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setTaskBusy(false);
      }
    },
    [canSendSingleTrack, canSendUavImgTrack, ddsSingleTrackActive, detectionBoxes, logClient, onSingleTrackTask, onUavImgTrackingTask, onUavStopTrackingTask, overlayIntrinsic.h, overlayIntrinsic.w, rectTypeFromDetectionBox, selectedBoxId, taskBusy, trimmedEntityId, uavAirportSn, uavTrackingActive, videoRef],
  );

  useEffect(() => {
    if (!onBottomCenterToast) return;
    const text = taskBusy ? taskHint.trim() || "任务处理中…" : taskHint.trim();
    if (!text) return;
    const tone: "success" | "error" | "warn" = /失败|错误|取消失败|HTTP/i.test(text)
      ? "error"
      : /正在|处理中|…|\.\.\./.test(text)
        ? "warn"
        : "success";
    onBottomCenterToast({ text, tone });
  }, [taskHint, taskBusy, onBottomCenterToast]);

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative h-full min-h-0 flex-1 overflow-hidden bg-black",
        uavAimInteractionsEnabled && "touch-manipulation",
        className,
      )}
      onContextMenu={
        uavAimInteractionsEnabled
          ? (ev) => {
              ev.preventDefault();
            }
          : undefined
      }
    >
      <EoVideoViewport
        signalingUrl={signalingUrl}
        iceServers={iceServers}
        enabled
        videoRef={videoRef}
        peerConnectionRef={exposePeerForDetection ? peerConnectionRef : undefined}
        encodedSyncHub={showDetection ? encodedSyncHub : undefined}
        videoReceiverRef={showDetection ? videoReceiverRef : undefined}
        streamLabel={streamLabel}
        webCodecsPresentationRef={webCodecsPresentationRef}
        videoObjectFit={videoObjectFit}
      />
      {ptzDragArrow ? <EoPtzDragArrowOverlay box={ptzDragArrow} /> : null}
      {!onOverlayTaskLine && !onBottomCenterToast && taskHint ? (
        <div
          className={cn(
            "pointer-events-none absolute top-2 z-30 max-w-[280px] truncate rounded border border-white/10 bg-black/65 px-2 py-0.5 text-[10px] text-nexus-text-secondary",
            sideToolbarReserved ? "right-[4.25rem]" : "right-2",
          )}
        >
          {taskHint}
        </div>
      ) : null}
      {showDetection ? (
        <EoVideoDetectionLayer
          entityId={entityId?.trim()}
          enabled={Boolean(detectionEnabled)}
          containerRef={stageRef as React.RefObject<HTMLElement | null>}
          videoRef={videoRef}
          encodedSyncHub={encodedSyncHub}
          videoReceiverRef={videoReceiverRef}
          selectedBoxId={selectedBoxId}
          onSelectBox={onSelectBox}
          onDoubleClickPoint={handleDoubleClickPoint}
          onDiagnostic={onDetectionDiagnostic}
          onBoxesChange={onDetectionBoxesChange}
          videoObjectFit={videoObjectFit}
          videoIntrinsicWidth={overlayIntrinsic.w}
          videoIntrinsicHeight={overlayIntrinsic.h}
          webCodecsPresentationRef={webCodecsPresentationRef}
          expandedMode={expandedMode}
          ddsCameraEntityId={ddsCameraEntityId}
          interactive={detectionInteractive}
        />
      ) : showTrackHitLayer ? (
        <EoDetectionOverlay
          containerRef={stageRef as React.RefObject<HTMLElement | null>}
          videoRef={videoRef}
          boxes={[]}
          detectionEntityId={entityId?.trim()}
          ddsCameraEntityId={ddsCameraEntityId}
          expandedMode={expandedMode}
          selectedBoxId={selectedBoxId}
          onSelectBox={onSelectBox}
          onDoubleClickPoint={handleDoubleClickPoint}
          videoObjectFit={videoObjectFit}
          videoIntrinsicWidth={overlayIntrinsic.w}
          videoIntrinsicHeight={overlayIntrinsic.h}
          interactive
        />
      ) : null}
      {taskBusy ? <div className="pointer-events-none absolute inset-0 z-20" /> : null}
    </div>
  );
}

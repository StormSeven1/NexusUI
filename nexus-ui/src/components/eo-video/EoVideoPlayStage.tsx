"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import { useWebCodecsCanvas } from "@/hooks/useWebCodecsCanvas";
import { postEoPtzMove, postEoPtzStop, type EoPtzDirection } from "@/lib/eo-video/eoPtzTaskClient";
import { postUavCameraAim } from "@/lib/eo-video/postUavCameraAim";
import type { EoDetectionBox, EoVideoIceServer } from "@/lib/eo-video/types";
import { cn } from "@/lib/utils";
import { EoDetectionOverlay } from "./EoDetectionOverlay";
import { EoPtzDragArrowOverlay, type EoPtzDragArrowBox } from "./EoPtzDragArrowOverlay";
import { EoVideoDetectionLayer } from "./EoVideoDetectionLayer";
import { EoVideoViewport } from "./EoVideoViewport";

const PTZ_DRAG_TRIGGER_PX = 14;
/** 按下后超过该像素即显示拖动箭头（早于云台方向触发阈值，便于看见反馈） */
const PTZ_ARROW_SHOW_MIN_PX = 4;

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
}: EoVideoPlayStageProps) {
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskHint, setTaskHint] = useState("");
  const [ptzDragArrow, setPtzDragArrow] = useState<EoPtzDragArrowBox | null>(null);
  const trimmedEntityId = entityId?.trim() ?? "";
  const showDetection = Boolean(trimmedEntityId && detectionEnabled);
  /** 与 Qt 一致：相机实体即可双击发任务；检测 WS 关闭时仍要有叠层接收双击 */
  const showTrackHitLayer = Boolean(trimmedEntityId && /^camera_[0-9]{3}$/i.test(trimmedEntityId));
  const canSendSingleTrack = /^camera_[0-9]{3}$/i.test(trimmedEntityId);
  const encodedSyncHub = useMemo(() => createEoEncodedSyncHub(), []);
  const webCodecsHandle = useWebCodecsCanvas();
  const videoReceiverRef = useRef<RTCRtpReceiver | null>(null);

  useEffect(() => {
    const syncReady = () => {
      const v = videoRef.current;
      const videoOk = Boolean(v && v.videoWidth > 0 && v.videoHeight > 0);
      const canvasOk = Boolean(
        showDetection &&
          webCodecsHandle.webCodecsActive &&
          webCodecsHandle.videoWidth > 0 &&
          webCodecsHandle.videoHeight > 0,
      );
      onCaptureReadyChange?.(videoOk || canvasOk);
      if (snapshotCanvasRef) {
        snapshotCanvasRef.current =
          showDetection && webCodecsHandle.webCodecsActive ? webCodecsHandle.canvasRef.current : null;
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
  }, [
    showDetection,
    onCaptureReadyChange,
    snapshotCanvasRef,
    webCodecsHandle.webCodecsActive,
    webCodecsHandle.videoWidth,
    webCodecsHandle.videoHeight,
    videoRef,
  ]);

  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    direction: EoPtzDirection | null;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    direction: null,
  });
  /** 对齐 PtzMainWidget::wheelEvent：节流间隔约 350ms × 刻度步数 */
  const wheelZoomLockUntilRef = useRef(0);
  const wheelZoomStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ptzArrowRafRef = useRef<number | null>(null);
  const ptzArrowPendingRef = useRef<EoPtzDragArrowBox | null>(null);

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

  const stopDragPtz = useCallback(async () => {
    const st = dragStateRef.current;
    if (!st.direction) return;
    st.direction = null;
    try {
      const res = await postEoPtzStop({ entityId: trimmedEntityId, backendBaseUrl: taskBackendBaseUrl });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logClient(`拖动云台停止失败 HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
      }
    } catch (e) {
      logClient(`拖动云台停止失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [logClient, taskBackendBaseUrl, trimmedEntityId]);

  const startDragPtz = useCallback(
    async (dir: EoPtzDirection) => {
      const st = dragStateRef.current;
      if (st.direction === dir) return;
      if (st.direction) await stopDragPtz();
      st.direction = dir;
      try {
        logClient(`拖动云台方向=${dir}`);
        const res = await postEoPtzMove({ entityId: trimmedEntityId, backendBaseUrl: taskBackendBaseUrl, direction: dir });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          logClient(`拖动云台 ${dir} 失败 HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
          st.direction = null;
        }
      } catch (e) {
        st.direction = null;
        logClient(`拖动云台 ${dir} 异常：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [logClient, stopDragPtz, taskBackendBaseUrl, trimmedEntityId],
  );

  useEffect(() => {
    if (!canSendSingleTrack) return;
    const root = stageRef.current;
    if (!root) return;

    const getDragDirection = (dx: number, dy: number): EoPtzDirection | null => {
      if (Math.hypot(dx, dy) < PTZ_DRAG_TRIGGER_PX) return null;
      if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "RIGHT" : "LEFT";
      return dy >= 0 ? "DOWN" : "UP";
    };

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
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      dragStateRef.current.active = true;
      dragStateRef.current.pointerId = e.pointerId;
      dragStateRef.current.startX = e.clientX;
      dragStateRef.current.startY = e.clientY;
      dragStateRef.current.direction = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || st.pointerId !== e.pointerId) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
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
      const dir = getDragDirection(dx, dy);
      if (!dir) return;
      void startDragPtz(dir);
    };

    const onPointerEnd = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || st.pointerId !== e.pointerId) return;
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      st.active = false;
      st.pointerId = null;
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
      const st = dragStateRef.current;
      st.active = false;
      st.pointerId = null;
      void stopDragPtz();
    };
  }, [canSendSingleTrack, stageRef, startDragPtz, stopDragPtz]);

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
      if (!canSendSingleTrack) {
        setTaskHint("当前非相机实体，未发送目标跟踪任务");
        logClient("中止：非 camera_XXX 实体");
        return;
      }
      const isSingleTracking = detectionBoxes.some((b) => b.variant === "singleTrack");
      if (isSingleTracking) {
        logClient("已在单目标跟踪：二次双击 -> 发送取消跟踪（trackAction=0，对齐 Qt / publishEntity）");
        const cameraMetaTask = {
          entityId: trimmedEntityId,
          taskType: "SingleTrack",
          trackAction: 0,
          rectId: 0,
          rectType: 0,
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        };
        logClient(`CameraMetaTask => ${JSON.stringify(cameraMetaTask)}`);
        setTaskBusy(true);
        setTaskHint("正在取消目标跟踪…");
        try {
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
          logClient("HTTP 流程结束（取消跟踪，见下方请求/返回区）");
        } catch (e) {
          setTaskHint(`取消失败：${e instanceof Error ? e.message : String(e)}`);
          logClient(`HTTP 失败（取消）：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setTaskBusy(false);
        }
        return;
      }

      const video = videoRef.current;
      const vw = video?.videoWidth ?? 0;
      const vh = video?.videoHeight ?? 0;
      if (vw <= 0 || vh <= 0) {
        setTaskHint("视频分辨率未就绪，稍后重试");
        logClient(`中止：video 未就绪 vw=${vw} vh=${vh}`);
        return;
      }

      let hit = payload.hitBox;
      if (!hit) {
        const near = pickDetectionBoxClosestToVideoCenter(detectionBoxes);
        if (near) {
          hit = near;
          logClient(
            `空白双击：按 Qt CheckFindRect 取距画面中心最近的框 id=${near.id} centerNorm=(${(near.x + near.w / 2).toFixed(3)},${(near.y + near.h / 2).toFixed(3)})`,
          );
        }
      }

      let x = 0;
      let y = 0;
      let width = 0;
      let height = 0;
      let rectId = -1;
      let rectType = 4;

      if (hit) {
        x = hit.x * vw;
        y = hit.y * vh;
        width = hit.w * vw;
        height = hit.h * vh;
        rectType = rectTypeFromBoxId(hit.id);
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
    [canSendSingleTrack, detectionBoxes, logClient, onSingleTrackTask, trimmedEntityId, videoRef],
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
        webCodecsHandle={showDetection ? webCodecsHandle : undefined}
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
          videoObjectFit="cover"
          videoIntrinsicWidth={webCodecsHandle.videoWidth}
          videoIntrinsicHeight={webCodecsHandle.videoHeight}
          expandedMode={expandedMode}
          ddsCameraEntityId={ddsCameraEntityId}
        />
      ) : showTrackHitLayer ? (
        <EoDetectionOverlay
          containerRef={stageRef as React.RefObject<HTMLElement | null>}
          videoRef={videoRef}
          boxes={[]}
          selectedBoxId={selectedBoxId}
          onSelectBox={onSelectBox}
          onDoubleClickPoint={handleDoubleClickPoint}
          videoObjectFit="cover"
          videoIntrinsicWidth={webCodecsHandle.videoWidth}
          videoIntrinsicHeight={webCodecsHandle.videoHeight}
        />
      ) : null}
      {taskBusy ? <div className="pointer-events-none absolute inset-0 z-20" /> : null}
    </div>
  );
}

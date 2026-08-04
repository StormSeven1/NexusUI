"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import { postEoPtzAbsolute, postEoPtzMove, postEoPtzStop, type EoPtzDirection } from "@/lib/eo-video/eoPtzTaskClient";
import { postYuan8PickTrackTask } from "@/lib/eo-video/yuan8TaskClient";
import { evaluateThirdPartyTaskHttpResponse } from "@/lib/thirdPartyTaskServiceResponse";
import {
  isPlausibleFovDeg,
  PTZ_ABS_DRAG_MIN_PX,
  resolvePtzAbsoluteFromDrag,
} from "@/lib/eo-video/eoPtzDrag";
import { readEoPtzTaskResponse } from "@/lib/eo-video/cameraTaskResult";
import { postUavCameraAim } from "@/lib/eo-video/postUavCameraAim";
import type { EoDetectionBox, EoVideoIceServer } from "@/lib/eo-video/types";
import { cn } from "@/lib/utils";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  cameraIndexFromOwnerEntityId,
  maxZoomForCameraIndex,
} from "@/lib/camera-management-client";
import { isCameraTrackingExecutionActive } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { isEoBurnInPlaybackUrl } from "@/lib/eo-video/eoBurnInPlayback";
import {
  armEoSingleTrackUserLatch,
  clearEoSingleTrackUserLatch,
  isEoSingleTrackUserLatchActive,
} from "@/lib/eo-video/eoSingleTrackUserLatch";
import { getVideoContentRect, resolveEoVideoIntrinsicSize } from "@/lib/eo-video/videoContentRect";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import type { UavMqttTelemetry } from "@/hooks/useUavMqttDockState";
import { EoDetectionOverlay } from "./EoDetectionOverlay";
import { EoPtzDragArrowOverlay, type EoPtzDragArrowBox } from "./EoPtzDragArrowOverlay";
import { EoUavTrackProjectOverlay } from "./EoUavTrackProjectOverlay";
import { EoVideoDetectionLayer } from "./EoVideoDetectionLayer";
import { resolveEoVideoObjectFit } from "@/lib/eo-video/eoVideoObjectFit";
import { EoVideoViewport } from "./EoVideoViewport";

/** 按下后超过该像素即显示拖动箭头 */
const PTZ_ARROW_SHOW_MIN_PX = 4;

/** 按下时快照：对齐 Qt 用当时 PTZ/FOV 算绝对位移 */
type PtzAbsPressSnapshot = {
  panDeg: number;
  tiltCalc: number;
  /** m_calcZ ∈ [0,1] */
  zoomNorm: number;
  hsDeg: number;
  vsDeg: number;
  pressNormX: number;
  pressNormY: number;
  cameraIndex: number;
};

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
  /**
   * 烧录流：画面已含框/标牌，前端隐藏绘制，但仍订检测 WS + 点击命中，
   * 以便 burn-in-select 让后端烧录框变色。
   */
  bareVideoPlayback?: boolean;
  /**
   * 额外强制隐藏前端检测框绘制（如工具栏勾选「隐藏烧录框/ID」时，
   * 非烧录流也同步隐藏，避免多端观感不一致）。
   */
  suppressDrawnBoxes?: boolean;
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
  /** 递增时强制重建 WebRTC（私有云 start 推流后重连 ZLM） */
  webRtcKickEpoch?: number;
  /** 停帧看门狗间隔（ms）；无人机场景传 6000 与 poke 恢复配合，缺省用相机默认 4000 */
  stallWatchIntervalMs?: number;
  /** 停帧恢复前回调（如无人机 poke 重新拉流），随后自动 WebRTC restart */
  onStallRecover?: () => void;
  /** 放大窗复用小窗 MediaStream，不再二次协商 */
  sharedMediaStream?: MediaStream | null;
  /** 放大窗模式：流未到齐时也不要本窗自建 WebRTC */
  sharedPlaybackOnly?: boolean;
  /** 8院相机：双击画面下发压点跟踪（XJXT 3003） */
  enableYuan8PickTrack?: boolean;
  /**
   * 无人机：航线 + 对海融合航迹画面投影（周士胜算法）。
   * 默认关闭；起飞后由右侧工具栏开关控制。
   */
  uavTrackProjectVisible?: boolean;
  /** 舱外（已起飞）才跑投影 */
  uavTrackProjectAfterTakeoff?: boolean;
  uavTrackProjectDroneSn?: string | null;
  uavTrackProjectMqttTelemetry?: UavMqttTelemetry | null;
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
  bareVideoPlayback = false,
  suppressDrawnBoxes = false,
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
  webRtcKickEpoch,
  stallWatchIntervalMs,
  onStallRecover,
  sharedMediaStream = null,
  sharedPlaybackOnly = false,
  enableYuan8PickTrack = false,
  uavTrackProjectVisible = true,
  uavTrackProjectAfterTakeoff = false,
  uavTrackProjectDroneSn = null,
  uavTrackProjectMqttTelemetry = null,
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
    ddsLookupKey ? isCameraTrackingExecutionActive(s.byEntityId[ddsLookupKey]) : false,
  );
  /** 烧录流：隐藏前端框绘制，保留检测数据与点击选中 */
  const isBurnInPlayback = bareVideoPlayback || isEoBurnInPlaybackUrl(signalingUrl);
  const showDetection = Boolean(trimmedEntityId && detectionEnabled);
  const isUavEntity = /^uav-/i.test(trimmedEntityId);
  /** 与 Qt 一致：相机实体即可双击发任务；检测 WS 关闭时仍要有叠层接收双击；8院同理 */
  const showTrackHitLayer = Boolean(
    trimmedEntityId && (/^camera_[0-9]{3}$/i.test(trimmedEntityId) || enableYuan8PickTrack),
  );
  const canSendSingleTrack = /^camera_[0-9]{3}$/i.test(trimmedEntityId);
  const canSendUavImgTrack = isUavEntity && Boolean(uavAirportSn?.trim() && onUavImgTrackingTask);
  /** 相机可交互叠层；无人机仅穿透双击，不挡 camera_aim 拖拽；8院可双击压点 */
  const detectionInteractive = canSendSingleTrack || enableYuan8PickTrack;
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
    session: number;
    pointerId: number | null;
    startX: number;
    startY: number;
    lastDx: number;
    lastDy: number;
    absSnapshot: PtzAbsPressSnapshot | null;
  }>({
    active: false,
    session: 0,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastDx: 0,
    lastDy: 0,
    absSnapshot: null,
  });
  /** 绝对定位串行，避免连拖乱序 */
  const ptzDragQueueRef = useRef<Promise<void>>(Promise.resolve());
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

  const clientToVideoNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const root = stageRef.current;
      if (!root) return null;
      const stage = root.getBoundingClientRect();
      if (stage.width <= 0 || stage.height <= 0) return null;
      const intrinsic = resolveEoVideoIntrinsicSize(
        videoRef.current,
        overlayIntrinsic.w ?? 0,
        overlayIntrinsic.h ?? 0,
      );
      const content = getVideoContentRect(
        stage.width,
        stage.height,
        intrinsic.w,
        intrinsic.h,
        videoObjectFit,
      );
      if (content.w <= 0 || content.h <= 0) return null;
      const lx = clientX - stage.left - content.x;
      const ly = clientY - stage.top - content.y;
      return {
        x: Math.min(1, Math.max(0, lx / content.w)),
        y: Math.min(1, Math.max(0, ly / content.h)),
      };
    },
    [overlayIntrinsic.h, overlayIntrinsic.w, stageRef, videoObjectFit, videoRef],
  );

  const captureAbsPressSnapshot = useCallback(
    (clientX: number, clientY: number): PtzAbsPressSnapshot | null => {
      const press = clientToVideoNorm(clientX, clientY);
      if (!press) return null;
      const camIdx = cameraIndexFromOwnerEntityId(trimmedEntityId);
      if (camIdx == null) return null;
      const row = ddsLookupKey
        ? useEoCameraDdsStatusStore.getState().byEntityId[ddsLookupKey]
        : undefined;
      const panDeg = row?.ptzPanDeg;
      const tiltCalc = row?.ptzTiltDeg;
      const zoomRaw = row?.ptzZoom;
      const hsDeg = row?.fovHsDeg;
      const vsDeg = row?.fovVsDeg;
      if (
        panDeg == null ||
        tiltCalc == null ||
        zoomRaw == null ||
        !Number.isFinite(panDeg) ||
        !Number.isFinite(tiltCalc) ||
        !Number.isFinite(zoomRaw) ||
        !isPlausibleFovDeg(hsDeg ?? NaN) ||
        !isPlausibleFovDeg(vsDeg ?? NaN)
      ) {
        return null;
      }
      /** 实体/DDS 常见 m_calcZ∈[0,1]；少数路径已是绝对变倍（>1.5） */
      const maxZ = maxZoomForCameraIndex(camIdx);
      const zoomNorm = zoomRaw > 1.5 ? Math.min(1, zoomRaw / maxZ) : Math.min(1, Math.max(0, zoomRaw));
      return {
        panDeg,
        tiltCalc,
        zoomNorm,
        hsDeg: hsDeg as number,
        vsDeg: vsDeg as number,
        pressNormX: press.x,
        pressNormY: press.y,
        cameraIndex: camIdx,
      };
    },
    [clientToVideoNorm, ddsLookupKey, trimmedEntityId],
  );

  /** 松手：对齐 Qt，只发 PTZAbsolutePositionTask（press 内容 → release 点） */
  const stopDragPtz = useCallback(() => {
    const stopSession = dragStateRef.current.session;
    const snap = dragStateRef.current.absSnapshot;
    const releaseClientX = dragStateRef.current.startX + dragStateRef.current.lastDx;
    const releaseClientY = dragStateRef.current.startY + dragStateRef.current.lastDy;
    const dragPx = Math.hypot(dragStateRef.current.lastDx, dragStateRef.current.lastDy);

    return enqueuePtzDragOp(async () => {
      if (dragStateRef.current.session !== stopSession) return;
      dragStateRef.current.absSnapshot = null;

      if (!snap || dragPx < PTZ_ABS_DRAG_MIN_PX) return;

      const release = clientToVideoNorm(releaseClientX, releaseClientY);
      if (!release) {
        logClient("快拖绝对定位跳过：松手点无法映射到视频");
        return;
      }

      const resolved = resolvePtzAbsoluteFromDrag({
        pressNormX: snap.pressNormX,
        pressNormY: snap.pressNormY,
        releaseNormX: release.x,
        releaseNormY: release.y,
        panDeg: snap.panDeg,
        tiltCalc: snap.tiltCalc,
        hsDeg: snap.hsDeg,
        vsDeg: snap.vsDeg,
        cameraIndex: snap.cameraIndex,
      });
      if (!resolved) {
        logClient(
          `快拖绝对定位跳过：FOV/偏移无效 hs=${snap.hsDeg.toFixed(2)} vs=${snap.vsDeg.toFixed(2)}`,
        );
        return;
      }

      const maxZ = maxZoomForCameraIndex(snap.cameraIndex);
      const zoomAbs = snap.zoomNorm * maxZ;
      try {
        const res = await postEoPtzAbsolute({
          entityId: trimmedEntityId,
          backendBaseUrl: taskBackendBaseUrl,
          panDeg: resolved.panDeg,
          tiltDeg: resolved.tiltDeg,
          zoom: zoomAbs,
          speed: { pan: 0.5, tilt: 0.5, zoom: 0 },
        });
        const outcome = await readEoPtzTaskResponse(res);
        if (!outcome.executed) {
          logClient(
            `快拖绝对定位未执行 HTTP ${res.status}${outcome.detail ? `: ${outcome.detail.slice(0, 120)}` : ""}`,
          );
          return;
        }
        logClient(
          `快拖绝对 pan=${resolved.panDeg.toFixed(2)} tilt=${resolved.tiltDeg.toFixed(2)} Δp=${resolved.xOffsetDeg.toFixed(2)} Δt=${resolved.yOffsetDeg.toFixed(2)} fov=${snap.hsDeg.toFixed(1)}x${snap.vsDeg.toFixed(1)}`,
        );
      } catch (e) {
        logClient(`快拖绝对定位异常：${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }, [
    clientToVideoNorm,
    enqueuePtzDragOp,
    logClient,
    taskBackendBaseUrl,
    trimmedEntityId,
  ]);

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
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      dragStateRef.current.session += 1;
      const snap = captureAbsPressSnapshot(e.clientX, e.clientY);
      if (!snap) {
        logClient("快拖按下未就绪：等待 PTZ/FOV（ptz.pan/tilt/zoom + hs/vs）");
      }
      dragStateRef.current.active = true;
      dragStateRef.current.pointerId = e.pointerId;
      dragStateRef.current.startX = e.clientX;
      dragStateRef.current.startY = e.clientY;
      dragStateRef.current.lastDx = 0;
      dragStateRef.current.lastDy = 0;
      dragStateRef.current.absSnapshot = snap;
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
    };

    const onPointerEnd = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || st.pointerId !== e.pointerId) return;
      cancelPtzArrowFrame();
      ptzArrowPendingRef.current = null;
      setPtzDragArrow(null);
      st.lastDx = e.clientX - st.startX;
      st.lastDy = e.clientY - st.startY;
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
      st.absSnapshot = null;
    };
  }, [canSendSingleTrack, captureAbsPressSnapshot, logClient, stageRef, stopDragPtz]);

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
    async (payload: {
      normalizedX: number;
      normalizedY: number;
      hitBoxId: string | null;
      hitBox: EoDetectionBox | null;
      drawnBoxes?: EoDetectionBox[];
    }) => {
      logClient(
        `双击命中 norm=(${payload.normalizedX.toFixed(4)},${payload.normalizedY.toFixed(4)}) box=${payload.hitBoxId ?? "无"}`,
      );

      /** 优先用叠层当前帧框，避免父级 detectionBoxes setState 滞后把单目标态误判成发跟踪 */
      const boxesForDecision =
        payload.drawnBoxes && payload.drawnBoxes.length > 0 ? payload.drawnBoxes : detectionBoxes;

      if (enableYuan8PickTrack && trimmedEntityId) {
        if (taskBusy) {
          logClient("中止：上一 8院压点任务仍在发送中");
          return;
        }
        const pickX = Math.max(0, Math.min(255, Math.round(payload.normalizedX * 255)));
        const pickY = Math.max(0, Math.min(255, Math.round(payload.normalizedY * 255)));
        logClient(`准备 8院压点跟踪 pick=(${pickX},${pickY}) entity=${trimmedEntityId}`);
        setTaskBusy(true);
        setTaskHint("正在发送 8院压点跟踪…");
        try {
          const res = await postYuan8PickTrackTask({
            backendBaseUrl: taskBackendBaseUrl,
            entityId: trimmedEntityId,
            normalizedX: payload.normalizedX,
            normalizedY: payload.normalizedY,
          });
          const text = await res.text().catch(() => "");
          const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
          if (!outcome.accepted) {
            throw new Error(outcome.logLine || text.slice(0, 200) || `HTTP ${res.status}`);
          }
          setTaskHint("8院压点跟踪已发送");
          logClient(`HTTP 流程结束（Yuan8PickTrack）pick=(${pickX},${pickY})`);
        } catch (e) {
          setTaskHint(`发送失败：${e instanceof Error ? e.message : String(e)}`);
          logClient(`HTTP 失败（Yuan8PickTrack）：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setTaskBusy(false);
        }
        return;
      }

      if (canSendUavImgTrack) {
        if (taskBusy) {
          logClient("中止：上一无人机跟踪任务仍在发送中");
          return;
        }
        const nearMulti = pickMultiTargetBoxNearPoint(
          boxesForDecision,
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
          hit = boxesForDecision.find((b) => b.id === selectedBoxId) ?? null;
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
        ddsSingleTrackActive ||
        boxesForDecision.some((b) => b.variant === "singleTrack") ||
        payload.hitBox?.variant === "singleTrack" ||
        isEoSingleTrackUserLatchActive(trimmedEntityId);
      const nearMulti = pickMultiTargetBoxNearPoint(
        boxesForDecision,
        payload.normalizedX,
        payload.normalizedY,
      );
      const explicitMultiHit =
        payload.hitBox != null && payload.hitBox.variant !== "singleTrack";
      /**
       * 非烧录：nearMulti 补全漏检，避免跟踪态误点成取消。
       * 烧录：码流已是单目标时，框层/父态偶发仍带多目标，nearMulti 会把「应取消」
       * 误判成「发跟踪」；取消门禁只认显式命中多目标框（不改非烧录画框逻辑）。
       */
      const hitIsMultiTargetBox = isBurnInPlayback
        ? explicitMultiHit
        : explicitMultiHit || nearMulti != null;
      const shouldCancelSingleTrack = inSingleTrackUi && !hitIsMultiTargetBox;

      if (shouldCancelSingleTrack) {
        logClient(
          `已在单目标跟踪：双击${payload.hitBox ? `框 ${payload.hitBox.id}` : "空白"} -> 发送取消跟踪（trackAction=0）${isBurnInPlayback ? " [burn-in]" : ""}`,
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
        hit = boxesForDecision.find((b) => b.id === selectedBoxId) ?? null;
      }
      if (!hit) {
        const near = pickDetectionBoxClosestToVideoCenter(
          boxesForDecision.filter((b) => b.variant !== "singleTrack"),
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
    [canSendSingleTrack, canSendUavImgTrack, ddsSingleTrackActive, detectionBoxes, enableYuan8PickTrack, isBurnInPlayback, logClient, onSingleTrackTask, onUavImgTrackingTask, onUavStopTrackingTask, overlayIntrinsic.h, overlayIntrinsic.w, rectTypeFromDetectionBox, selectedBoxId, taskBackendBaseUrl, taskBusy, trimmedEntityId, uavAirportSn, uavTrackingActive, videoRef],
  );

  const onBottomCenterToastRef = useRef(onBottomCenterToast);
  onBottomCenterToastRef.current = onBottomCenterToast;
  const lastBottomToastKeyRef = useRef("");

  useEffect(() => {
    const toast = onBottomCenterToastRef.current;
    if (!toast) return;
    const text = taskBusy ? taskHint.trim() || "任务处理中…" : taskHint.trim();
    if (!text) {
      lastBottomToastKeyRef.current = "";
      return;
    }
    const tone: "success" | "error" | "warn" = /失败|错误|取消失败|HTTP/i.test(text)
      ? "error"
      : /正在|处理中|…|\.\.\./.test(text)
        ? "warn"
        : "success";
    const key = `${tone}\0${text}`;
    if (key === lastBottomToastKeyRef.current) return;
    lastBottomToastKeyRef.current = key;
    toast({ text, tone });
  }, [taskHint, taskBusy]);

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative h-full min-h-0 flex-1 overflow-hidden bg-black",
        uavAimInteractionsEnabled && "touch-manipulation",
        className,
      )}
    >
      <EoVideoViewport
        signalingUrl={signalingUrl}
        iceServers={iceServers}
        enabled
        videoRef={videoRef}
        peerConnectionRef={exposePeerForDetection ? peerConnectionRef : undefined}
        encodedSyncHub={
          showDetection && !sharedMediaStream && !sharedPlaybackOnly ? encodedSyncHub : undefined
        }
        videoReceiverRef={
          showDetection && !sharedMediaStream && !sharedPlaybackOnly ? videoReceiverRef : undefined
        }
        streamLabel={streamLabel}
        webCodecsPresentationRef={webCodecsPresentationRef}
        videoObjectFit={videoObjectFit}
        webRtcKickEpoch={sharedMediaStream || sharedPlaybackOnly ? 0 : webRtcKickEpoch}
        stallWatchIntervalMs={sharedMediaStream || sharedPlaybackOnly ? undefined : stallWatchIntervalMs}
        onStallRecover={sharedMediaStream || sharedPlaybackOnly ? undefined : onStallRecover}
        sharedMediaStream={sharedMediaStream}
        sharedPlaybackOnly={sharedPlaybackOnly}
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
          hideDrawnBoxes={isBurnInPlayback || suppressDrawnBoxes}
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
      {uavTrackProjectVisible && uavTrackProjectAfterTakeoff ? (
        <EoUavTrackProjectOverlay
          enabled
          afterTakeoff
          droneSn={uavTrackProjectDroneSn}
          mqttTelemetry={uavTrackProjectMqttTelemetry}
          containerRef={stageRef as React.RefObject<HTMLElement | null>}
          videoRef={videoRef}
          videoObjectFit={videoObjectFit}
          videoIntrinsicWidth={overlayIntrinsic.w}
          videoIntrinsicHeight={overlayIntrinsic.h}
        />
      ) : null}
      {taskBusy ? <div className="pointer-events-none absolute inset-0 z-20" /> : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearCaptureDirHandle,
  isShowDirectoryPickerSupported,
  loadCaptureDirHandle,
  pickCaptureDirectoryHandle,
  saveCaptureDirHandle,
} from "@/lib/eo-video/eoCaptureDirectoryStore";
import {
  buildEoCaptureFilename,
  captureEoPlaybackToPngBlob,
  createEoCanvasRecorder,
  createEoVideoRecorder,
  pickRecordMimeAndExtension,
  saveCaptureBlob,
  saveCaptureBlobToServerLocal,
  type EoVideoRecordController,
} from "@/lib/eo-video/eoVideoCapture";
import { useUavMqttDockState } from "@/hooks/useUavMqttDockState";
import { useUavKeyboardControl } from "@/hooks/useUavKeyboardControl";
import { postUavAuth, type DroneCtrlInfo } from "@/lib/eo-video/uavAuthClient";
import { loadEoVideoConfig } from "@/lib/eo-video/loadEoVideoConfig";
import { loadZOthersWebRtcSources } from "@/lib/eo-video/loadZOthersWebRtcSources";
import {
  fetchCameraRegistryFromPublic,
  fetchDroneDevicesFromPublic,
  fetchThirdPartyCamerasFromApi,
  mergeRegistryStreams,
  stripRegistryStreams,
} from "@/lib/eo-video/mergeEoVideoRegistry";
import { canonicalEntityId, parseCameraEntityIdFromStreamId } from "@/lib/camera-entity-id";
import {
  fetchCameraEntityPlayback,
  fetchEntityPlaybackAny,
  prefetchEntityPlaybackUrls,
} from "@/lib/eo-video/resolveCameraEntityPlayback";
import { buildUavZlmSignalingUrl, buildUavZlmStreamKey, getUavZlmWebrtcBaseUrl } from "@/lib/eo-video/buildUavZlmWebrtcUrl";
import { fetchUavPlatformSignalingUrl } from "@/lib/eo-video/resolveUavLiveByPlatform";
import { fetchResolvedUavPlaybackIds } from "@/lib/eo-video/resolveUavPlaybackByEntity";
import {
  postEoBurnInSelect,
  resolveEoBurnInRectId,
} from "@/lib/eo-video/eoBurnInSelectClient";
import { clearAllBurnInPlacards } from "@/lib/eo-video/eoBurnInPlacardClient";
import {
  fetchEoBurnInOverlay,
  postEoBurnInOverlay,
} from "@/lib/eo-video/eoBurnInOverlayClient";
import {
  selectBurnInHideOverlay,
  useEoBurnInOverlayStore,
} from "@/stores/eo-burn-in-overlay-store";
import type {
  EoDetectionBox,
  EoVideoIceServer,
  EoVideoStreamEntry,
  EoVideoStreamsConfig,
} from "@/lib/eo-video/types";
import { postUavControlAction, isUavControlEffectivelyOk, type UavControlAction } from "@/lib/eo-video/uavControlClient";
import {
  registerLangGraphUavCommandHandler,
  unregisterLangGraphUavCommandHandler,
} from "@/lib/langgraph-eo-uav-command-bridge";
import { useUavQuickContextStore } from "@/stores/uav-quick-context-store";
import { pokeUavLiveStreamsForView } from "@/lib/eo-video/pokeDroneLiveStream";
import { forceReconnectThirdPartyCameraWsHub } from "@/lib/eo-video/thirdPartyCameraWsHub";
import { WEBRTC_UAV_STALL_WATCH_INTERVAL_MS } from "@/hooks/useWebRtcPlayer";
import {
  reattachVideoFromPeer,
} from "@/lib/eo-video/eoSharedPlaybackStream";
import { postUavGimbalReset, uavMainPayloadIndexForDrone } from "@/lib/eo-video/postUavGimbalReset";
import { postUavImgTrackingTask } from "@/lib/eo-video/uavImgTrackingClient";
import { postUavTaskStop } from "@/lib/eo-video/uavTaskStopClient";
import { startUavDrcHeartBeat, stopUavDrcHeartBeat } from "@/lib/eo-video/uavDrcSessionClient";
import { postUavSwitchVideoCamera, type UavVideoLensType } from "@/lib/eo-video/postUavSwitchVideoCamera";
import { resolveEoPipPlaybackUrl } from "@/lib/eo-video/resolveEoPipPlaybackUrl";
import { useEoVideoDdsTaskLine } from "@/hooks/useEoVideoDdsTaskLine";
import { useEoVideoSmartWindow } from "@/hooks/useEoVideoSmartWindow";
import { blobToBase64DataOnly } from "@/lib/eo-video/blobToBase64";
import { Button } from "@/components/ui/button";
import { Home, Joystick, Loader2, Maximize2, Minimize2, PlaneTakeoff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useVlmChatInjectStore } from "@/stores/vlm-chat-inject-store";
import { toast } from "sonner";
import { EoUavConsoleDock } from "./EoUavConsoleDock";
import { EoUavLensSwitchBar } from "./EoUavLensSwitchBar";
import { EoPipFloatingPlayer } from "./EoPipFloatingPlayer";
import { EoStreamContextMenu } from "./EoStreamContextMenu";
import { EoVideoBottomFloater } from "./EoVideoBottomFloater";
import { EoVideoFloatingTools } from "./EoVideoFloatingTools";
import { useEoThirdPartyCameraWebSocket } from "@/hooks/useEoThirdPartyCameraWebSocket";
import { EoHighSpeedYuvStack, type EoHighSpeedBox, type EoHighSpeedYuvStackHandle } from "./EoHighSpeedYuvStack";
import { EoThirdPartyDirectMovePad } from "./EoThirdPartyDirectMovePad";
import { EoYuan8PtzPanel } from "./EoYuan8PtzPanel";
import { EoThirdPartySubCamPipStack } from "./EoThirdPartySubCamPip";
import { postThirdPartyCamTask, type ThirdPartyCamTaskKind } from "@/lib/eo-video/thirdPartyCamTaskClient";
import { evaluateThirdPartyTaskHttpResponse } from "@/lib/thirdPartyTaskServiceResponse";
import { EoVideoPlayStage } from "./EoVideoPlayStage";
import { EoExpandedCameraPtzHud } from "./EoExpandedCameraPtzHud";
import { EoVideoPtzPanel } from "./EoVideoPtzPanel";
import type { EoVideoTaskTrace } from "./EoVideoTaskTracePanel";
import { EoVideoTaskTracePanel } from "./EoVideoTaskTracePanel";
import { EoCaptureCollectDialog } from "./EoCaptureCollectDialog";
import { EoCalcRecordDialog } from "./EoCalcRecordDialog";
import { EoCalcRecordLocationDialog } from "./EoCalcRecordLocationDialog";
import { EoPidSettingsDialog } from "./EoPidSettingsDialog";
import { EoSnapshotPreviewPopout, type EoSnapshotPreviewPayload } from "./EoSnapshotPreviewPopout";
import { eoCollectDataTypeForPreviewKind } from "@/lib/eo-video/eoCaptureCollectUpload";
import { useEoCalcRecordController } from "@/hooks/useEoCalcRecordController";
import { useEoAimTrackCollect } from "@/hooks/useEoAimTrackCollect";
import { postEoAimUpdate } from "@/lib/eo-video/eoAimUpdateClient";
import { isEoBurnInPlaybackUrl } from "@/lib/eo-video/eoBurnInPlayback";
import { getEoVideoExpandDockBaseTitle } from "@/lib/eo-video/eoVideoExpandDockTitle";
import { EoVideoExpandFloatingFrame } from "./EoVideoExpandFloatingFrame";
import {
  ensureEntitiesTrackTaskCache,
  getEntitiesTrackTaskCacheRow,
  isTrackTaskOwnerRowAllowed,
} from "@/lib/entities-track-task-cache";
import { useEoFocusedUavAirportSnStore } from "@/stores/eo-focused-uav-airport-sn-store";
import { useEoThirdPartyUdpDevStatusStore } from "@/stores/eo-third-party-udp-dev-status-store";
import { isThirdPartyUdpStreamEntry, isThirdPartyWebrtcStreamEntry, isYuan8StreamEntry } from "@/lib/eo-video/thirdPartyCamCtrlType";
import { getThirdPartyCameraMulticastUdp } from "@/lib/eo-video/thirdPartyCameraMulticast";
import {
  isThirdPartyCameraEntityId,
  normThirdPartyEntityId,
} from "@/lib/eo-video/thirdPartyEntityId";
import { useEoVideoPanelFocusStore } from "@/stores/eo-video-panel-focus-store";
import { useEoVideoSmartWindowStore } from "@/stores/eo-video-smart-window-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import { getDefaultEoCameraTaskBackendBaseUrl } from "@/lib/map-app-config";
import { isEoVideoDebugUiEnabled } from "@/lib/eo-video/eoVideoDebugUi";
import {
  EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX,
  EO_PIP_STREAM_STORAGE_PREFIX,
  getEoVideoStreamSyncKey,
} from "@/lib/eo-video/eoStreamSelectionKeys";
import { useEoVideoStreamSelectionSyncStore } from "@/stores/eo-video-stream-selection-sync-store";

export interface EoVideoPanelProps {
  configUrl?: string;
  /** 与 base-vue 一致：实体 id 优先，走 `/api/entity-v1/{id}` + 检测 WS */
  entityId?: string;
  /** 每个 dock 窗口实例独立记忆流选择 */
  streamPersistKey?: string;
  /** 放大窗口打开时可复用当前流 */
  initialStreamId?: string;
  /** 当前是否处于放大形态 */
  expandedMode?: boolean;
  /** 放大/恢复切换 */
  onToggleExpand?: () => void;
  className?: string;
  /** 底部拖拽条调节整体高度（约 200–920px） */
  resizable?: boolean;
  /** 与本窗口在 Dock 注册表里的 id（如 electro-optical-1）一致，用于「当前选中光电窗口」与高亮边框 */
  dockPanelId?: string;
  /** 经典布局等场景：禁止放大/独立浮动窗 */
  disableExpand?: boolean;
  /** 经典布局主窗：固定放大态 UI，键盘手控不依赖「选中光电窗」，控制台常显 */
  classicFixedExpanded?: boolean;
  /** 经典布局小窗：右侧工具仅录屏/截图 */
  classicToolsCaptureOnly?: boolean;
  /** 经典布局小窗右键：设为主屏（与左侧大屏互换） */
  onClassicSetAsMain?: () => void;
  /**
   * 放大窗复用小窗已建立的 MediaStream（同一路 WebRTC 轨），不再二次信令/poke。
   * 仅影响画面；右侧工具栏仍走本面板自身的 expandedMode UI。
   */
  sharedMediaStream?: MediaStream | null;
  /**
   * 放大窗首屏：直接带上小窗当前流条目，避免先落到 dock 默认 camera_004 再闪检测框。
   */
  sharedPlayback?: {
    stream: EoVideoStreamEntry;
    iceServers: EoVideoIceServer[];
  } | null;
}

function buildSharedPlaybackCfg(sp: {
  stream: EoVideoStreamEntry;
  iceServers: EoVideoIceServer[];
}): EoVideoStreamsConfig {
  const id = sp.stream.id;
  return {
    defaultStreamId: id,
    iceServers: sp.iceServers,
    streams: [sp.stream],
    contextMenu: {
      title: "视频源",
      menuLayout: "nested",
      groups: [{ label: "光电", streamIds: [id] }],
    },
  };
}

function isCameraEntityId(id: string): boolean {
  return /^camera_[0-9]{3}$/i.test(id);
}

/** 按 id 精确匹配；第三方再按 `camera-hs-001`/`camera_hs_001` 规范化兜底。
 * 同 id 多条时优先带 `registrySource` 的正式条目（避免刷新 seed 抢先导致不走 UDP）。
 */
function findStreamById(
  streams: EoVideoStreamEntry[] | undefined,
  streamId: string,
): EoVideoStreamEntry | undefined {
  const sid = streamId.trim();
  if (!sid || !streams?.length) return undefined;

  const pickBest = (cands: EoVideoStreamEntry[]): EoVideoStreamEntry | undefined => {
    if (!cands.length) return undefined;
    if (cands.length === 1) return cands[0];
    return (
      cands.find((s) => s.registrySource === "thirdPartyCamera") ??
      cands.find((s) => s.registrySource === "camera") ??
      cands.find((s) => s.registrySource === "uav") ??
      cands.find((s) => Boolean(s.registrySource)) ??
      cands[0]
    );
  };

  const exact = streams.filter((s) => s.id === sid);
  const exactBest = pickBest(exact);
  if (exactBest) return exactBest;
  if (!isThirdPartyCameraEntityId(sid)) return undefined;
  const want = normThirdPartyEntityId(sid);
  return pickBest(streams.filter((s) => normThirdPartyEntityId(s.id) === want));
}

/** 第三方 UDP 记忆/首屏占位：必须带 registrySource，否则会走 WebRTC 黑屏 */
function buildThirdPartyUdpSeedEntry(id: string, label?: string): EoVideoStreamEntry {
  const mcast = getThirdPartyCameraMulticastUdp();
  return {
    id,
    label: (label ?? id).trim() || id,
    signalingUrl: "",
    registrySource: "thirdPartyCamera",
    ...(mcast ? { multicastUdp: mcast } : {}),
  };
}

function uniqueCandidates(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function resolvePlaybackByCandidates(candidates: string[]): Promise<{ signalingUrl: string; picked: string }> {
  if (candidates.length === 0) {
    throw new Error("实体播放解析失败：候选实体为空");
  }
  let lastErr: unknown = null;
  for (const id of candidates) {
    try {
      const p = await fetchEntityPlaybackAny(id);
      return { signalingUrl: p.signalingUrl, picked: id };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `实体播放解析失败（已尝试: ${candidates.join(", ")}）${
      lastErr ? `: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : ""
    }`,
  );
}

const TASK_BACKEND_BASE_KEY = "nexus.eo.cameraTaskBackendBaseUrl";
const SNAPSHOT_PATH_KEY = "nexus.eo.snapshotSavePath";
const RECORD_PATH_KEY = "nexus.eo.recordSavePath";
const AIRPORT_FPV_PAYLOAD = "165-0-7";
const DRONE_MAIN_PAYLOAD = "81-0-0";
const DRONE_MAIN_PAYLOAD_SPECIAL = "80-0-0";
/** 私有云 start 推流后，稍候再重连 ZLM WebRTC（毫秒）；仅确认仍黑时才 kick */
const UAV_WEBRTC_KICK_AFTER_START_MS = 600;
/** 仍黑时周期性重试 start+kick */
const UAV_LIVE_STREAM_RETRY_MS = 4000;
const UAV_LIVE_STREAM_MAX_RETRIES = 8;
/** 首次出画宽限：过短易误踢，过长则空流黑屏拖太久 */
const UAV_LIVE_STREAM_PICTURE_GRACE_MS = 1800;
/** 切流后最多等 MQTT 舱状态多久再选定机场/机体信令（避免先连错路再闪切） */
const UAV_MQTT_DOCK_WAIT_MS = 3000;
/** MQTT 断线至少持续该时长再重连，才触发自动拉流（过滤瞬时抖动） */
const UAV_MQTT_DOWN_RECOVER_MIN_MS = 3000;
/** kick / 硬重拉后主窗看门狗宽限 */
const UAV_PLAYBACK_KICK_GRACE_MS = 12_000;

/** 舱内→机场 FPV；舱外→机体主摄；MQTT 未知时优先机体 */
function pickUavPlaySignalingUrl(
  urls: { dock: string; air: string },
  mqttDroneInDock: boolean | null,
): string {
  if (mqttDroneInDock === false) return urls.air || urls.dock;
  if (mqttDroneInDock === true) return urls.dock || urls.air;
  return urls.air || urls.dock;
}

const EO_VIDEO_DEBUG_UI = isEoVideoDebugUiEnabled();

function uavActionFeedbackLabel(action: UavControlAction): string {
  switch (action) {
    case "takeoff":
      return "起飞";
    case "stop":
      return "中止";
    case "back":
      return "返航";
    case "hotback":
      return "热备";
    case "hotback_close":
      return "取消热备";
    case "reconnect":
      return "重连";
    case "emergency":
      return "急停";
    default:
      return action;
  }
}

export function EoVideoPanel({
  configUrl = "/config/eo-video.streams.json",
  entityId,
  streamPersistKey,
  initialStreamId,
  expandedMode = false,
  onToggleExpand,
  className,
  resizable = true,
  dockPanelId,
  disableExpand = false,
  classicFixedExpanded = false,
  classicToolsCaptureOnly = false,
  onClassicSetAsMain,
  sharedMediaStream = null,
  sharedPlayback = null,
}: EoVideoPanelProps) {
  const effectiveExpandedMode = expandedMode || classicFixedExpanded;
  /** 有 sharedPlayback 即走「只复用小窗流」，禁止再开第二路 WebRTC */
  const preferSharedPlayback = Boolean(sharedPlayback?.stream?.id);
  const reuseSharedStream = Boolean(sharedMediaStream) || preferSharedPlayback;
  const [cfg, setCfg] = useState<EoVideoStreamsConfig | null>(() =>
    sharedPlayback?.stream?.id ? buildSharedPlaybackCfg(sharedPlayback) : null,
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [activeStreamId, setActiveStreamId] = useState(() =>
    (sharedPlayback?.stream?.id || initialStreamId || "").trim(),
  );
  const [detectionDiag, setDetectionDiag] = useState("");
  const [detectionDiagHover, setDetectionDiagHover] = useState("");
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [taskBackendBaseUrl, setTaskBackendBaseUrl] = useState(() => getDefaultEoCameraTaskBackendBaseUrl());
  const [snapshotSavePath, setSnapshotSavePath] = useState("");
  const [recordSavePath, setRecordSavePath] = useState("");
  const [captureReady, setCaptureReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [taskTrace, setTaskTrace] = useState<EoVideoTaskTrace | null>(null);
  const [clientEcho, setClientEcho] = useState("");
  const [detectionBoxes, setDetectionBoxes] = useState<EoDetectionBox[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const resizePointerIdRef = useRef<number | null>(null);
  const resizeStartRef = useRef({ y: 0, h: 0 });
  const [panelHeightPx, setPanelHeightPx] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const recorderCtlRef = useRef<EoVideoRecordController | null>(null);
  const captureDirHandleSnapshotRef = useRef<FileSystemDirectoryHandle | null>(null);
  const captureDirHandleRecordRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [captureFolderLabel, setCaptureFolderLabel] = useState("");
  const [ptzPanelOpen, setPtzPanelOpen] = useState(effectiveExpandedMode);
  /** 无人机：右侧手柄与相机 PTZ 同类，收起时隐藏罗盘/机场与机体状态/QWEASD 与动作面板 */
  const [uavDockExpanded, setUavDockExpanded] = useState(effectiveExpandedMode);
  /** 无人机：关闭检测 WS / WebCodecs 对齐，仅裸播 WebRTC（排查卡顿） */
  const [uavVideoOnly, setUavVideoOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem("eo-video-uav-video-only") === "1";
    } catch {
      return false;
    }
  });
  /** 无人机：航线/对海融合航迹画面投影（默认开启） */
  const [uavTrackProjectVisible, setUavTrackProjectVisible] = useState(true);

  useEffect(() => {
    try {
      window.sessionStorage.setItem("eo-video-uav-video-only", uavVideoOnly ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [uavVideoOnly]);
  const [zoomWindowOpen, setZoomWindowOpen] = useState(false);
  /** 放大窗复用小窗画面（优先 captureStream），避免第二路 WebRTC 抢轨 */
  /** 小窗黑屏时强制重建 WebRTC（相机路径） */
  const [dockPlaybackKick, setDockPlaybackKick] = useState(0);
  const [reconnectStreamBusy, setReconnectStreamBusy] = useState(false);
  const reconnectStreamBusyRef = useRef(false);
  /** 手动/自动 kick 后宽限，避免出画前被主窗看门狗连环踢成黑屏 */
  const playbackKickGraceUntilRef = useRef(0);

  useEffect(() => {
    if (dockPlaybackKick <= 0) return;
    playbackKickGraceUntilRef.current = Date.now() + UAV_PLAYBACK_KICK_GRACE_MS;
  }, [dockPlaybackKick]);


  /** 全局调试 UI 关闭时：放大 + 相机在右侧点「调试」后于底部展开任务跟踪面板 */
  const [cameraExpandedDebugOpen, setCameraExpandedDebugOpen] = useState(false);
  const [uavExpandedDebugOpen, setUavExpandedDebugOpen] = useState(false);

  const eoFocusedDockId = useEoVideoPanelFocusStore((s) => s.focusedDockPanelId);
  const setEoFocusedDockPanel = useEoVideoPanelFocusStore((s) => s.setFocusedDockPanel);
  const dockPidNorm = dockPanelId?.trim() ?? "";
  const eoPanelSelected = dockPidNorm.length > 0 && eoFocusedDockId === dockPidNorm;

  useEffect(() => {
    if (!effectiveExpandedMode) {
      setPtzPanelOpen(false);
      setUavDockExpanded(false);
      setCameraExpandedDebugOpen(false);
    } else {
      // 放大后显示无人机罗盘/控制台（小窗仅视频，与右侧工具栏一致）
      setUavDockExpanded(true);
    }
  }, [effectiveExpandedMode]);

  useEffect(() => {
    if (!classicFixedExpanded || !dockPidNorm) return;
    setEoFocusedDockPanel(dockPidNorm);
  }, [classicFixedExpanded, dockPidNorm, setEoFocusedDockPanel]);
  /** 应用内右上画中画（独立 WebRTC；与浏览器原生 video 悬浮条无关） */
  const [pipOpen, setPipOpen] = useState(false);
  const [pipStreamId, setPipStreamId] = useState("");
  const [pipSignalingUrl, setPipSignalingUrl] = useState("");
  const [pipResolving, setPipResolving] = useState(false);
  const [pipErr, setPipErr] = useState<string | null>(null);
  const [thirdPartySubPipsVisible, setThirdPartySubPipsVisible] = useState(true);
  const [uavTrackTaskId, setUavTrackTaskId] = useState<string | null>(null);
  const [uavActiveLens, setUavActiveLens] = useState<UavVideoLensType>("wide");
  const [uavActionBusy, setUavActionBusy] = useState<Partial<Record<UavControlAction, boolean>>>({});
  /** 无人机底部中间反馈（对齐 C++ 的即时提示语义） */
  const [uavBottomFeedback, setUavBottomFeedback] = useState<{
    text: string;
    tone: "success" | "error" | "warn";
  } | null>(null);
  const uavBottomFeedbackTimerRef = useRef<number | null>(null);
  /** 光电：底部中间任务提示（目标跟踪发送/取消等） */
  const [cameraBottomFeedback, setCameraBottomFeedback] = useState<{
    text: string;
    tone: "success" | "error" | "warn";
  } | null>(null);
  const cameraBottomFeedbackTimerRef = useRef<number | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<EoSnapshotPreviewPayload | null>(null);
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  const [collectTarget, setCollectTarget] = useState<{
    kind: "snapshot" | "record";
    blob: Blob;
    fileName: string;
  } | null>(null);
  const snapshotPreviewRef = useRef<EoSnapshotPreviewPayload | null>(null);
  const snapshotAutoDismissTimerRef = useRef<number | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [uavPlaySignalingUrl, setUavPlaySignalingUrl] = useState<string | null>(null);
  const [uavWebRtcKick, setUavWebRtcKick] = useState(0);
  const uavWebRtcKickTimerRef = useRef<number | null>(null);
  /** 主窗看门狗 / MQTT 恢复等早于 callback 定义处引用 */
  const handleUavStallRecoverRef = useRef<() => void>(() => {});
  const appendClientLogRef = useRef<(line: string) => void>(() => {});
  const [uavPlayLoading, setUavPlayLoading] = useState(false);
  const [uavPlayErr, setUavPlayErr] = useState<string | null>(null);
  const [uavResolveDebug, setUavResolveDebug] = useState<string>("");
  const uavDebugLoggedRef = useRef("");
  const uavPlayLoggedRef = useRef("");
  const uavUrlsRef = useRef<{ dock: string; air: string } | null>(null);
  const mqttDroneInDockRef = useRef<boolean | null>(null);
  const [uavUrlsEpoch, setUavUrlsEpoch] = useState(0);
  /** 本路无人机是否已完成「先 poke 再提交信令」；用于避免 MQTT 晚到时二次换源闪黑 */
  const uavPlayUrlCommittedRef = useRef(false);
  const uavPlayUrlDockRef = useRef<boolean | null>(null);
  /** 供提交/拉流 effect 读最新 SN（避免把 SN 放进 deps 导致等待定时器被反复重置） */
  const uavLiveSnRef = useRef({ airportSn: "", droneSn: "" });
  /** 实体解析得到的机场/机体 SN，用于 MQTT topic（与取流 ZLM SN 一致，避免注册表 SN 错误导致收不到舱状态） */
  const [uavMqttProductIds, setUavMqttProductIds] = useState<{ airport: string; device: string } | null>(null);
  /** 无人机控制授权状态 */
  const [uavCtrlAuth, setUavCtrlAuth] = useState<{
    hasAuth: boolean;
    ctrlInfo: DroneCtrlInfo | null;
    busy: boolean;
  }>({ hasAuth: false, ctrlInfo: null, busy: false });
  /** 未配置 NEXT_PUBLIC_MQTT_WS_URL 时，从私有云登录接口拉取 mqtt_addr 并推导 ws（与 WatchSys 一致） */
  const [platformMqtt, setPlatformMqtt] = useState<{
    status: "idle" | "loading" | "ok" | "err";
    wsUrl: string;
    wsSource?: string;
    mqttUsername?: string;
    mqttPassword?: string;
    error?: string;
  }>(() => ({
    status:
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_MQTT_WS_URL?.trim() ? "idle" : "loading",
    wsUrl: "",
  }));
  const [cameraResolvedUrl, setCameraResolvedUrl] = useState<string | null>(null);
  const [cameraResolveLoading, setCameraResolveLoading] = useState(false);
  const [cameraResolveErr, setCameraResolveErr] = useState<string | null>(null);

  const entity = entityId?.trim();
  const streamSyncKey = useMemo(
    () => getEoVideoStreamSyncKey(streamPersistKey, entityId),
    [streamPersistKey, entityId],
  );
  const activeStreamStorageKey = useMemo(
    () => `${EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX}${streamSyncKey}`,
    [streamSyncKey],
  );

  /** 未校验是否已在 cfg.streams 中；用于首屏 seed，避免注册表未到时丢记忆 */
  const getRawSavedActiveStreamId = useCallback((): string | null => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem(activeStreamStorageKey)?.trim();
      if (saved) return saved;
      const legacyKey = (streamPersistKey ?? "").trim();
      if (legacyKey.endsWith("::zoom")) {
        const legacy = window.localStorage
          .getItem(`${EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX}${legacyKey}`)
          ?.trim();
        if (legacy) return legacy;
      }
    } catch {
      /* noop */
    }
    return null;
  }, [activeStreamStorageKey, streamPersistKey]);

  const getSavedActiveStreamId = useCallback(
    (nextCfg: EoVideoStreamsConfig): string | null => {
      const saved = getRawSavedActiveStreamId();
      if (!saved) return null;
      if (nextCfg.streams.some((s) => s.id === saved)) return saved;
      const canon = parseCameraEntityIdFromStreamId(saved) || saved;
      if (canon !== saved && nextCfg.streams.some((s) => s.id === canon)) return canon;
      return null;
    },
    [getRawSavedActiveStreamId],
  );

  /** 首屏 applyActive 完成前禁止把 dock 默认 entity 写回 localStorage（会冲掉记忆） */
  const mainStreamPersistReadyRef = useRef(false);
  /**
   * 用户（或智能窗）主动切流后置 true。
   * 放大窗启动时可能短暂回落到 dock 默认 entity（常为 camera_004），
   * 此时不得写 SyncStore；但用户主动选 camera_004 必须同步回小窗。
   */
  const userPickedStreamRef = useRef(false);

  const syncedMainFromPeer = useEoVideoStreamSelectionSyncStore((s) => s.mainBySyncKey[streamSyncKey] ?? "");
  const syncedPipFromPeer = useEoVideoStreamSelectionSyncStore((s) => s.pipBySyncKey[streamSyncKey] ?? "");

  useEffect(() => {
    if (!cfg || !streamSyncKey) return;
    const id = syncedMainFromPeer.trim();
    if (!id) return;
    if (!cfg.streams.some((s) => s.id === id)) return;
    setActiveStreamId((cur) => (cur === id ? cur : id));
  }, [cfg, streamSyncKey, syncedMainFromPeer]);

  useEffect(() => {
    if (!cfg || !streamSyncKey) return;
    const id = syncedPipFromPeer.trim();
    if (!id) return;
    if (!cfg.streams.some((s) => s.id === id)) return;
    setPipStreamId((cur) => (cur === id ? cur : id));
  }, [cfg, streamSyncKey, syncedPipFromPeer]);

  const pipStorageHydratedRef = useRef(false);
  useEffect(() => {
    if (!cfg || !streamSyncKey || typeof window === "undefined") return;
    if (pipStorageHydratedRef.current) return;
    pipStorageHydratedRef.current = true;
    const p = window.localStorage.getItem(EO_PIP_STREAM_STORAGE_PREFIX + streamSyncKey)?.trim();
    if (p && cfg.streams.some((s) => s.id === p)) {
      setPipStreamId(p);
      useEoVideoStreamSelectionSyncStore.getState().setPipFromPanel(streamSyncKey, p);
    }
  }, [cfg, streamSyncKey]);

  useEffect(() => {
    void useAppConfigStore.getState().ensureLoaded();
  }, []);

  /** 切换视频流后收起云台区（光电默认不显） */
  useEffect(() => {
    setPtzPanelOpen(false);
  }, [activeStreamId]);

  useEffect(() => {
    snapshotPreviewRef.current = snapshotPreview;
  }, [snapshotPreview]);

  useEffect(() => {
    if (snapshotAutoDismissTimerRef.current != null) {
      window.clearTimeout(snapshotAutoDismissTimerRef.current);
      snapshotAutoDismissTimerRef.current = null;
    }
    if (!snapshotPreview || collectDialogOpen) return;
    snapshotAutoDismissTimerRef.current = window.setTimeout(() => {
      setSnapshotPreview((prev) => {
        if (!prev) return prev;
        if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return null;
      });
      snapshotAutoDismissTimerRef.current = null;
    }, 5000);
    return () => {
      if (snapshotAutoDismissTimerRef.current != null) {
        window.clearTimeout(snapshotAutoDismissTimerRef.current);
        snapshotAutoDismissTimerRef.current = null;
      }
    };
  }, [snapshotPreview, collectDialogOpen]);

  useEffect(() => {
    return () => {
      if (snapshotAutoDismissTimerRef.current != null) {
        window.clearTimeout(snapshotAutoDismissTimerRef.current);
        snapshotAutoDismissTimerRef.current = null;
      }
      const u = snapshotPreviewRef.current?.objectUrl;
      if (u) URL.revokeObjectURL(u);
    };
  }, []);

  /**
   * cfg 更新后预加载所有相机流的信令 URL（写入内存缓存）。
   * 用户切流时直接命中缓存，无需等待 HTTP，近似瞬间出画。
   */
  useEffect(() => {
    if (!cfg) return;
    const cameraIds = cfg.streams
      .filter(
        (s) =>
          (s.registrySource === "camera" || (!s.registrySource && !s.uav)) &&
          (!s.signalingUrl || s.signalingUrl === "about:blank"),
      )
      .map((s) => s.id)
      .filter(Boolean);
    if (cameraIds.length > 0) {
      prefetchEntityPlaybackUrls(cameraIds);
    }
  }, [cfg]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(TASK_BACKEND_BASE_KEY);
    if (saved && saved.trim()) setTaskBackendBaseUrl(saved.trim());
    const sp = window.localStorage.getItem(SNAPSHOT_PATH_KEY);
    const rp = window.localStorage.getItem(RECORD_PATH_KEY);
    if (sp != null) setSnapshotSavePath(sp);
    if (rp != null) setRecordSavePath(rp);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hs, hr] = await Promise.all([loadCaptureDirHandle("snapshot"), loadCaptureDirHandle("record")]);
      if (cancelled) return;
      if (hs) captureDirHandleSnapshotRef.current = hs;
      if (hr) captureDirHandleRecordRef.current = hr;
      setCaptureFolderLabel((hs ?? hr)?.name ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!entity) {
      setDetectionDiag("");
      setDetectionDiagHover("");
    }
  }, [entity]);

  const handleDetectionDiagnostic = useCallback((line: string, hover?: string) => {
    setDetectionDiag(line);
    setDetectionDiagHover(hover ?? "");
  }, []);

  useEffect(() => {
    setSelectedBoxId(null);
    setDetectionBoxes([]);
    recorderCtlRef.current?.stop();
    setIsRecording(false);
    recorderCtlRef.current = null;
    setCameraBottomFeedback(null);
    if (cameraBottomFeedbackTimerRef.current != null) {
      window.clearTimeout(cameraBottomFeedbackTimerRef.current);
      cameraBottomFeedbackTimerRef.current = null;
    }
    setUavActionBusy({});
    setUavDockExpanded(effectiveExpandedMode);
  }, [activeStreamId, effectiveExpandedMode]);

  useEffect(() => {
    return () => {
      recorderCtlRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const onSynced = () => {
      void (async () => {
        const [cams, devs, thirdParty] = await Promise.all([
          fetchCameraRegistryFromPublic(),
          fetchDroneDevicesFromPublic(),
          fetchThirdPartyCamerasFromApi(),
        ]);
        setCfg((prev) => {
          if (!prev) return prev;
          try {
            return mergeRegistryStreams(stripRegistryStreams(prev), cams, devs, thirdParty);
          } catch {
            return prev;
          }
        });
      })();
    };
    window.addEventListener("nexus:drone-registry-synced", onSynced);
    return () => window.removeEventListener("nexus:drone-registry-synced", onSynced);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 后台同步即可：8090 慢/挂起时勿阻塞首屏（放大窗会整页重挂载本 effect）
        void fetch("/api/eo-drone-registry/sync", {
          method: "POST",
          signal: AbortSignal.timeout(8_000),
        }).catch(() => {});

        /** 放大窗：直接用小窗当前流，禁止先 seed dock 默认 camera_004 */
        const sharedBoot = sharedPlayback?.stream;
        if (sharedBoot?.id) {
          const bootId = sharedBoot.id;
          const ice = sharedPlayback?.iceServers ?? [];
          const buildCfg = (
            zOthersStreams: EoVideoStreamEntry[],
            cameras: Awaited<ReturnType<typeof fetchCameraRegistryFromPublic>>,
            devices: Awaited<ReturnType<typeof fetchDroneDevicesFromPublic>>,
            thirdParty: Awaited<ReturnType<typeof fetchThirdPartyCamerasFromApi>>,
          ): EoVideoStreamsConfig => {
            const streamsMap = new Map<string, EoVideoStreamEntry>();
            streamsMap.set(bootId, sharedBoot);
            for (const s of zOthersStreams) streamsMap.set(s.id, s);
            const streams = Array.from(streamsMap.values());
            const base: EoVideoStreamsConfig = {
              defaultStreamId: bootId,
              iceServers: ice,
              streams,
              contextMenu: {
                title: "视频源",
                menuLayout: "nested",
                groups: [{ label: "光电", streamIds: streams.map((s) => s.id) }],
              },
            };
            const merged = mergeRegistryStreams(base, cameras, devices, thirdParty);
            /** merge 会 strip 掉 registrySource=uav/camera；小窗当前流必须保留 */
            const hasBoot = merged.streams.some((s) => s.id === bootId);
            const nextStreams = hasBoot
              ? merged.streams.map((s) =>
                  s.id === bootId
                    ? {
                        ...sharedBoot,
                        ...s,
                        uav: s.uav ?? sharedBoot.uav,
                        label: s.label || sharedBoot.label,
                      }
                    : s,
                )
              : [sharedBoot, ...merged.streams];
            return {
              ...merged,
              defaultStreamId: bootId,
              streams: nextStreams,
            };
          };

          /** 首屏不走 merge（空注册表会 strip 掉 uav），立刻出画 */
          const initialCfg = buildSharedPlaybackCfg({ stream: sharedBoot, iceServers: ice });
          setCfg(initialCfg);
          setActiveStreamId(bootId);
          mainStreamPersistReadyRef.current = true;
          setLoadErr(null);

          void (async () => {
            const [cameras, devices, thirdParty, zOthersStreams] = await Promise.all([
              fetchCameraRegistryFromPublic(),
              fetchDroneDevicesFromPublic(),
              fetchThirdPartyCamerasFromApi(),
              loadZOthersWebRtcSources().catch(() => [] as EoVideoStreamEntry[]),
            ]);
            if (cancelled) return;
            const nextCfg = buildCfg(zOthersStreams, cameras, devices, thirdParty);
            setCfg(nextCfg);
            if (nextCfg.streams.some((s) => s.id === bootId)) {
              setActiveStreamId(bootId);
            }
            mainStreamPersistReadyRef.current = true;
          })();
          return;
        }

        if (entity) {
          /**
           * 放大窗必须跟父面板当前流：dock 的 entityId 常为默认 camera_004，
           * 用户已切到 camera_001 时 initialStreamId=001；首屏若只 seed entity 会回落成 004，
           * 还会经 streamSyncKey 把小窗也改掉。
           *
           * 小窗刷新：须先读 localStorage 记忆流并 seed 进 streams；否则首屏只有 entity，
           * getSaved 因不在列表而失败 → 落到 004，再写回 localStorage 冲掉记忆。
           */
          const pinRaw =
            expandedMode && (initialStreamId ?? "").trim() ? (initialStreamId ?? "").trim() : "";
          /** 兼容 camera-001 / camera_001，放大时按父面板当前流拉播放，而不是 dock 默认 entity */
          const pinStreamId = pinRaw
            ? parseCameraEntityIdFromStreamId(pinRaw) || pinRaw
            : "";
          const rememberedRaw = !expandedMode ? getRawSavedActiveStreamId()?.trim() || "" : "";
          const rememberedStreamId = rememberedRaw
            ? parseCameraEntityIdFromStreamId(rememberedRaw) || rememberedRaw
            : "";
          const bootStreamId = pinStreamId || rememberedStreamId || entity;

          let seedId = bootStreamId;
          let p: Awaited<ReturnType<typeof fetchCameraEntityPlayback>>;
          /**
           * 第三方相机无实体 WebRTC 播放地址：勿用 `/api/entity-v1` 结果当 seed，
           * 否则无 registrySource 的条目会抢在正式 UDP 流之前，刷新后黑屏。
           */
          if (isThirdPartyCameraEntityId(bootStreamId)) {
            try {
              p = await fetchCameraEntityPlayback(entity);
            } catch {
              p = {
                label: bootStreamId,
                signalingUrl: "",
                iceServers: [],
                rawVideoUrl: "",
              };
            }
            seedId = bootStreamId;
          } else {
            try {
              p = await fetchCameraEntityPlayback(bootStreamId);
            } catch (bootErr) {
              if (bootStreamId === entity) throw bootErr;
              // 无人机等非实体流：先用 dock entity 出壳，注册表回来后再 pin / 记忆流
              p = await fetchCameraEntityPlayback(entity);
              seedId = entity;
            }
          }
          if (cancelled) return;

          const buildCfg = (
            zOthersStreams: EoVideoStreamEntry[],
            cameras: Awaited<ReturnType<typeof fetchCameraRegistryFromPublic>>,
            devices: Awaited<ReturnType<typeof fetchDroneDevicesFromPublic>>,
            thirdParty: Awaited<ReturnType<typeof fetchThirdPartyCamerasFromApi>>,
          ): EoVideoStreamsConfig => {
            const streamsMap = new Map<string, EoVideoStreamEntry>();
            streamsMap.set(
              seedId,
              isThirdPartyCameraEntityId(seedId)
                ? buildThirdPartyUdpSeedEntry(seedId, rememberedRaw || p.label || seedId)
                : {
                    id: seedId,
                    label: p.label,
                    signalingUrl: p.signalingUrl,
                  },
            );
            // pin / 记忆流尚未能拉到播放信息时先占位，等注册表合并后再切过去
            if (pinStreamId && pinStreamId !== seedId) {
              streamsMap.set(
                pinStreamId,
                isThirdPartyCameraEntityId(pinStreamId)
                  ? buildThirdPartyUdpSeedEntry(pinStreamId, pinRaw || pinStreamId)
                  : {
                      id: pinStreamId,
                      label: pinStreamId,
                      signalingUrl: "",
                    },
              );
            }
            if (rememberedStreamId && rememberedStreamId !== seedId && rememberedStreamId !== pinStreamId) {
              streamsMap.set(
                rememberedStreamId,
                isThirdPartyCameraEntityId(rememberedStreamId)
                  ? buildThirdPartyUdpSeedEntry(rememberedStreamId, rememberedRaw || rememberedStreamId)
                  : {
                      id: rememberedStreamId,
                      label: rememberedRaw || rememberedStreamId,
                      signalingUrl: "",
                    },
              );
            }
            if (
              rememberedRaw &&
              rememberedRaw !== rememberedStreamId &&
              rememberedRaw !== seedId &&
              !streamsMap.has(rememberedRaw)
            ) {
              streamsMap.set(
                rememberedRaw,
                isThirdPartyCameraEntityId(rememberedRaw)
                  ? buildThirdPartyUdpSeedEntry(rememberedRaw)
                  : {
                      id: rememberedRaw,
                      label: rememberedRaw,
                      signalingUrl: "",
                    },
              );
            }
            if (entity !== seedId && entity !== pinStreamId && entity !== rememberedStreamId) {
              streamsMap.set(entity, {
                id: entity,
                label: entity,
                signalingUrl: "",
              });
            }
            for (const s of zOthersStreams) streamsMap.set(s.id, s);
            const streams = Array.from(streamsMap.values());
            const base: EoVideoStreamsConfig = {
              defaultStreamId: seedId,
              iceServers: p.iceServers,
              streams,
              contextMenu: {
                title: "视频源",
                menuLayout: "nested",
                groups: [
                  {
                    label: "光电",
                    streamIds: streams.map((s) => s.id),
                  },
                ],
              },
            };
            return mergeRegistryStreams(base, cameras, devices, thirdParty);
          };

          const applyActive = (nextCfg: EoVideoStreamsConfig, registryReady = false) => {
            /** 放大浮层：始终跟父面板传入的流（须已在 streams 中） */
            if (pinStreamId && nextCfg.streams.some((s) => s.id === pinStreamId)) {
              setActiveStreamId(pinStreamId);
              mainStreamPersistReadyRef.current = true;
              return;
            }
            if (pinRaw && nextCfg.streams.some((s) => s.id === pinRaw)) {
              setActiveStreamId(pinRaw);
              mainStreamPersistReadyRef.current = true;
              return;
            }
            const preferredInitial =
              initialStreamId && nextCfg.streams.some((s) => s.id === initialStreamId)
                ? initialStreamId
                : null;
            const saved = getSavedActiveStreamId(nextCfg);
            /**
             * 无人机记忆：注册表未到时 `uav:…` 可能尚不在 streams（旧逻辑还会被 strip 掉）。
             * 若此时落到 seedId=dock 默认 camera_004 并打开 persist，会冲掉 localStorage。
             * 注册表回来后再 apply；未就绪前禁止写回。
             */
            const pendingUavMemory =
              !saved &&
              Boolean(rememberedRaw) &&
              (rememberedRaw.startsWith("uav:") || rememberedStreamId.startsWith("uav:")) &&
              !registryReady;
            if (pendingUavMemory) {
              const keepId = nextCfg.streams.some((s) => s.id === rememberedRaw)
                ? rememberedRaw
                : nextCfg.streams.some((s) => s.id === rememberedStreamId)
                  ? rememberedStreamId
                  : rememberedRaw;
              setActiveStreamId(keepId);
              return;
            }
            setActiveStreamId(saved ?? preferredInitial ?? seedId);
            mainStreamPersistReadyRef.current = true;
          };

          const initialCfg = buildCfg([], [], [], { udp: [], webrtc: [] });
          setCfg(initialCfg);
          applyActive(initialCfg, false);
          setLoadErr(null);

          void (async () => {
            const [cameras, devices, thirdParty, zOthersStreams] = await Promise.all([
              fetchCameraRegistryFromPublic(),
              fetchDroneDevicesFromPublic(),
              fetchThirdPartyCamerasFromApi(),
              loadZOthersWebRtcSources().catch(() => [] as EoVideoStreamEntry[]),
            ]);
            if (cancelled) return;
            const nextCfg = buildCfg(zOthersStreams, cameras, devices, thirdParty);
            setCfg(nextCfg);
            applyActive(nextCfg, true);
          })();
          return;
        }

        // 无 entity：先出静态流配置，再后台合并 8090 注册表
        const c = await loadEoVideoConfig(configUrl);
        if (cancelled) return;
        const pinStreamId =
          expandedMode && (initialStreamId ?? "").trim() ? (initialStreamId ?? "").trim() : "";
        const initialCfg = mergeRegistryStreams(c, [], [], { udp: [], webrtc: [] });
        setCfg(initialCfg);
        {
          if (pinStreamId && initialCfg.streams.some((s) => s.id === pinStreamId)) {
            setActiveStreamId(pinStreamId);
          } else {
            const preferredInitial =
              initialStreamId && initialCfg.streams.some((s) => s.id === initialStreamId)
                ? initialStreamId
                : null;
            /** 记忆优先于配置 default，避免刷新总落到默认相机 */
            setActiveStreamId(
              getSavedActiveStreamId(initialCfg) ?? preferredInitial ?? c.defaultStreamId,
            );
          }
          mainStreamPersistReadyRef.current = true;
        }
        setLoadErr(null);

        void (async () => {
          const [cameras, devices, thirdParty] = await Promise.all([
            fetchCameraRegistryFromPublic(),
            fetchDroneDevicesFromPublic(),
            fetchThirdPartyCamerasFromApi(),
          ]);
          if (cancelled) return;
          const nextCfg = mergeRegistryStreams(c, cameras, devices, thirdParty);
          setCfg(nextCfg);
          if (pinStreamId && nextCfg.streams.some((s) => s.id === pinStreamId)) {
            setActiveStreamId(pinStreamId);
          } else {
            const preferredInitial =
              initialStreamId && nextCfg.streams.some((s) => s.id === initialStreamId)
                ? initialStreamId
                : null;
            setActiveStreamId(
              getSavedActiveStreamId(nextCfg) ?? preferredInitial ?? c.defaultStreamId,
            );
          }
          mainStreamPersistReadyRef.current = true;
        })();
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    configUrl,
    entity,
    expandedMode,
    getRawSavedActiveStreamId,
    getSavedActiveStreamId,
    initialStreamId,
    sharedPlayback?.stream?.id,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !streamSyncKey) return;
    if (!mainStreamPersistReadyRef.current) return;
    const id = activeStreamId.trim();
    if (!id) return;
    /**
     * 放大窗启动时可能短暂回落到 dock 默认 entity（常为 camera_004），
     * 若此时写 SyncStore 会冲掉小窗当前流（如无人机）。
     * 仅拦截「非用户主动切流」的 entity 回落；用户主动选 camera_004 必须同步。
     */
    if (expandedMode && !userPickedStreamRef.current) {
      const pin = (initialStreamId ?? "").trim();
      const pinCanon = parseCameraEntityIdFromStreamId(pin) || pin;
      if (pinCanon && entity && id === entity && id !== pinCanon && id !== pin) return;
    }
    useEoVideoStreamSelectionSyncStore.getState().setMainFromPanel(streamSyncKey, id);
  }, [activeStreamId, streamSyncKey, expandedMode, initialStreamId, entity]);

  useEffect(() => {
    if (typeof window === "undefined" || !streamSyncKey) return;
    const id = pipStreamId.trim();
    if (!id) return;
    useEoVideoStreamSelectionSyncStore.getState().setPipFromPanel(streamSyncKey, id);
  }, [pipStreamId, streamSyncKey]);

  const activeStream = useMemo((): EoVideoStreamEntry | undefined => {
    const found = findStreamById(cfg?.streams, activeStreamId);
    if (found) return found;
    const sid = activeStreamId.trim();
    /**
     * 禁止 `?? streams[0]`：切到 camera-hs-002 时若列表短暂未命中，回落到 dock 默认
     * camera_004 会导致黑屏（无「等待 UDP」）且右下角误显 004 跟踪态。
     * 第三方 id 先合成临时 UDP 壳，等 registry 合并后再换成正式条目。
     */
    if (isThirdPartyCameraEntityId(sid)) {
      const mcast = getThirdPartyCameraMulticastUdp();
      return {
        id: sid,
        label: sid,
        signalingUrl: "",
        registrySource: "thirdPartyCamera",
        ...(mcast ? { multicastUdp: mcast } : {}),
      };
    }
    if (sid) return undefined;
    return cfg?.streams[0];
  }, [cfg, activeStreamId]);

  const expandFloatingFrameTitle = useMemo(() => {
    const fromDock = getEoVideoExpandDockBaseTitle(dockPidNorm);
    const base = (fromDock || activeStream?.label?.trim() || "光电").trim();
    return `${base}-放大`;
  }, [dockPidNorm, activeStream?.label]);

  const isThirdPartyStream = useMemo(
    () => Boolean(activeStream && activeStream.registrySource === "thirdPartyCamera"),
    [activeStream],
  );

  const isThirdPartyUdpStream = useMemo(
    () => isThirdPartyUdpStreamEntry(activeStream),
    [activeStream],
  );

  const isThirdPartyWebrtcStream = useMemo(
    () => isThirdPartyWebrtcStreamEntry(activeStream),
    [activeStream],
  );
  const isYuan8Stream = useMemo(() => isYuan8StreamEntry(activeStream), [activeStream]);

  const thirdPartyStackRef = useRef<EoHighSpeedYuvStackHandle | null>(null);

  const onThirdPartyUdpFrameTick = useCallback(
    (tick: {
      entityId: string;
      videoWidth: number;
      videoHeight: number;
      strideY: number;
      yuvBytes: number;
      yMean: number;
      frameIndex: number;
      framesInWindow: number;
    }) => {
      /** 仅右侧 Debug / 全局调试 UI 打开时写日志（不自动开面板） */
      if (!(EO_VIDEO_DEBUG_UI || cameraExpandedDebugOpen)) return;
      const y = tick.yMean >= 0 ? `Ymean=${tick.yMean.toFixed(1)}` : "Ymean=?";
      const line =
        `${new Date().toLocaleTimeString()} [第三方UDP图] ${tick.entityId} #${tick.frameIndex} ` +
        `${tick.framesInWindow}fps ${tick.videoWidth}×${tick.videoHeight} ` +
        `yuv=${tick.yuvBytes}B ${y}`;
      setClientEcho((prev) => {
        const next = prev ? `${line}\n${prev}` : line;
        return next.length > 4000 ? next.slice(0, 4000) : next;
      });
    },
    [cameraExpandedDebugOpen],
  );

  const thirdPartyLive = useEoThirdPartyCameraWebSocket(
    Boolean(isThirdPartyUdpStream && activeStream?.id),
    activeStream?.id,
    thirdPartyStackRef,
    onThirdPartyUdpFrameTick,
  );
  const [thirdPartyCamBusy, setThirdPartyCamBusy] = useState(false);

  const thirdPartyCaptureReady = useMemo(
    () =>
      Boolean(
        isThirdPartyUdpStream &&
          thirdPartyLive.hasFrame &&
          thirdPartyLive.videoWidth > 0 &&
          thirdPartyLive.videoHeight > 0,
      ),
    [isThirdPartyUdpStream, thirdPartyLive.hasFrame, thirdPartyLive.videoHeight, thirdPartyLive.videoWidth],
  );

  /** 第三方 WebRTC：仅在右侧 Debug / 全局调试 UI 打开时，约每秒记一帧更新日志 */
  useEffect(() => {
    if (!(EO_VIDEO_DEBUG_UI || cameraExpandedDebugOpen)) return;
    if (!isThirdPartyWebrtcStream) return;
    const entity = (activeStream?.id ?? "").trim() || "unknown";
    let cancelled = false;
    let prevDecoded: number | null = null;
    let frameIndex = 0;

    const tick = async () => {
      if (cancelled) return;
      const v = videoRef.current;
      const pc = peerConnectionRef.current;
      let decoded: number | null = null;
      if (pc) {
        try {
          const stats = await pc.getStats();
          for (const report of stats.values()) {
            if (report.type !== "inbound-rtp") continue;
            const rtp = report as RTCInboundRtpStreamStats;
            if (rtp.kind !== "video") continue;
            if (typeof rtp.framesDecoded === "number" && Number.isFinite(rtp.framesDecoded)) {
              decoded = rtp.framesDecoded;
              break;
            }
          }
        } catch {
          /* getStats 失败仍记 video 状态 */
        }
      }
      if (cancelled) return;
      const delta =
        decoded != null && prevDecoded != null ? Math.max(0, decoded - prevDecoded) : null;
      if (decoded != null) prevDecoded = decoded;
      frameIndex += 1;
      const vw = v?.videoWidth ?? 0;
      const vh = v?.videoHeight ?? 0;
      const t = v?.currentTime ?? 0;
      const ready = v?.readyState ?? 0;
      const pcState = pc?.connectionState ?? "none";
      const fpsPart = delta != null ? `${delta}fps` : "fps=?";
      const line =
        `${new Date().toLocaleTimeString()} [第三方WebRTC] ${entity} #${frameIndex} ` +
        `${fpsPart} ${vw}×${vh} t=${t.toFixed(2)}s ready=${ready} pc=${pcState}` +
        (decoded != null ? ` decoded=${decoded}` : "");
      setClientEcho((prev) => {
        const next = prev ? `${line}\n${prev}` : line;
        return next.length > 4000 ? next.slice(0, 4000) : next;
      });
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    cameraExpandedDebugOpen,
    isThirdPartyWebrtcStream,
    activeStream?.id,
  ]);

  const thirdPartyWideStoreKey = useMemo(() => {
    const id = activeStream?.id;
    if (!id) return "";
    return canonicalEntityId(id) || id.trim().toLowerCase();
  }, [activeStream?.id]);

  const thirdPartyWideSubCams = useEoThirdPartyUdpDevStatusStore((s) =>
    thirdPartyWideStoreKey ? s.byEntityId[thirdPartyWideStoreKey]?.wideSubCams : undefined,
  );

  const thirdPartyFovOverlayBoxes = useMemo((): EoHighSpeedBox[] => {
    const w = thirdPartyWideSubCams;
    if (!w?.length) return [];
    return w.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  }, [thirdPartyWideSubCams]);

  const thirdPartySubPipIds = useMemo(() => {
    if (!isThirdPartyUdpStream || !cfg?.streams?.length || !thirdPartyWideSubCams?.length) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const norm = (id: string) => canonicalEntityId(id) || id.trim().toLowerCase();
    const tpKeys = new Set(
      cfg.streams.filter((s) => s.registrySource === "thirdPartyCamera").map((s) => norm(s.id)),
    );
    for (const b of thirdPartyWideSubCams) {
      const k = norm(b.subCam);
      if (!k || seen.has(k)) continue;
      if (!tpKeys.has(k)) continue;
      seen.add(k);
      out.push(b.subCam.trim());
    }
    return out;
  }, [isThirdPartyUdpStream, cfg?.streams, thirdPartyWideSubCams]);

  const showThirdPartySubPipStack =
    (pipOpen || effectiveExpandedMode) && thirdPartySubPipsVisible && isThirdPartyUdpStream && thirdPartySubPipIds.length > 0;

  const showThirdPartySubPipToggle =
    (pipOpen || effectiveExpandedMode) && isThirdPartyUdpStream && thirdPartySubPipIds.length > 0;

  useEffect(() => {
    if (!showThirdPartySubPipToggle) {
      setThirdPartySubPipsVisible(true);
    }
  }, [showThirdPartySubPipToggle]);

  const contextMenuExtraItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      disabled?: boolean;
      onSelect: () => void;
    }> = [];
    if (onClassicSetAsMain) {
      items.push({
        key: "classic-set-as-main",
        label: "设为主屏",
        onSelect: () => onClassicSetAsMain(),
      });
    }
    if (showThirdPartySubPipToggle) {
      items.push({
        key: "third-party-sub-pip-toggle",
        label: thirdPartySubPipsVisible ? "隐藏广角子窗口" : "显示广角子窗口",
        onSelect: () => setThirdPartySubPipsVisible((v) => !v),
      });
    }
    return items;
  }, [onClassicSetAsMain, showThirdPartySubPipToggle, thirdPartySubPipsVisible]);

  /**
   * 检测 WS / 画框仅绑定「当前正在看的流」。
   * 不可在无法从 streamId 解析相机时仍用页面 entity 兜底：光电页 entity 常为 camera_xxx，
   * 切到无人机后仍会订阅相机检测，框会叠在无人机画面上。
   */
  const detectionEntityId = useMemo(() => {
    /** 勿用 activeStream 的 streams[0] 回退判断 uav：失配时会错把相机检测关掉或反过来 */
    const cur = findStreamById(cfg?.streams, activeStreamId);
    if (isThirdPartyUdpStreamEntry(cur)) return undefined;
    /** 第三方 WebRTC / 8院：2088 检测 WS 与任务按流 entityId */
    if (isThirdPartyWebrtcStreamEntry(cur) || isYuan8StreamEntry(cur)) {
      const id = cur!.id.trim();
      return id ? canonicalEntityId(id) : undefined;
    }
    /** 无人机检测框 WS 已与相机一致（entityId=uav-xxx + boatRect/header 等），按机实体订阅 */
    if (cur?.uav) {
      const uavId = cur.uav.entityId?.trim();
      return uavId ? canonicalEntityId(uavId) : undefined;
    }
    const sid = activeStreamId.trim();
    /** 第三方 UDP：即使 streams 尚未合并进 cfg，也绝不能回落到 dock entity */
    if (isThirdPartyCameraEntityId(sid)) return undefined;
    const ent = entity ?? "";
    if (isCameraEntityId(sid)) return canonicalEntityId(sid);
    const fromStream = parseCameraEntityIdFromStreamId(sid);
    if (fromStream) return fromStream;
    if (ent && sid === ent) {
      if (isCameraEntityId(ent)) return canonicalEntityId(ent);
      const fromEntity = parseCameraEntityIdFromStreamId(ent);
      if (fromEntity) return fromEntity;
    }
    return undefined;
  }, [cfg, activeStreamId, entity]);

  /**
   * 底部 DDS 任务行绑定的相机实体：可与 `detectionEntityId` 不同。
   * 检测必须严格对齐「当前流画面」；DDS store 按 entityId 更新，页面 entity 为 camera_xxx 但流 id 为自定义时仍应对上 C++ 同机状态。
   */
  const cameraDdsEntityId = useMemo(() => {
    const cur = findStreamById(cfg?.streams, activeStreamId);
    if (isThirdPartyUdpStreamEntry(cur)) return undefined;
    if (cur?.registrySource === "thirdPartyCamera") return undefined;
    if (cur?.uav) return undefined;
    const sid = activeStreamId.trim();
    /**
     * 正在看第三方相机时禁止回落 dock entity（常见 camera_004）：
     * 否则右下角会显示「正在跟踪xx号目标」等标准光电站态，而画面走错 WebRTC 黑屏。
     */
    if (isThirdPartyCameraEntityId(sid)) return undefined;
    if (detectionEntityId) return detectionEntityId;
    if (cur?.registrySource === "camera" && cur.id && isCameraEntityId(cur.id)) {
      return canonicalEntityId(cur.id);
    }
    if (isCameraEntityId(sid)) return canonicalEntityId(sid);
    const fromStream = parseCameraEntityIdFromStreamId(sid);
    if (fromStream) return fromStream;
    const ent = entity?.trim() ?? "";
    /** 仅当当前流 id 就是 entity / 能解析为同一相机时才用 entity */
    if (ent && (!sid || sid === ent || fromStream === canonicalEntityId(ent))) {
      if (isCameraEntityId(ent)) return canonicalEntityId(ent);
      const fromEnt = parseCameraEntityIdFromStreamId(ent);
      if (fromEnt) return fromEnt;
    }
    return undefined;
  }, [cfg, activeStreamId, detectionEntityId, entity]);

  /** 烧录流：`live/{id}_burn` / `stream=*_burn` 等，框已在码流内 */
  const isBurnInPlayback = useMemo(
    () =>
      isEoBurnInPlaybackUrl(cameraResolvedUrl) ||
      isEoBurnInPlaybackUrl(activeStream?.signalingUrl) ||
      isEoBurnInPlaybackUrl(activeStream?.webrtcUrl),
    [cameraResolvedUrl, activeStream?.signalingUrl, activeStream?.webrtcUrl],
  );

  const detectionEnabled = Boolean(
    detectionEntityId &&
      cfg &&
      !(activeStream?.uav && uavVideoOnly) &&
      /** 放大窗未对齐父面板流前不订检测，避免闪一下 dock 默认 camera_004 框 */
      !(
        expandedMode &&
        (initialStreamId ?? "").trim() &&
        activeStreamId.trim() !== (initialStreamId ?? "").trim()
      ),
  );
  const ptzSupported = Boolean(detectionEntityId && /^camera_[0-9]{3}$/i.test(detectionEntityId));

  const handleSelectDetectionBox = useCallback(
    (boxId: string | null) => {
      setSelectedBoxId(boxId);
      const entityId = (detectionEntityId ?? "").trim().toLowerCase();
      if (!entityId || !/^camera_\d{3}$/.test(entityId)) return;
      const box = boxId ? detectionBoxes.find((b) => b.id === boxId) ?? null : null;
      const rectId = resolveEoBurnInRectId(box);
      void postEoBurnInSelect({
        entityId,
        rectId,
        backendBaseUrl: taskBackendBaseUrl,
      }).then((r) => {
        if (!r.ok) {
          console.warn("[burn-in-select]", r.error ?? "failed", r.detail ?? "");
        }
      });
    },
    [detectionBoxes, detectionEntityId, taskBackendBaseUrl],
  );

  useEffect(() => {
    if (!ptzSupported && !isThirdPartyStream && !isYuan8Stream) setPtzPanelOpen(false);
  }, [ptzSupported, isThirdPartyStream, isYuan8Stream]);

  const mqttWsUrlFromEnv =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_MQTT_WS_URL
      ? String(process.env.NEXT_PUBLIC_MQTT_WS_URL).trim()
      : "";

  useEffect(() => {
    if (mqttWsUrlFromEnv) {
      setPlatformMqtt({ status: "idle", wsUrl: "" });
      return;
    }
    let cancelled = false;
    setPlatformMqtt({ status: "loading", wsUrl: "" });
    void fetch("/api/uav-platform/mqtt-info", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (cancelled) return;
        if (j.ok === true && typeof j.wsUrl === "string" && j.wsUrl.trim()) {
          setPlatformMqtt({
            status: "ok",
            wsUrl: j.wsUrl.trim(),
            wsSource: typeof j.wsSource === "string" ? j.wsSource : undefined,
            mqttUsername: typeof j.mqttUsername === "string" ? j.mqttUsername : undefined,
            mqttPassword: typeof j.mqttPassword === "string" ? j.mqttPassword : undefined,
          });
        } else {
          const err =
            typeof j.detail === "string"
              ? j.detail
              : typeof j.error === "string"
                ? j.error
                : `http_${r.status}`;
          setPlatformMqtt({ status: "err", wsUrl: "", error: err });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPlatformMqtt({ status: "err", wsUrl: "", error: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mqttWsUrlFromEnv]);

  const mqttWsUrl =
    mqttWsUrlFromEnv || (platformMqtt.status === "ok" ? platformMqtt.wsUrl : "");
  const mqttWsAuthUser = platformMqtt.status === "ok" ? platformMqtt.mqttUsername : undefined;
  const mqttWsAuthPass = platformMqtt.status === "ok" ? platformMqtt.mqttPassword : undefined;

  useEffect(() => {
    setUavMqttProductIds(null);
  }, [activeStreamId]);

  const mqttAirportSn =
    (uavMqttProductIds?.airport ?? "").trim() || (activeStream?.uav?.airportSN ?? "").trim() || null;
  const mqttDeviceSn =
    (uavMqttProductIds?.device ?? "").trim() || (activeStream?.uav?.deviceSN ?? "").trim() || null;
  uavLiveSnRef.current = {
    airportSn: (mqttAirportSn ?? "").trim(),
    droneSn: (mqttDeviceSn ?? "").trim(),
  };

  useEffect(() => {
    useUavQuickContextStore.getState().setLastKnown(mqttAirportSn, mqttDeviceSn);
  }, [mqttAirportSn, mqttDeviceSn]);

  /** 地图右键无人机任务：任务服务 `deviceSn` 填机场 SN（与 WatchSys 下发一致），非机体 SN */
  useEffect(() => {
    const pid = dockPidNorm;
    if (!pid || eoFocusedDockId !== pid) return;
    if (!activeStream?.uav) {
      useEoFocusedUavAirportSnStore.getState().setAirportSn("");
      return;
    }
    const ap = (mqttAirportSn ?? activeStream.uav.airportSN ?? "").trim();
    if (!ap) {
      useEoFocusedUavAirportSnStore.getState().setAirportSn("");
      return;
    }
    useEoFocusedUavAirportSnStore.getState().setAirportSn(ap);
  }, [dockPidNorm, eoFocusedDockId, activeStream?.uav, mqttAirportSn, activeStream?.uav?.airportSN]);

  const { droneInDock: mqttDroneInDock, mqttAirportLatLon, mqttTelemetry, mqttHud, mqttConnected } = useUavMqttDockState({
    enabled: Boolean(activeStream?.uav && mqttWsUrl && (mqttAirportSn || mqttDeviceSn)),
    airportSN: mqttAirportSn,
    deviceSN: mqttDeviceSn,
    wsUrl: mqttWsUrl || null,
    mqttUsername: mqttWsAuthUser ?? null,
    mqttPassword: mqttWsAuthPass ?? null,
  });

  /** 底部条右侧：相机 DDS / 无人机任务态；回仓（drone_in_dock）后切「空闲中」 */
  const ddsBottomTaskLine = useEoVideoDdsTaskLine({
    variant: activeStream?.uav ? "uav" : "camera",
    cameraEntityId: cameraDdsEntityId,
    droneEntityId: activeStream?.uav?.entityId ?? null,
    droneInDock: activeStream?.uav ? mqttDroneInDock : null,
    airportSn: activeStream?.uav ? mqttAirportSn : null,
  });

  const uavTrackingActive = useMemo(() => {
    if (uavTrackTaskId) return true;
    const line = ddsBottomTaskLine.trim();
    if (!line || line === "空闲中") return false;
    return /跟踪|trace|tracking/i.test(line);
  }, [ddsBottomTaskLine, uavTrackTaskId]);

  /** 底栏电量：在舱优先机场充电百分比，与 EoUavConsoleDock 一致 */
  const uavBottomBatteryPct = useMemo(() => {
    if (!activeStream?.uav) return null;
    if (
      mqttDroneInDock === true &&
      mqttTelemetry?.airportDroneChargePercent != null &&
      mqttTelemetry?.airportDroneChargePercent !== undefined
    ) {
      return mqttTelemetry.airportDroneChargePercent;
    }
    return mqttTelemetry?.batteryPercent ?? null;
  }, [
    activeStream?.uav,
    mqttDroneInDock,
    mqttTelemetry?.airportDroneChargePercent,
    mqttTelemetry?.batteryPercent,
  ]);

  const uavMqttFooterLine = useMemo(() => {
    if (!activeStream?.uav) return "";
    if (platformMqtt.status === "loading" && !mqttWsUrlFromEnv) {
      return "无人机MQTT | 正在从私有云拉取 mqtt 地址…";
    }
    if (!mqttWsUrl) {
      const hint = platformMqtt.status === "err" ? platformMqtt.error ?? "unknown" : "无";
      return `无人机MQTT | 无（${mqttWsUrlFromEnv ? "未就绪" : `平台: ${hint}`}）`;
    }
    const src = mqttWsUrlFromEnv ? "环境变量" : `8890/${platformMqtt.wsSource ?? "api"}`;
    const dockTxt = mqttDroneInDock === null ? "无" : mqttDroneInDock ? "舱内" : "舱外";
    const recentTxt =
      mqttHud.rxCount === 0
        ? "无"
        : `topic=${mqttHud.lastTopic ?? "无"} · 载荷=${mqttHud.lastPayloadLine ?? "无"}`;
    const subLine = mqttHud.plannedTopicsLine || mqttHud.topicsLine || "无";
    const wsDial = mqttHud.connectUrl || mqttWsUrl;
    /** 刷新后 broker 回包前会短暂未连上；仅 https→wss 提示不算失败 */
    const httpsWsHint = mqttHud.lastError?.includes("https 页面已改用 wss") ?? false;
    const pendingBroker =
      !mqttHud.connected && (!mqttHud.lastError || httpsWsHint) && Boolean(subLine && subLine !== "无");
    const connTxt = mqttHud.connected ? "是" : pendingBroker ? "建立中…" : "否";
    const llTxt = mqttAirportLatLon
      ? `起飞坐标:${mqttAirportLatLon.latitude.toFixed(6)},${mqttAirportLatLon.longitude.toFixed(6)}`
      : "起飞坐标:待MQTT";
    const parts = [
      "无人机MQTT",
      `来源:${src}`,
      `SN:机场=${mqttAirportSn ?? "无"}|机体=${mqttDeviceSn ?? "无"}`,
      `WS(拨号):${wsDial}`,
      `连接:${connTxt}`,
      `订阅:${subLine}`,
      `已收消息:${mqttHud.rxCount > 0 ? String(mqttHud.rxCount) : "无"}`,
      `最近报文:${recentTxt}`,
      `舱状态:${dockTxt}`,
      llTxt,
    ];
    if (mqttHud.lastError) parts.push(`错误:${mqttHud.lastError}`);
    return parts.join(" | ");
  }, [
    activeStreamId,
    activeStream?.uav,
    mqttWsUrl,
    mqttWsUrlFromEnv,
    platformMqtt.status,
    platformMqtt.error,
    platformMqtt.wsSource,
    mqttDroneInDock,
    mqttAirportLatLon,
    mqttAirportSn,
    mqttDeviceSn,
    mqttHud,
  ]);

  useEffect(() => {
    const uav = activeStream?.uav;
    if (!uav) {
      uavUrlsRef.current = null;
      uavPlayUrlCommittedRef.current = false;
      uavPlayUrlDockRef.current = null;
      setUavMqttProductIds(null);
      setUavPlaySignalingUrl(null);
      setUavPlayLoading(false);
      setUavPlayErr(null);
      setUavResolveDebug("");
      return;
    }
    /** 放大窗复用小窗流：不必再解析 ZLM / 私有云地址 */
    if (reuseSharedStream) {
      setUavPlayLoading(false);
      setUavPlayErr(null);
      return;
    }
    let cancelled = false;
    uavPlayUrlCommittedRef.current = false;
    uavPlayUrlDockRef.current = null;
    setUavPlaySignalingUrl(null);
    void (async () => {
      setUavPlayLoading(true);
      setUavPlayErr(null);
      try {
        const resolved = await fetchResolvedUavPlaybackIds(uav.entityId).catch(() => null);
        const airportSn = resolved?.airportSN ?? uav.airportSN;
        const droneSn = resolved?.deviceSN ?? uav.deviceSN;
        const mainPayload = droneSn === "1581F6QAD241200BWX4E" ? DRONE_MAIN_PAYLOAD_SPECIAL : DRONE_MAIN_PAYLOAD;

        /** 现场 ZLM：91 端口，app=live，stream=livestream/<SN>-<payload> */
        let dockZlm: string | null = null;
        let airZlm: string | null = null;
        let dockZlmRaw = "";
        let airZlmRaw = "";
        if (airportSn) {
          try {
            dockZlm = buildUavZlmSignalingUrl(airportSn, AIRPORT_FPV_PAYLOAD);
            const zlmBase = getUavZlmWebrtcBaseUrl();
            const sk = buildUavZlmStreamKey(airportSn, AIRPORT_FPV_PAYLOAD);
            dockZlmRaw = `${zlmBase}/index/api/webrtc?app=live&stream=${encodeURIComponent(sk)}&type=play`;
          } catch {
            dockZlm = null;
          }
        }
        if (droneSn) {
          try {
            airZlm = buildUavZlmSignalingUrl(droneSn, mainPayload);
            const zlmBase = getUavZlmWebrtcBaseUrl();
            const sk = buildUavZlmStreamKey(droneSn, mainPayload);
            airZlmRaw = `${zlmBase}/index/api/webrtc?app=live&stream=${encodeURIComponent(sk)}&type=play`;
          } catch {
            airZlm = null;
          }
        }

        // 无 ZLM 拼接结果时再走私有云取流（device_sn + payload_index）
        const [platformDock, platformAir] = await Promise.all([
          !dockZlm && airportSn
            ? fetchUavPlatformSignalingUrl({ deviceSn: airportSn, payloadIndex: AIRPORT_FPV_PAYLOAD }).catch((e) => ({
                err: e as unknown,
              }))
            : Promise.resolve(null),
          !airZlm && droneSn
            ? fetchUavPlatformSignalingUrl({ deviceSn: droneSn, payloadIndex: mainPayload }).catch((e) => ({
                err: e as unknown,
              }))
            : Promise.resolve(null),
        ]);
        const dockCandidates = uniqueCandidates(
          resolved?.dockPlaybackEntityId,
          resolved?.airportSN,
          uav.dockPlaybackEntityId,
          uav.airportSN,
          uav.entityId,
        );
        const airCandidates = uniqueCandidates(
          resolved?.airPlaybackEntityId,
          resolved?.deviceSN,
          uav.airPlaybackEntityId,
          uav.deviceSN,
          uav.entityId,
        );
        const [dockResult, airResult] = await Promise.all([
          dockZlm
            ? Promise.resolve({ signalingUrl: dockZlm, picked: `zlm:${airportSn}:${AIRPORT_FPV_PAYLOAD}` })
            : platformDock
              ? "err" in platformDock
                ? resolvePlaybackByCandidates(dockCandidates).catch((e) => ({ err: e as unknown }))
                : Promise.resolve({
                    signalingUrl: platformDock.signalingUrl,
                    picked: `platform:${airportSn}:${AIRPORT_FPV_PAYLOAD}`,
                  })
              : resolvePlaybackByCandidates(dockCandidates).catch((e) => ({ err: e as unknown })),
          airZlm
            ? Promise.resolve({ signalingUrl: airZlm, picked: `zlm:${droneSn}:${mainPayload}` })
            : platformAir
              ? "err" in platformAir
                ? resolvePlaybackByCandidates(airCandidates).catch((e) => ({ err: e as unknown }))
                : Promise.resolve({
                    signalingUrl: platformAir.signalingUrl,
                    picked: `platform:${droneSn}:${mainPayload}`,
                  })
              : resolvePlaybackByCandidates(airCandidates).catch((e) => ({ err: e as unknown })),
        ]);
        if (cancelled) return;

        const dockErr = "err" in dockResult ? dockResult.err : null;
        const airErr = "err" in airResult ? airResult.err : null;
        const dockUrl = "signalingUrl" in dockResult ? dockResult.signalingUrl : null;
        const airUrl = "signalingUrl" in airResult ? airResult.signalingUrl : null;

        if (!dockUrl && !airUrl) {
          const dockPlatformMsg =
            platformDock && "err" in platformDock
              ? platformDock.err instanceof Error
                ? platformDock.err.message
                : String(platformDock.err ?? "")
              : "";
          const airPlatformMsg =
            platformAir && "err" in platformAir
              ? platformAir.err instanceof Error
                ? platformAir.err.message
                : String(platformAir.err ?? "")
              : "";
          const dockMsg = dockErr instanceof Error ? dockErr.message : String(dockErr ?? "");
          const airMsg = airErr instanceof Error ? airErr.message : String(airErr ?? "");
          throw new Error(
            `实体播放解析失败（机场/机体均不可用）: 平台机场=${dockPlatformMsg || "n/a"} | 平台机体=${airPlatformMsg || "n/a"} | 实体机场=${dockMsg} | 实体机体=${airMsg}`,
          );
        }

        const urls = {
          dock: dockUrl ?? airUrl ?? "",
          air: airUrl ?? dockUrl ?? "",
        };
        const dockRaw =
          dockZlmRaw || (platformDock && !("err" in platformDock) ? platformDock.rawUrl : "");
        const airRaw = airZlmRaw || (platformAir && !("err" in platformAir) ? platformAir.rawUrl : "");
        const debugLine = [
          `dock.sn=${airportSn || "-"}`,
          `dock.payload=${AIRPORT_FPV_PAYLOAD}`,
          `dock.raw=${dockRaw || "-"}`,
          `dock.sig=${urls.dock || "-"}`,
          `air.sn=${droneSn || "-"}`,
          `air.payload=${mainPayload}`,
          `air.raw=${airRaw || "-"}`,
          `air.sig=${urls.air || "-"}`,
          `mqtt.product=${airportSn || "-"}|${droneSn || "-"}`,
        ].join(" | ");
        setUavResolveDebug(debugLine);
        if (!cancelled) {
          setUavMqttProductIds({
            airport: (airportSn ?? "").trim(),
            device: (droneSn ?? "").trim(),
          });
        }
        // 只缓存双路 URL；真正提交信令由下方「等舱状态 → poke → 设 URL」完成，避免先连错路再闪切
        uavUrlsRef.current = urls;
        setUavUrlsEpoch((n) => n + 1);
      } catch (e) {
        if (!cancelled) {
          setUavPlayErr(e instanceof Error ? e.message : String(e));
          setUavPlaySignalingUrl(null);
          setUavResolveDebug((prev) => prev || "uav resolve failed before url ready");
          setUavPlayLoading(false);
        }
      }
      // 成功时保持 loading，直到 poke+提交信令完成
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeStreamId,
    activeStream?.uav?.entityId,
    activeStream?.uav?.dockPlaybackEntityId,
    activeStream?.uav?.airPlaybackEntityId,
    activeStream?.uav?.airportSN,
    activeStream?.uav?.deviceSN,
    reuseSharedStream,
  ]);

  useEffect(() => {
    mqttDroneInDockRef.current = mqttDroneInDock;
  }, [mqttDroneInDock]);

  /**
   * 提交无人机播放信令：
   * 1) 等 MQTT 舱状态（短超时）再选机场/机体，避免「先机体后机场」中间闪一次；
   * 2) 先 poke 唤醒推流，再设 URL 建连一次，避免连空流后再踢；
   * 3) 之后仅在舱内↔舱外真实切换时换源。
   */
  useEffect(() => {
    if (reuseSharedStream) return;
    if (!activeStream?.uav) return;
    const urls = uavUrlsRef.current;
    if (!urls || uavUrlsEpoch <= 0) return;

    let cancelled = false;
    let waitTimer: number | null = null;

    const pokeThenCommit = async (dockState: boolean | null, reason: string) => {
      const nextUrl = pickUavPlaySignalingUrl(urls, dockState);
      const { airportSn: ap, droneSn: dr } = uavLiveSnRef.current;
      try {
        const { parts } = await pokeUavLiveStreamsForView({
          airportSn: ap,
          droneSn: dr,
          mqttDroneInDock: dockState,
        });
        if (cancelled) return;
        appendClientLogRef.current(
          `${new Date().toLocaleTimeString()} 无人机${reason}→拉流 ${parts.join(" · ")} → ${
            dockState === true ? "舱内/机场" : dockState === false ? "舱外/机体" : "未知优先机体"
          }`,
        );
      } catch (e) {
        if (cancelled) return;
        appendClientLogRef.current(
          `${new Date().toLocaleTimeString()} 无人机${reason} poke 失败：${
            e instanceof Error ? e.message : String(e)
          }，仍提交信令`,
        );
      }
      if (cancelled) return;
      uavPlayUrlCommittedRef.current = true;
      uavPlayUrlDockRef.current = dockState;
      setUavPlaySignalingUrl((prev) => (prev === nextUrl ? prev : nextUrl));
      setUavPlayLoading(false);
    };

    // —— 首次提交：等舱状态或超时 ——
    if (!uavPlayUrlCommittedRef.current) {
      if (mqttDroneInDock !== null) {
        void pokeThenCommit(mqttDroneInDock, "切流");
        return () => {
          cancelled = true;
        };
      }

      // 等待舱状态期间先双路 poke，缩短随后出画；SN 变化不重武装计时
      {
        const { airportSn: ap, droneSn: dr } = uavLiveSnRef.current;
        void pokeUavLiveStreamsForView({
          airportSn: ap,
          droneSn: dr,
          mqttDroneInDock: null,
        }).then(({ parts }) => {
          if (cancelled) return;
          appendClientLogRef.current(
            `${new Date().toLocaleTimeString()} 无人机切流预拉流(等舱状态) → ${parts.join(" · ")}`,
          );
        });
      }

      waitTimer = window.setTimeout(() => {
        waitTimer = null;
        if (cancelled || uavPlayUrlCommittedRef.current) return;
        void pokeThenCommit(mqttDroneInDockRef.current, "切流(舱状态超时)");
      }, UAV_MQTT_DOCK_WAIT_MS);

      return () => {
        cancelled = true;
        if (waitTimer != null) window.clearTimeout(waitTimer);
      };
    }

    // —— 已在播：仅舱内↔舱外切换时换源（null 抖动忽略）——
    if (mqttDroneInDock === null) {
      return () => {
        cancelled = true;
      };
    }
    if (uavPlayUrlDockRef.current === mqttDroneInDock) {
      return () => {
        cancelled = true;
      };
    }
    const prevDock = uavPlayUrlDockRef.current;
    if (prevDock === null) {
      const curUrl = pickUavPlaySignalingUrl(urls, null);
      const nextUrl = pickUavPlaySignalingUrl(urls, mqttDroneInDock);
      uavPlayUrlDockRef.current = mqttDroneInDock;
      if (curUrl === nextUrl) {
        return () => {
          cancelled = true;
        };
      }
      // 超时后才到的舱状态：如果视频已在出画（已出现过画面），则不换源（避免有画→黑→有画闪烁）
      const el = videoRef.current;
      if (el && el.videoWidth > 0 && el.videoHeight > 0) {
        // 不重连；下次手动重连或停帧恢复时才走正确路径
        return () => {
          cancelled = true;
        };
      }
      void pokeThenCommit(mqttDroneInDock, "舱状态晚到校正");
      return () => {
        cancelled = true;
      };
    }

    void pokeThenCommit(mqttDroneInDock, `舱状态→${mqttDroneInDock ? "舱内" : "舱外"}`);
    return () => {
      cancelled = true;
    };
  }, [
    activeStreamId,
    activeStream?.uav?.entityId,
    mqttDroneInDock,
    reuseSharedStream,
    uavUrlsEpoch,
  ]);

  useEffect(() => {
    const s = activeStream;
    if (preferSharedPlayback) {
      setCameraResolvedUrl(null);
      setCameraResolveLoading(false);
      setCameraResolveErr(null);
      return;
    }
    if (!s || s.uav) {
      setCameraResolvedUrl(null);
      setCameraResolveLoading(false);
      setCameraResolveErr(null);
      return;
    }
    const needDeferred =
      s.registrySource === "camera" ||
      (s.registrySource === "thirdPartyCamera" && s.playbackKind === "webrtc") ||
      (s.signalingUrl === "about:blank" && isCameraEntityId(s.id));
    if (!needDeferred) {
      setCameraResolvedUrl(null);
      setCameraResolveLoading(false);
      setCameraResolveErr(null);
      return;
    }
    if (s.signalingUrl && s.signalingUrl !== "about:blank") {
      setCameraResolvedUrl(s.signalingUrl);
      setCameraResolveLoading(false);
      setCameraResolveErr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setCameraResolveLoading(true);
      setCameraResolveErr(null);
      try {
        const p = await fetchEntityPlaybackAny(s.id);
        if (!cancelled) setCameraResolvedUrl(p.signalingUrl);
      } catch (e) {
        if (!cancelled) {
          setCameraResolvedUrl(null);
          setCameraResolveErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setCameraResolveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStream, activeStreamId, preferSharedPlayback]);

  const playSignalingUrl = (() => {
    if (preferSharedPlayback) return "shared://parent-media-stream";
    if (!activeStream) return "";
    if (activeStream.uav) return uavPlaySignalingUrl ?? "";
    if (cameraResolvedUrl) return cameraResolvedUrl;
    return activeStream.signalingUrl ?? "";
  })();

  /** 主窗：PC 已连通但无画/停帧 → 挂回轨 / kick（勿仅靠 videoWidth：冻帧仍可能 >0） */
  useEffect(() => {
    if (preferSharedPlayback || expandedMode) return;
    if (!playSignalingUrl?.trim() && !activeStream?.uav) return;
    let misses = 0;
    let lastDecoded: number | null = null;
    const id = window.setInterval(() => {
      void (async () => {
        if (Date.now() < playbackKickGraceUntilRef.current) {
          misses = 0;
          lastDecoded = null;
          return;
        }
        const v = videoRef.current;
        const pc = peerConnectionRef.current;
        if (!v || !pc) return;
        const ice = pc.iceConnectionState;
        const connected =
          pc.connectionState === "connected" || ice === "connected" || ice === "completed";
        if (!connected) {
          misses = 0;
          lastDecoded = null;
          return;
        }

        if (v.paused && v.srcObject) {
          void v.play().catch(() => {
            /* autoplay */
          });
        }

        let framesDecoded: number | null = null;
        try {
          const stats = await pc.getStats();
          for (const report of stats.values()) {
            if (report.type !== "inbound-rtp") continue;
            const rtp = report as RTCInboundRtpStreamStats;
            if (rtp.kind !== "video") continue;
            if (typeof rtp.framesDecoded === "number" && Number.isFinite(rtp.framesDecoded)) {
              framesDecoded = rtp.framesDecoded;
              break;
            }
          }
        } catch {
          /* ignore */
        }

        const hasPicture = v.videoWidth > 0 && v.videoHeight > 0;
        let progressing = false;
        if (framesDecoded != null) {
          if (lastDecoded == null) {
            /**
             * 首次测量：无法对比帧数增量，若已有画则视为正常（避免误判触发 reattach/kick）。
             */
            if (hasPicture) progressing = true;
          } else if (framesDecoded > lastDecoded) {
            progressing = true;
          }
          lastDecoded = framesDecoded;
        } else if (hasPicture) {
          progressing = true;
        }

        if (progressing && hasPicture) {
          misses = 0;
          return;
        }

        misses += 1;
        /**
         * 只在无画时才调 reattachVideoFromPeer：有画时调用会重设 srcObject，
         * 导致 1-2 帧黑屏闪烁（浏览器需重新绑定新 MediaStream）。
         */
        if (!hasPicture) {
          reattachVideoFromPeer(v, pc);
        }
        if (misses >= 2) {
          misses = 0;
          if (activeStream?.uav) {
            // 无人机：必须先 poke 再 kick；裸 kick 会连空流且与停帧恢复打架
            handleUavStallRecoverRef.current();
          } else {
            playbackKickGraceUntilRef.current = Date.now() + UAV_PLAYBACK_KICK_GRACE_MS;
            setDockPlaybackKick((k) => k + 1);
          }
        }
      })();
    }, 3000);
    return () => window.clearInterval(id);
  }, [
    preferSharedPlayback,
    expandedMode,
    playSignalingUrl,
    activeStream?.uav,
    activeStreamId,
  ]);

  const pipStreamLabel = useMemo(() => {
    if (!cfg || !pipStreamId) return "";
    return cfg.streams.find((s) => s.id === pipStreamId)?.label ?? pipStreamId;
  }, [cfg, pipStreamId]);

  const canUseStreamAsPip = useCallback(
    (stream: EoVideoStreamEntry | null | undefined) =>
      Boolean(
        stream &&
          stream.playbackKind !== "image" &&
          !(stream.registrySource === "thirdPartyCamera" && stream.playbackKind !== "webrtc"),
      ),
    [],
  );

  const resolvedPipCandidateId = useMemo(() => {
    if (!cfg?.streams.length) return "";
    const currentPip = cfg.streams.find((s) => s.id === pipStreamId.trim());
    if (canUseStreamAsPip(currentPip)) return currentPip?.id ?? "";
    const active = findStreamById(cfg.streams, activeStreamId.trim());
    if (canUseStreamAsPip(active)) return active?.id ?? "";
    const firstPlayable = cfg.streams.find((s) => canUseStreamAsPip(s));
    return firstPlayable?.id ?? "";
  }, [cfg, pipStreamId, activeStreamId, canUseStreamAsPip]);

  const togglePip = useCallback(() => {
    setPipOpen((was) => {
      const next = !was;
      if (next && resolvedPipCandidateId) setPipStreamId(resolvedPipCandidateId);
      return next;
    });
  }, [resolvedPipCandidateId]);

  useEffect(() => {
    if (!pipOpen || !resolvedPipCandidateId) return;
    if (pipStreamId.trim() === resolvedPipCandidateId) return;
    setPipStreamId(resolvedPipCandidateId);
  }, [pipOpen, pipStreamId, resolvedPipCandidateId]);

  const swapPipWithMain = useCallback(() => {
    if (!pipOpen) return;
    const main = activeStreamId.trim();
    const pip = pipStreamId.trim();
    if (!main) return;
    const pipEffective = pip || main;
    if (pipEffective === main) return;
    setActiveStreamId(pipEffective);
    setPipStreamId(main);
  }, [pipOpen, activeStreamId, pipStreamId]);

  const showEoPipFloatingPlayer = pipOpen && Boolean(activeStream) && !isThirdPartyUdpStream;

  useEffect(() => {
    if (!pipOpen || !cfg || !pipStreamId.trim() || isThirdPartyUdpStream) {
      setPipSignalingUrl("");
      setPipErr(null);
      setPipResolving(false);
      return;
    }
    const entry = cfg.streams.find((s) => s.id === pipStreamId);
    if (!entry) {
      setPipErr("未知视频流");
      setPipSignalingUrl("");
      setPipResolving(false);
      return;
    }
    let cancelled = false;
    setPipResolving(true);
    setPipErr(null);
    void (async () => {
      try {
        const url = await resolveEoPipPlaybackUrl(entry, {
          sameAsActiveMain: pipStreamId === activeStreamId,
          mainPlaySignalingUrl: playSignalingUrl,
          activeMainUavEntityId: activeStream?.uav?.entityId ?? null,
          mqttDroneInDock,
        });
        if (!cancelled) {
          setPipSignalingUrl(url);
          setPipErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPipSignalingUrl("");
          setPipErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setPipResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    pipOpen,
    cfg,
    pipStreamId,
    activeStreamId,
    playSignalingUrl,
    activeStream?.uav?.entityId,
    mqttDroneInDock,
    isThirdPartyUdpStream,
  ]);

  /**
   * 相机流地址解析中的遮罩。放大窗复用小窗轨时不解析 URL（preferSharedPlayback 会清空
   * cameraResolvedUrl），不得因此挡住画面/PTZ HUD——否则 registry 来的 camera_001 会灭 HUD，
   * 而 dock seed 的 camera_004（常无 registrySource）仍能显示。
   */
  const showCameraLoadingGate =
    !reuseSharedStream &&
    !isThirdPartyUdpStream &&
    !activeStream?.uav &&
    Boolean(activeStream) &&
    (activeStream?.registrySource === "camera" ||
      (activeStream?.registrySource === "thirdPartyCamera" && activeStream?.playbackKind === "webrtc") ||
      (activeStream?.signalingUrl === "about:blank" && activeStream?.id && isCameraEntityId(activeStream.id))) &&
    (cameraResolveLoading || !cameraResolvedUrl || cameraResolveErr);

  useEffect(() => {
    if (!activeStream?.uav || !playSignalingUrl) return;
    const line = `[uav-play-url] stream=${activeStream.id} label=${activeStream.label} mqttInDock=${
      mqttDroneInDock == null ? "null" : mqttDroneInDock ? "true" : "false"
    } url=${playSignalingUrl}`;
    if (uavPlayLoggedRef.current === line) return;
    uavPlayLoggedRef.current = line;
    setClientEcho((prev) => {
      const next = prev ? `${line}\n${prev}` : line;
      return next.length > 4000 ? next.slice(0, 4000) : next;
    });
  }, [activeStream?.uav, activeStream?.id, activeStream?.label, mqttDroneInDock, playSignalingUrl]);

  useEffect(() => {
    if (!activeStream?.uav || !uavResolveDebug) return;
    const line = `[uav-resolve] ${uavResolveDebug}`;
    if (uavDebugLoggedRef.current === line) return;
    uavDebugLoggedRef.current = line;
    setClientEcho((prev) => {
      const next = prev ? `${line}\n${prev}` : line;
      return next.length > 4000 ? next.slice(0, 4000) : next;
    });
    }, [activeStream?.uav, uavResolveDebug]);

  const onSelectStream = useCallback((id: string) => {
    userPickedStreamRef.current = true;
    setActiveStreamId(id);
  }, []);

  const smartWindowEnabled = useEoVideoSmartWindowStore(
    (s) => (dockPidNorm ? (s.enabledByPanelId[dockPidNorm] ?? false) : false),
  );
  useEoVideoSmartWindow({
    panelId: dockPidNorm,
    enabled: smartWindowEnabled,
    cfg,
    activeStreamId,
    onSelectStream,
    pageEntity: entity,
  });

  /** ref 供 restoreDockVideoAfterZoom 读取最新的 activeStream（避免 callback 闭包过期） */
  const activeStreamRef = useRef(activeStream);
  activeStreamRef.current = activeStream;

  const restoreDockVideoAfterZoom = useCallback(() => {
    window.setTimeout(() => {
      const v = videoRef.current;
      const pc = peerConnectionRef.current;
      const ok = reattachVideoFromPeer(v, pc);
      if (ok && v && v.videoWidth > 0 && v.videoHeight > 0) return;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) return;
      if (activeStreamRef.current?.uav) {
        // UAV：直接 kick 会连空流导致长时间黑屏；必须 poke 先恢复推流
        handleUavStallRecoverRef.current();
      } else {
        playbackKickGraceUntilRef.current = Date.now() + UAV_PLAYBACK_KICK_GRACE_MS;
        setDockPlaybackKick((k) => k + 1);
      }
    }, 200);
  }, []);

  const toggleExpand = useCallback(() => {
    if (onToggleExpand) {
      onToggleExpand();
      return;
    }
    setZoomWindowOpen((was) => {
      const next = !was;
      if (!next) {
        restoreDockVideoAfterZoom();
      }
      return next;
    });
  }, [onToggleExpand, restoreDockVideoAfterZoom]);

  const onSaveTaskBackendBaseUrl = useCallback((url: string) => {
    const next = url.trim() || "http://192.168.18.141:8088";
    setTaskBackendBaseUrl(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TASK_BACKEND_BASE_KEY, next);
    }
  }, []);

  const onSaveCapturePaths = useCallback((snapshotPath: string, recordPath: string) => {
    const s = snapshotPath.trim();
    const r = recordPath.trim();
    setSnapshotSavePath(s);
    setRecordSavePath(r);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SNAPSHOT_PATH_KEY, s);
      window.localStorage.setItem(RECORD_PATH_KEY, r);
    }
  }, []);

  const appendClientLog = useCallback((line: string) => {
    setClientEcho((prev) => {
      const next = prev ? `${line}\n${prev}` : line;
      return next.length > 4000 ? next.slice(0, 4000) : next;
    });
  }, []);
  appendClientLogRef.current = appendClientLog;

  const [calcRecordLocationOpen, setCalcRecordLocationOpen] = useState(false);
  const [pidSettingsOpen, setPidSettingsOpen] = useState(false);
  const calcRecord = useEoCalcRecordController({
    entityId: detectionEntityId,
    cameraName: activeStream?.label ?? detectionEntityId ?? "相机",
    detectionBoxes,
    videoRef,
    snapshotCanvasRef,
    onClientLog: appendClientLog,
  });

  const handleThirdPartyCamKindSelect = useCallback(
    async (kind: ThirdPartyCamTaskKind) => {
      const sid = activeStream?.id?.trim();
      if (!sid) return;
      setThirdPartyCamBusy(true);
      try {
        const res = await postThirdPartyCamTask({
          entityId: sid,
          backendBaseUrl: taskBackendBaseUrl,
          taskKind: kind,
        });
        const text = await res.text().catch(() => "");
        const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
        if (!outcome.accepted) {
          appendClientLog(
            `${new Date().toLocaleTimeString()} 第三方任务「${kind}」未受理 ${outcome.logLine}`,
          );
          toast.error(outcome.logLine.length > 220 ? `${outcome.logLine.slice(0, 220)}…` : outcome.logLine);
          return;
        }
        appendClientLog(
          `${new Date().toLocaleTimeString()} 第三方任务「${kind}」已受理 ${outcome.logLine}`,
        );
        toast.success(`已下发「${kind}」`, { description: outcome.logLine });
      } catch (e) {
        appendClientLog(
          `${new Date().toLocaleTimeString()} 第三方任务异常：${e instanceof Error ? e.message : String(e)}`,
        );
        toast.error("第三方相机任务请求失败");
      } finally {
        setThirdPartyCamBusy(false);
      }
    },
    [activeStream?.id, appendClientLog, taskBackendBaseUrl],
  );

  const scheduleUavWebRtcKick = useCallback(
    (
      delayMs = UAV_WEBRTC_KICK_AFTER_START_MS,
      opts?: {
        /** 延迟到期时若已出画则取消 kick，避免「已有画又被拆」闪黑 */
        onlyIfBlack?: boolean;
      },
    ) => {
      if (uavWebRtcKickTimerRef.current != null) {
        window.clearTimeout(uavWebRtcKickTimerRef.current);
      }
      const onlyIfBlack = opts?.onlyIfBlack === true;
      uavWebRtcKickTimerRef.current = window.setTimeout(() => {
        uavWebRtcKickTimerRef.current = null;
        if (onlyIfBlack) {
          const el = videoRef.current;
          if (el && el.videoWidth > 0 && el.videoHeight > 0) return;
        }
        playbackKickGraceUntilRef.current = Date.now() + UAV_PLAYBACK_KICK_GRACE_MS;
        setUavWebRtcKick((k) => k + 1);
      }, delayMs);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (uavWebRtcKickTimerRef.current != null) {
        window.clearTimeout(uavWebRtcKickTimerRef.current);
        uavWebRtcKickTimerRef.current = null;
      }
    };
  }, []);

  /** 供无人机停帧看门狗恢复时读取当前 SN（避免 useCallback 闭包过期） */
  const uavStallPokeArgsRef = useRef<{ airportSn: string; droneSn: string }>({
    airportSn: "",
    droneSn: "",
  });
  uavStallPokeArgsRef.current = {
    airportSn: (mqttAirportSn ?? uavMqttProductIds?.airport ?? activeStream?.uav?.airportSN ?? "").trim(),
    droneSn: (mqttDeviceSn ?? uavMqttProductIds?.device ?? activeStream?.uav?.deviceSN ?? "").trim(),
  };

  /**
   * 无人机停帧 / MQTT 恢复：ZLM 常已停推，纯 WebRTC restart 会连空流仍黑。
   * 先 poke 再延迟 kick；由 scheduleUavWebRtcKick 负责重建（useWebRtcPlayer 不再立刻 restart）。
   */
  const handleUavStallRecover = useCallback(() => {
    const { airportSn, droneSn } = uavStallPokeArgsRef.current;
    if (!airportSn && !droneSn) {
      scheduleUavWebRtcKick(0);
      return;
    }
    void (async () => {
      try {
        const { parts } = await pokeUavLiveStreamsForView({
          airportSn,
          droneSn,
          mqttDroneInDock: mqttDroneInDockRef.current,
        });
        appendClientLog(
          `${new Date().toLocaleTimeString()} 无人机停帧恢复→重新拉流 ${parts.join(" · ")}`,
        );
      } catch {
        /* poke 失败仍 kick，避免卡死 */
      }
      scheduleUavWebRtcKick();
    })();
  }, [appendClientLog, scheduleUavWebRtcKick]);
  handleUavStallRecoverRef.current = handleUavStallRecover;

  /**
   * 信令已提交且已 poke：仅在仍黑时补 poke+kick（onlyIfBlack，避免出画后误踢）。
   */
  useEffect(() => {
    if (reuseSharedStream) return;
    if (!activeStream?.uav) return;
    if (!uavPlaySignalingUrl?.trim()) return;
    if (uavPlayLoading) return;
    if (uavPlayErr) return;

    const uv = activeStream.uav;
    let attempts = 0;
    let cancelled = false;
    const startedAt = Date.now();

    const hasPicture = () => {
      const el = videoRef.current;
      return Boolean(el && el.videoWidth > 0 && el.videoHeight > 0);
    };

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      if (hasPicture()) return;
      if (Date.now() - startedAt < UAV_LIVE_STREAM_PICTURE_GRACE_MS) return;
      if (attempts >= UAV_LIVE_STREAM_MAX_RETRIES) return;
      attempts += 1;
      const ap = (mqttAirportSn ?? uavMqttProductIds?.airport ?? uv.airportSN ?? "").trim();
      const dr = (mqttDeviceSn ?? uavMqttProductIds?.device ?? uv.deviceSN ?? "").trim();
      void (async () => {
        try {
          const { parts } = await pokeUavLiveStreamsForView({
            airportSn: ap,
            droneSn: dr,
            mqttDroneInDock: mqttDroneInDockRef.current,
          });
          if (cancelled) return;
          appendClientLog(
            `${new Date().toLocaleTimeString()} 无人机黑屏重试拉流(${attempts}/${UAV_LIVE_STREAM_MAX_RETRIES}) → ${parts.join(" · ")}`,
          );
        } catch {
          if (cancelled) return;
        }
        if (cancelled) return;
        scheduleUavWebRtcKick(UAV_WEBRTC_KICK_AFTER_START_MS, { onlyIfBlack: true });
      })();
    }, UAV_LIVE_STREAM_RETRY_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeStream,
    activeStreamId,
    appendClientLog,
    mqttAirportSn,
    mqttDeviceSn,
    scheduleUavWebRtcKick,
    uavMqttProductIds?.airport,
    uavMqttProductIds?.device,
    uavPlayErr,
    uavPlayLoading,
    uavPlaySignalingUrl,
    reuseSharedStream,
  ]);

  /**
   * 夜间 MQTT 例行断线再连：库会恢复遥测，但私有云推流常已停，画面不会自己回来。
   * 断线满一段时间后再连上时，自动走与「重连」相同的 poke+kick。
   */
  const mqttConnectedPrevRef = useRef<boolean | null>(null);
  const mqttDownSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (reuseSharedStream || !activeStream?.uav) {
      mqttConnectedPrevRef.current = mqttConnected;
      mqttDownSinceRef.current = null;
      return;
    }
    const prev = mqttConnectedPrevRef.current;
    mqttConnectedPrevRef.current = mqttConnected;

    if (!mqttConnected) {
      if (prev === true) {
        mqttDownSinceRef.current = Date.now();
      } else if (mqttDownSinceRef.current == null && prev !== null) {
        mqttDownSinceRef.current = Date.now();
      }
      return;
    }

    // connected
    const downSince = mqttDownSinceRef.current;
    mqttDownSinceRef.current = null;
    if (prev !== false) return; // 仅 false→true
    if (downSince == null || Date.now() - downSince < UAV_MQTT_DOWN_RECOVER_MIN_MS) return;
    if (!uavPlaySignalingUrl?.trim() || uavPlayLoading || uavPlayErr) return;

    appendClientLog(
      `${new Date().toLocaleTimeString()} MQTT 重连→自动恢复无人机画面（断线 ${Math.round((Date.now() - downSince) / 1000)}s）`,
    );
    handleUavStallRecoverRef.current();
  }, [
    activeStream?.uav,
    appendClientLog,
    mqttConnected,
    reuseSharedStream,
    uavPlayErr,
    uavPlayLoading,
    uavPlaySignalingUrl,
  ]);

  const onEoCaptureReadyChange = useCallback((ready: boolean) => {
    setCaptureReady(ready);
  }, []);

  const showUavBottomFeedback = useCallback((line: string, tone: "success" | "error" | "warn" = "success") => {
    setUavBottomFeedback({ text: line, tone });
    if (uavBottomFeedbackTimerRef.current != null) {
      window.clearTimeout(uavBottomFeedbackTimerRef.current);
    }
    uavBottomFeedbackTimerRef.current = window.setTimeout(() => {
      setUavBottomFeedback(null);
      uavBottomFeedbackTimerRef.current = null;
    }, 2600);
  }, []);

  /** 必须稳定：PlayStage 在 taskHint 变化时会调 toast；内联 lambda 会导致每帧新引用 → 无限 setState 崩页 */
  const onUavBottomCenterToast = useCallback(
    (payload: { text: string; tone?: "success" | "error" | "warn" }) => {
      showUavBottomFeedback(payload.text, payload.tone ?? "success");
    },
    [showUavBottomFeedback],
  );

  /**
   * 对齐 `PtzMainWidget::onUavCamCtrl`：`GIMBAL_RESET_URL`、cmd=`gimbal_reset`，
   * `device_sn` 用机场 SN（C++ `m_droneSNAndAirportSNMap[..].back()`），`reset_mode` 0/1。
   */
  const onUavGimbalCenter = useCallback(async () => {
    const ap = (mqttAirportSn ?? "").trim();
    const dr = (mqttDeviceSn ?? activeStream?.uav?.deviceSN ?? "").trim();
    if (!ap) {
      showUavBottomFeedback("缺少机场 SN，无法发云台指令", "warn");
      return;
    }
    try {
      const ret = await postUavGimbalReset({
        deviceSn: ap,
        payloadIndex: uavMainPayloadIndexForDrone(dr),
        resetMode: 0,
      });
      if (ret.ok) {
        showUavBottomFeedback("云台回中已下发", "success");
      } else {
        const hint = (ret.message && ret.message !== "success" ? ret.message : null) ?? ret.error ?? ret.detail ?? "失败";
        showUavBottomFeedback(String(hint).slice(0, 120), "error");
      }
      appendClientLog(`[云台回中] reset_mode=0 payload=${uavMainPayloadIndexForDrone(dr)} ${JSON.stringify(ret).slice(0, 500)}`);
    } catch (e) {
      showUavBottomFeedback(e instanceof Error ? e.message : "云台回中异常", "error");
    }
  }, [activeStream?.uav?.deviceSN, appendClientLog, mqttAirportSn, mqttDeviceSn, showUavBottomFeedback]);

  const onUavGimbalDown = useCallback(async () => {
    const ap = (mqttAirportSn ?? "").trim();
    const dr = (mqttDeviceSn ?? activeStream?.uav?.deviceSN ?? "").trim();
    if (!ap) {
      showUavBottomFeedback("缺少机场 SN，无法发云台指令", "warn");
      return;
    }
    try {
      const ret = await postUavGimbalReset({
        deviceSn: ap,
        payloadIndex: uavMainPayloadIndexForDrone(dr),
        resetMode: 1,
      });
      if (ret.ok) {
        showUavBottomFeedback("云台向下已下发", "success");
      } else {
        const hint = (ret.message && ret.message !== "success" ? ret.message : null) ?? ret.error ?? ret.detail ?? "失败";
        showUavBottomFeedback(String(hint).slice(0, 120), "error");
      }
      appendClientLog(`[云台向下] reset_mode=1 payload=${uavMainPayloadIndexForDrone(dr)} ${JSON.stringify(ret).slice(0, 500)}`);
    } catch (e) {
      showUavBottomFeedback(e instanceof Error ? e.message : "云台向下异常", "error");
    }
  }, [activeStream?.uav?.deviceSN, appendClientLog, mqttAirportSn, mqttDeviceSn, showUavBottomFeedback]);

  const showCameraBottomFeedback = useCallback(
    (payload: { text: string; tone?: "success" | "error" | "warn" }) => {
      const tone = payload.tone ?? "success";
      setCameraBottomFeedback({ text: payload.text, tone });
      if (cameraBottomFeedbackTimerRef.current != null) {
        window.clearTimeout(cameraBottomFeedbackTimerRef.current);
      }
      cameraBottomFeedbackTimerRef.current = window.setTimeout(() => {
        setCameraBottomFeedback(null);
        cameraBottomFeedbackTimerRef.current = null;
      }, 3000);
    },
    [],
  );

  /** 右侧工具「重连」：无人机 poke+kick；相机 WebRTC kick；第三方 UDP 强制重连 WS */
  const handleReconnectStream = useCallback(() => {
    if (reconnectStreamBusyRef.current) return;
    if (reuseSharedStream) {
      const msg = "当前为复用主窗画面，请在主窗点重连";
      appendClientLog(`${new Date().toLocaleTimeString()} ${msg}`);
      if (activeStream?.uav) showUavBottomFeedback(msg, "warn");
      else showCameraBottomFeedback({ text: msg, tone: "warn" });
      return;
    }

    reconnectStreamBusyRef.current = true;
    setReconnectStreamBusy(true);

    void (async () => {
      try {
        if (activeStream?.uav) {
          const { airportSn, droneSn } = uavStallPokeArgsRef.current;
          if (!airportSn && !droneSn) {
            showUavBottomFeedback("无法重连：缺少机场/机体 SN", "error");
            appendClientLog(`${new Date().toLocaleTimeString()} 手动重连失败：缺少 SN`);
            return;
          }
          showUavBottomFeedback("正在重新拉流…", "warn");
          try {
            const { parts } = await pokeUavLiveStreamsForView({
              airportSn,
              droneSn,
              mqttDroneInDock: mqttDroneInDockRef.current,
            });
            appendClientLog(
              `${new Date().toLocaleTimeString()} 手动重连→重新拉流 ${parts.join(" · ")}`,
            );
            showUavBottomFeedback("已申请重新拉流", "success");
          } catch (e) {
            appendClientLog(
              `${new Date().toLocaleTimeString()} 手动重连 poke 失败：${e instanceof Error ? e.message : String(e)}`,
            );
            showUavBottomFeedback("拉流申请失败，仍尝试重连 WebRTC", "warn");
          }
          scheduleUavWebRtcKick();
          return;
        }

        if (isThirdPartyUdpStream) {
          forceReconnectThirdPartyCameraWsHub();
          appendClientLog(`${new Date().toLocaleTimeString()} 手动重连→第三方相机 WS`);
          showCameraBottomFeedback({ text: "已重连第三方相机流", tone: "success" });
          return;
        }

        // 相机：先软挂回轨（PC 多半仍连通，仅 <video> 掉画），出画则不动流；
        // 短暂仍黑再硬重拉，并给看门狗宽限，避免出画前被连环 kick 拆成持续黑屏。
        reattachVideoFromPeer(videoRef.current, peerConnectionRef.current);
        if (videoRef.current?.srcObject) {
          void videoRef.current.play().catch(() => {
            /* autoplay */
          });
        }
        await new Promise((r) => window.setTimeout(r, 600));
        const healed = Boolean(
          videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0,
        );
        if (healed) {
          appendClientLog(`${new Date().toLocaleTimeString()} 手动重连→软挂回轨已恢复画面`);
          showCameraBottomFeedback({ text: "已恢复画面", tone: "success" });
          return;
        }

        playbackKickGraceUntilRef.current = Date.now() + 12_000;
        setDockPlaybackKick((k) => k + 1);
        appendClientLog(`${new Date().toLocaleTimeString()} 手动重连→软恢复无效，重建 WebRTC`);
        showCameraBottomFeedback({ text: "已重新拉流", tone: "success" });
      } finally {
        window.setTimeout(() => {
          reconnectStreamBusyRef.current = false;
          setReconnectStreamBusy(false);
        }, 700);
      }
    })();
  }, [
    activeStream?.uav,
    appendClientLog,
    isThirdPartyUdpStream,
    reuseSharedStream,
    scheduleUavWebRtcKick,
    showCameraBottomFeedback,
    showUavBottomFeedback,
  ]);

  const aimTrackCollect = useEoAimTrackCollect({
    entityId: detectionEntityId,
    detectionBoxes,
    onBottomFeedback: showCameraBottomFeedback,
  });

  const burnInHideOverlay = useEoBurnInOverlayStore((s) =>
    selectBurnInHideOverlay(s, detectionEntityId),
  );
  const [burnInHideOverlayBusy, setBurnInHideOverlayBusy] = useState(false);

  useEffect(() => {
    const id = (detectionEntityId ?? "").trim().toLowerCase();
    if (!id || !/^camera_\d{3}$/.test(id) || isThirdPartyUdpStream) return;
    let cancelled = false;
    void fetchEoBurnInOverlay({ entityId: id, backendBaseUrl: taskBackendBaseUrl }).then((r) => {
      if (cancelled || !r.ok) return;
      useEoBurnInOverlayStore.getState().setHideOverlay(id, !!r.hideOverlay);
    });
    return () => {
      cancelled = true;
    };
  }, [detectionEntityId, taskBackendBaseUrl, isThirdPartyUdpStream]);

  const handleToggleBurnInHideOverlay = useCallback(async () => {
    const id = (detectionEntityId ?? "").trim().toLowerCase();
    if (!id || !/^camera_\d{3}$/.test(id)) return;
    const next = !burnInHideOverlay;
    setBurnInHideOverlayBusy(true);
    useEoBurnInOverlayStore.getState().setHideOverlay(id, next);
    try {
      const r = await postEoBurnInOverlay({
        entityId: id,
        hideOverlay: next,
        backendBaseUrl: taskBackendBaseUrl,
      });
      if (!r.ok) {
        useEoBurnInOverlayStore.getState().setHideOverlay(id, !next);
        showCameraBottomFeedback({
          text: `隐藏烧录框失败：${r.error ?? "unknown"}${r.detail ? ` · ${r.detail}` : ""}`,
          tone: "error",
        });
        return;
      }
      useEoBurnInOverlayStore.getState().setHideOverlay(id, !!r.hideOverlay);
      showCameraBottomFeedback({
        text: r.hideOverlay ? "已隐藏烧录检测框与航迹ID（多端同步）" : "已恢复烧录检测框绘制",
        tone: "success",
      });
    } catch (e) {
      useEoBurnInOverlayStore.getState().setHideOverlay(id, !next);
      showCameraBottomFeedback({
        text: `隐藏烧录框失败：${e instanceof Error ? e.message : String(e)}`,
        tone: "error",
      });
    } finally {
      setBurnInHideOverlayBusy(false);
    }
  }, [burnInHideOverlay, detectionEntityId, showCameraBottomFeedback, taskBackendBaseUrl]);

  const [aimUpdateSupported, setAimUpdateSupported] = useState(false);
  const [aimUpdateBusy, setAimUpdateBusy] = useState(false);

  useEffect(() => {
    const id = cameraDdsEntityId?.trim() ?? "";
    if (!id || isThirdPartyUdpStream) {
      setAimUpdateSupported(false);
      return;
    }
    let cancelled = false;
    const apply = () => {
      const row = getEntitiesTrackTaskCacheRow(id);
      setAimUpdateSupported(Boolean(row && isTrackTaskOwnerRowAllowed(row)));
    };
    apply();
    void ensureEntitiesTrackTaskCache().then(() => {
      if (!cancelled) apply();
    });
    return () => {
      cancelled = true;
    };
  }, [cameraDdsEntityId, isThirdPartyUdpStream]);

  const handleAimUpdate = useCallback(async () => {
    const id = cameraDdsEntityId?.trim();
    if (!id || aimUpdateBusy) return;
    setAimUpdateBusy(true);
    try {
      const { res, data } = await postEoAimUpdate({
        entityId: id,
        backendBaseUrl: taskBackendBaseUrl,
      });
      const lines = (data.results ?? []).map((r) => {
        const kind = r.aimType === 1 ? "对空" : "对海";
        if (r.ok) {
          const extra =
            r.aimType === 1
              ? ` skyParamT=${(r.skyParamT ?? "").slice(0, 40)}…`
              : ` 段数=${r.seamParamCount ?? 0}`;
          return `${kind}成功 → ${r.path ?? ""}${extra}`;
        }
        return `${kind}失败: ${r.detail ?? r.message ?? r.error ?? "unknown"}`;
      });
      const summary = lines.length > 0 ? lines.join("；") : data.detail ?? data.error ?? `HTTP ${res.status}`;
      if (res.ok && data.ok) {
        toast.success("对准参数已写入正式配置并热更新", { description: summary.slice(0, 280) });
        appendClientLog(`${new Date().toLocaleTimeString()} 更新对准参数：${summary}`);
      } else {
        toast.error("更新对准参数失败", { description: summary.slice(0, 280) });
        appendClientLog(`${new Date().toLocaleTimeString()} 更新对准参数失败：${summary}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("更新对准参数异常", { description: msg });
      appendClientLog(`${new Date().toLocaleTimeString()} 更新对准参数异常：${msg}`);
    } finally {
      setAimUpdateBusy(false);
    }
  }, [aimUpdateBusy, appendClientLog, cameraDdsEntityId, taskBackendBaseUrl]);

  useEffect(() => {
    return () => {
      if (uavBottomFeedbackTimerRef.current != null) {
        window.clearTimeout(uavBottomFeedbackTimerRef.current);
        uavBottomFeedbackTimerRef.current = null;
      }
      if (cameraBottomFeedbackTimerRef.current != null) {
        window.clearTimeout(cameraBottomFeedbackTimerRef.current);
        cameraBottomFeedbackTimerRef.current = null;
      }
    };
  }, []);

  const triggerUavAction = useCallback(
    async (action: UavControlAction): Promise<boolean> => {
      if (action === "reconnect") {
        handleReconnectStream();
        return true;
      }
      if (!mqttAirportSn) {
        appendClientLog(`${new Date().toLocaleTimeString()} 无法执行 ${action}：缺少 airportSN`);
        return false;
      }
      if (action === "takeoff" && !mqttAirportLatLon) {
        appendClientLog(
          `${new Date().toLocaleTimeString()} 无法起飞：尚未从 MQTT 解析到机场经纬（请确认已订阅 thing/product/{SN}/state|osd 且报文含 data.latitude/longitude）`,
        );
        return false;
      }
      setUavActionBusy((prev) => ({ ...prev, [action]: true }));
      try {
        const ret = await postUavControlAction({
          action,
          airportSN: mqttAirportSn,
          deviceSN: mqttDeviceSn,
          ...(action === "takeoff" && mqttAirportLatLon
            ? {
                takeoffTarget: {
                  latitude: mqttAirportLatLon.latitude,
                  longitude: mqttAirportLatLon.longitude,
                },
              }
            : {}),
        });
        if (!isUavControlEffectivelyOk(ret)) {
          appendClientLog(`${new Date().toLocaleTimeString()} 无人机控制 ${action} 失败`);
          showUavBottomFeedback(`控制失败：${uavActionFeedbackLabel(action)}`, "error");
          return false;
        }
        const taskLine = ret.viaTaskCancel
          ? `任务取消=${ret.viaTaskCancel.ok ? "OK" : `FAIL(${ret.viaTaskCancel.status})`}(${ret.viaTaskCancel.url || "—"})`
          : "";
        const httpLine = ret.viaHttp
          ? `HTTP=${ret.viaHttp.ok ? "OK" : `FAIL(${ret.viaHttp.status})`}`
          : "HTTP=NA";
        const mqttLine =
          ret.viaMqtt == null
            ? "MQTT=NA"
            : ret.viaMqtt.ok
              ? "MQTT=OK"
              : ret.viaMqtt.detail === "no_mqtt_topic_configured"
                ? "MQTT=—(未配 topic；热备/返航等可与 WatchSys 相同仅走 HTTP)"
                : `MQTT=SKIP(${ret.viaMqtt.detail})`;
        const parts = [
          `${new Date().toLocaleTimeString()} 无人机控制 ${action} 已发送`,
          taskLine,
          httpLine,
          mqttLine,
        ].filter(Boolean);
        appendClientLog(parts.join(" · "));
        showUavBottomFeedback(`${uavActionFeedbackLabel(action)} 指令已发送`, "success");
        return true;
      } catch (e) {
        appendClientLog(
          `${new Date().toLocaleTimeString()} 无人机控制 ${action} 异常：${e instanceof Error ? e.message : String(e)}`,
        );
        showUavBottomFeedback(`${uavActionFeedbackLabel(action)} 异常`, "error");
        return false;
      } finally {
        setUavActionBusy((prev) => ({ ...prev, [action]: false }));
      }
    },
    [appendClientLog, handleReconnectStream, mqttAirportLatLon, mqttAirportSn, mqttDeviceSn, showUavBottomFeedback],
  );

  /** 智能助手 uav_return_to_base / uav_emergency_stop：仅当前焦点且播放 UAV 的光电窗接线 */
  useEffect(() => {
    const pid = dockPidNorm;
    if (!pid || eoFocusedDockId !== pid || !activeStream?.uav) return;

    registerLangGraphUavCommandHandler(pid, triggerUavAction);
    return () => unregisterLangGraphUavCommandHandler(pid);
  }, [dockPidNorm, eoFocusedDockId, activeStream?.uav, triggerUavAction]);

  // 无人机控制授权（对应 C++ UAV_CTRL_CONNECT → enter → exit 三步骤）
  const toggleUavAuth = useCallback(async () => {
    if (!mqttAirportSn) {
      appendClientLog(`${new Date().toLocaleTimeString()} 无法授权：缺少 airportSN`);
      return;
    }
    
    if (uavCtrlAuth.busy) return;
    setUavCtrlAuth((prev) => ({ ...prev, busy: true }));

    try {
      if (uavCtrlAuth.hasAuth) {
        // 退出控制
        const clientId = uavCtrlAuth.ctrlInfo?.client_id;
        if (!clientId) {
          appendClientLog(`${new Date().toLocaleTimeString()} 退出控制失败：缺少 client_id`);
          return;
        }
        const ret = await postUavAuth("exit", mqttAirportSn, clientId);
        if (ret.ok) {
          void stopUavDrcHeartBeat(mqttAirportSn);
          setUavCtrlAuth({ hasAuth: false, ctrlInfo: null, busy: false });
          appendClientLog(`${new Date().toLocaleTimeString()} 退出无人机控制成功`);
          showUavBottomFeedback("退出控制成功", "success");
        } else {
          setUavCtrlAuth((prev) => ({ ...prev, busy: false }));
          appendClientLog(`${new Date().toLocaleTimeString()} 退出无人机控制失败：${ret.message || ret.detail}`);
          showUavBottomFeedback("退出控制失败", "error");
        }
      } else {
        // 获取控制权
        const connRet = await postUavAuth("connect", mqttAirportSn);
        if (!connRet.ok || !connRet.ctrlInfo) {
          appendClientLog(`${new Date().toLocaleTimeString()} 请求控制权失败：${connRet.message || connRet.detail}`);
          showUavBottomFeedback("请求控制权失败", "error");
          setUavCtrlAuth((prev) => ({ ...prev, busy: false }));
          return;
        }

        const enterRet = await postUavAuth("enter", mqttAirportSn, connRet.ctrlInfo.client_id);
        if (enterRet.ok) {
          void startUavDrcHeartBeat(mqttAirportSn);
          setUavCtrlAuth({ hasAuth: true, ctrlInfo: connRet.ctrlInfo, busy: false });
          appendClientLog(`${new Date().toLocaleTimeString()} 请求控制权限成功`);
          showUavBottomFeedback("请求控制权限成功", "success");
        } else {
          appendClientLog(`${new Date().toLocaleTimeString()} 请求控制权限失败：${enterRet.message || enterRet.detail || "无人机未启动"}`);
          showUavBottomFeedback("请求控制权限失败", "error");
          setUavCtrlAuth((prev) => ({ ...prev, busy: false }));
        }
      }
    } catch (e) {
      appendClientLog(`${new Date().toLocaleTimeString()} 授权异常：${e instanceof Error ? e.message : String(e)}`);
      showUavBottomFeedback("授权异常", "error");
      setUavCtrlAuth((prev) => ({ ...prev, busy: false }));
    }
  }, [mqttAirportSn, uavCtrlAuth, appendClientLog, showUavBottomFeedback]);

  /** 默认 dock 窗口：仅当前选中的光电面板响应 WASDQEZC；经典主窗固定放大时等同独立放大窗 */
  const uavKeyboardEnabled = Boolean(
    activeStream?.uav && (!dockPidNorm || eoPanelSelected || classicFixedExpanded),
  );

  const onUavKeyboardControlStart = useCallback(() => {
    const tid = uavTrackTaskId?.trim();
    if (!tid) return;
    void postUavTaskStop({ taskIds: [tid] })
      .then(() => setUavTrackTaskId(null))
      .catch(() => {
        /* 与 C++ SendUavStopTask 对齐；失败不阻断手控 */
      });
  }, [uavTrackTaskId]);

  // 键盘手控（对应 C++ ptzmainwidget keyPressEvent/keyReleaseEvent + mainwindow slot_onUavStartCtrl）
  const { keyState, isControlling, drcDebugLine } = useUavKeyboardControl({
    enabled: uavKeyboardEnabled,
    airportSN: mqttAirportSn,
    hasAuth: uavCtrlAuth.hasAuth,
    mqttRxConnected: mqttConnected,
    pollDrcStatus: uavExpandedDebugOpen || uavCtrlAuth.hasAuth,
    onControlStart: onUavKeyboardControlStart,
    onLog: appendClientLog,
    onNeedAuth: () => {
      appendClientLog(`${new Date().toLocaleTimeString()} 请先获取无人机控制权`);
      showUavBottomFeedback("请先获取无人机控制权", "warn");
    },
  });

  /** 与 `PtzMainWidget::UavAimAt5`：`device_sn` 机场 SN，`payload_index` 舱内/舱外与当前主摄流一致；仅舱外 aim */
  const uavCameraAimUi = useMemo(() => {
    if (!activeStream?.uav) return null;
    const ap = (mqttAirportSn ?? activeStream.uav.airportSN ?? "").trim();
    if (!ap) return null;
    const dr = (mqttDeviceSn ?? activeStream.uav.deviceSN ?? "").trim();
    const mainPayload = dr === "1581F6QAD241200BWX4E" ? DRONE_MAIN_PAYLOAD_SPECIAL : DRONE_MAIN_PAYLOAD;
    return {
      airportDeviceSn: ap,
      payloadIndex: mqttDroneInDock === false ? mainPayload : AIRPORT_FPV_PAYLOAD,
      allowAim: mqttDroneInDock === false,
      hasControlAuth: uavCtrlAuth.hasAuth,
    };
  }, [
    activeStream?.uav,
    activeStream?.uav?.airportSN,
    activeStream?.uav?.deviceSN,
    mqttAirportSn,
    mqttDeviceSn,
    mqttDroneInDock,
    uavCtrlAuth.hasAuth,
  ]);

  const onResizeStripPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) return;
      e.preventDefault();
      const el = panelRootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      resizeStartRef.current = { y: e.clientY, h: r.height };
      resizePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [resizable],
  );

  useEffect(() => {
    if (!resizable) return;
    const onMove = (ev: PointerEvent) => {
      if (resizePointerIdRef.current == null || ev.pointerId !== resizePointerIdRef.current) return;
      const dy = ev.clientY - resizeStartRef.current.y;
      const next = Math.round(resizeStartRef.current.h + dy);
      setPanelHeightPx(Math.min(920, Math.max(200, next)));
    };
    const onEnd = (ev: PointerEvent) => {
      if (resizePointerIdRef.current === ev.pointerId) resizePointerIdRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [resizable]);

  const handlePickCaptureLocalFolder = useCallback(async () => {
    if (!isShowDirectoryPickerSupported()) {
      appendClientLog(`${new Date().toLocaleTimeString()} 当前浏览器不支持选择本机文件夹（请使用 Chrome / Edge 等 Chromium 内核浏览器）`);
      return;
    }
    try {
      const dir = await pickCaptureDirectoryHandle("snapshot");
      await saveCaptureDirHandle(dir, "snapshot");
      captureDirHandleSnapshotRef.current = dir;
      setCaptureFolderLabel(dir.name);
      appendClientLog(`${new Date().toLocaleTimeString()} 已绑定本机保存文件夹「${dir.name}」，截图/录屏将直接写入该目录`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      appendClientLog(`${new Date().toLocaleTimeString()} 选择文件夹失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [appendClientLog]);

  const handleClearCaptureLocalFolder = useCallback(async () => {
    await clearCaptureDirHandle();
    captureDirHandleSnapshotRef.current = null;
    captureDirHandleRecordRef.current = null;
    setCaptureFolderLabel("");
    appendClientLog(`${new Date().toLocaleTimeString()} 已清除本机保存文件夹绑定（将改回浏览器下载）`);
  }, [appendClientLog]);

  const resolvePerStreamCaptureDir = useCallback(
    async (root: FileSystemDirectoryHandle | null | undefined, streamLabel?: string) => {
      if (!root) return null;
      const name = (streamLabel ?? "").trim() || "光电";
      const safe = name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "光电";
      type DirHandleExt = FileSystemDirectoryHandle & {
        getDirectoryHandle?: (
          name: string,
          options?: { create?: boolean },
        ) => Promise<FileSystemDirectoryHandle>;
      };
      const ext = root as DirHandleExt;
      if (typeof ext.getDirectoryHandle !== "function") return root;
      try {
        return await ext.getDirectoryHandle(safe, { create: true });
      } catch {
        return root;
      }
    },
    [],
  );

  const dismissSnapshotPreview = useCallback(() => {
    setSnapshotPreview((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  }, []);

  const onSnapshotCollect = useCallback(async () => {
    const p = snapshotPreviewRef.current;
    if (!p?.blob) {
      appendClientLog(`${new Date().toLocaleTimeString()} 采集失败：无文件数据`);
      return;
    }
    setCollectTarget({ kind: p.kind, blob: p.blob, fileName: p.fileName });
    setCollectDialogOpen(true);
  }, [appendClientLog]);

  const closeCollectDialog = useCallback(() => {
    setCollectDialogOpen(false);
    setCollectTarget(null);
  }, []);

  const onOpenCapturePath = useCallback(async () => {
    if (!isShowDirectoryPickerSupported()) {
      appendClientLog(`${new Date().toLocaleTimeString()} 当前浏览器不支持打开目录选择器`);
      return;
    }
    const kind = snapshotPreviewRef.current?.kind ?? "snapshot";
    let root = kind === "record" ? captureDirHandleRecordRef.current : captureDirHandleSnapshotRef.current;
    if (!root) {
      root = await pickCaptureDirectoryHandle(kind);
      await saveCaptureDirHandle(root, kind);
      if (kind === "record") captureDirHandleRecordRef.current = root;
      else captureDirHandleSnapshotRef.current = root;
      setCaptureFolderLabel(root.name);
    }
    const startDir = await resolvePerStreamCaptureDir(root, activeStream?.label);
    await pickCaptureDirectoryHandle(kind, startDir ?? root);
    appendClientLog(`${new Date().toLocaleTimeString()} 已打开保存目录（请在弹窗中确认）`);
  }, [activeStream?.label, appendClientLog, resolvePerStreamCaptureDir]);

  const onSnapshotAnalyze = useCallback(async () => {
    const p = snapshotPreviewRef.current;
    if (!p?.blob) {
      appendClientLog(`${new Date().toLocaleTimeString()} 分析失败：无截图数据`);
      return;
    }
    appendClientLog(`${new Date().toLocaleTimeString()} 正在请求 VLM 研判…`);
    let b64: string;
    try {
      b64 = await blobToBase64DataOnly(p.blob);
    } catch {
      toast.error("无法读取图片数据");
      return;
    }
    let res: Response;
    try {
      res = await fetch("/api/vlm/image-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, fileName: p.fileName }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendClientLog(`${new Date().toLocaleTimeString()} VLM 请求失败：${msg}`);
      toast.error("无法连接研判服务", { description: msg });
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok) {
      const err = typeof data.error === "string" ? data.error : res.statusText;
      appendClientLog(`${new Date().toLocaleTimeString()} VLM 错误：${err}`);
      toast.error("研判失败", { description: err });
      return;
    }
    const text = (data.text ?? "").trim() || "（模型返回为空）";
    const mime =
      p.blob.type && /^image\/[a-z0-9.+-]+$/i.test(p.blob.type) ? p.blob.type : "image/png";
    const imageDataUrl = `data:${mime};base64,${b64}`;
    useVlmChatInjectStore.getState().scheduleVlmExchange({
      userText: "请对下面图片进行分析",
      imageUrl: imageDataUrl,
      imageMediaType: mime,
      filename: p.fileName,
      assistantText: text,
    });
    const app = useAppStore.getState();
    app.setRightPanelTab("chat");
    if (!app.rightSidebarOpen) app.toggleRightSidebar();
    appendClientLog(`${new Date().toLocaleTimeString()} VLM 研判完成，已切换到 AI 助手面板`);
    toast.success("研判完成", { description: "见右侧对话中的用户消息与 AI 回复" });
  }, [appendClientLog]);

  const handleSnapshot = useCallback(async () => {
    const name = buildEoCaptureFilename({
      configuredPath: "",
      streamLabel: activeStream?.label,
      kind: "snapshot",
      ext: "png",
    });
    try {
      let blob: Blob;
      if (isThirdPartyUdpStream) {
        const stack = thirdPartyStackRef.current;
        if (!stack) return;
        blob = await stack.captureToPng();
      } else {
        const v = videoRef.current;
        if (!v) return;
        blob = await captureEoPlaybackToPngBlob(v, snapshotCanvasRef.current);
      }
      try {
        let dir = captureDirHandleSnapshotRef.current;
        if (!dir && isShowDirectoryPickerSupported()) {
          try {
            dir = await pickCaptureDirectoryHandle("snapshot");
            await saveCaptureDirHandle(dir, "snapshot");
            captureDirHandleSnapshotRef.current = dir;
            setCaptureFolderLabel(dir.name);
            appendClientLog(`${new Date().toLocaleTimeString()} 已绑定本机保存文件夹「${dir.name}」`);
          } catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError")) {
              appendClientLog(`${new Date().toLocaleTimeString()} 选择文件夹失败：${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        const targetDir = await resolvePerStreamCaptureDir(dir, activeStream?.label);
        const mode = await saveCaptureBlob(blob, name, targetDir);
        appendClientLog(
          `${new Date().toLocaleTimeString()} ${
            mode === "directory"
              ? `截图已保存到本机文件夹：${activeStream?.label || "光电"}/${name}`
              : `截图已保存（下载）：${name}`
          }`,
        );
      } catch (err) {
        appendClientLog(
          `${new Date().toLocaleTimeString()} 截图保存失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      setSnapshotPreview((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return {
          kind: "snapshot",
          objectUrl: URL.createObjectURL(blob),
          blob,
          fileName: name,
        };
      });
    } catch (e) {
      appendClientLog(`${new Date().toLocaleTimeString()} 截图失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeStream?.label, appendClientLog, isThirdPartyUdpStream, resolvePerStreamCaptureDir]);

  const handleToggleRecord = useCallback(() => {
    if (recorderCtlRef.current?.isRecording()) {
      recorderCtlRef.current.stop();
      return;
    }
    const { mimeType, ext } = pickRecordMimeAndExtension();
    const name = buildEoCaptureFilename({
      configuredPath: "",
      streamLabel: activeStream?.label,
      kind: "record",
      ext,
    });

    const onSaveBlob = async (blob: Blob, suggested: string) => {
      const extFromBlob = blob.type.includes("mp4") ? "mp4" : blob.type.includes("webm") ? "webm" : ext;
      const base = suggested.replace(/\.(mp4|webm)$/i, "");
      const finalName = `${base}.${extFromBlob}`;
      let dir = captureDirHandleRecordRef.current;
      if (!dir && isShowDirectoryPickerSupported()) {
        try {
          dir = await pickCaptureDirectoryHandle("record");
          await saveCaptureDirHandle(dir, "record");
          captureDirHandleRecordRef.current = dir;
          setCaptureFolderLabel(dir.name);
          appendClientLog(`${new Date().toLocaleTimeString()} 已绑定本机保存文件夹「${dir.name}」`);
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "AbortError")) {
            appendClientLog(`${new Date().toLocaleTimeString()} 选择文件夹失败：${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      const targetDir = await resolvePerStreamCaptureDir(dir, activeStream?.label);
      const mode = await saveCaptureBlob(blob, finalName, targetDir);
      appendClientLog(
        `${new Date().toLocaleTimeString()} ${
          mode === "directory"
            ? `录屏已写入本机文件夹：${activeStream?.label || "光电"}/${finalName}`
            : `录屏已触发下载：${finalName}`
        }`,
      );
      setSnapshotPreview((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return {
          kind: "record",
          objectUrl: URL.createObjectURL(blob),
          blob,
          fileName: finalName,
        };
      });
    };
    const onError = (msg: string) => {
      appendClientLog(`${new Date().toLocaleTimeString()} 录屏：${msg}`);
      setIsRecording(false);
      recorderCtlRef.current = null;
    };
    const onStarted = () => {
      setIsRecording(true);
      appendClientLog(
        `${new Date().toLocaleTimeString()} 录屏开始 → 容器 ${ext.toUpperCase()}${ext === "webm" ? "（当前浏览器不支持 MP4 录制）" : ""}，将保存为 ${name}`,
      );
    };
    const onStopped = () => {
      setIsRecording(false);
      recorderCtlRef.current = null;
    };
    const recordOpts = { fileName: name, mimeType, onSaveBlob, onError, onStarted, onStopped };

    if (isThirdPartyUdpStream) {
      const canvas = thirdPartyStackRef.current?.getRecordCanvas() ?? null;
      if (!canvas) return;
      const ctl = createEoCanvasRecorder({ canvas, ...recordOpts });
      recorderCtlRef.current = ctl;
      ctl.start();
      return;
    }

    const canvas = snapshotCanvasRef.current;
    const v = videoRef.current;
    const canvasOk = Boolean(canvas && canvas.width > 0 && canvas.height > 0);
    const videoOk = Boolean(v && v.videoWidth > 0 && v.videoHeight > 0);
    if (!canvasOk && !videoOk) {
      appendClientLog(`${new Date().toLocaleTimeString()} 录屏：视频尚未就绪，无法开始录制`);
      return;
    }
    const ctl =
      canvasOk && canvas
        ? createEoCanvasRecorder({ canvas, ...recordOpts })
        : createEoVideoRecorder({ video: v!, ...recordOpts });
    recorderCtlRef.current = ctl;
    ctl.start();
  }, [activeStream?.label, appendClientLog, isThirdPartyUdpStream, resolvePerStreamCaptureDir]);

  const onSingleTrackTask = useCallback(
    async (payload: {
      rectId: number;
      rectType: number;
      x: number;
      y: number;
      width: number;
      height: number;
      /** 与 Qt CameraMetaTask::m_nTackAction 一致：1 开始跟踪，0 取消跟踪 */
      trackAction?: 0 | 1;
    }) => {
      if (!detectionEntityId) throw new Error("当前未绑定实体相机");
      // 取消跟踪时同步清除烧录流标牌（火并忘记，不影响主流程）
      if ((payload.trackAction ?? 1) === 0) {
        void clearAllBurnInPlacards();
      }
      const requestBody = {
        backendBaseUrl: taskBackendBaseUrl,
        entityId: detectionEntityId,
        rectId: payload.rectId,
        rectType: payload.rectType,
        trackAction: payload.trackAction ?? 1,
        boundingBox: {
          x: payload.x,
          y: payload.y,
          width: payload.width,
          height: payload.height,
        },
      };
      const stamp = Date.now();
      let httpStatus: number | null = null;
      let responseText = "";
      try {
        const res = await fetch("/api/camera-task/single-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        httpStatus = res.status;
        responseText = await res.text().catch(() => "");
        setTaskTrace({
          request: requestBody,
          httpStatus,
          responseText,
          at: stamp,
        });
        if (!res.ok) {
          let detail = responseText.slice(0, 400);
          try {
            const j = responseText ? JSON.parse(responseText) : null;
            const msg = j?.detail != null ? String(j.detail) : j?.error != null ? String(j.error) : "";
            const details = Array.isArray(j?.details) ? j.details.map((v: unknown) => String(v)).join(" | ") : "";
            detail = [msg, details].filter(Boolean).join(" · ") || detail;
          } catch {
            /* 非 JSON，沿用原文片段 */
          }
          throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (httpStatus === null) {
          setTaskTrace({
            request: requestBody,
            httpStatus: null,
            responseText,
            fetchError: msg,
            at: stamp,
          });
        }
        throw e;
      }
    },
    [detectionEntityId, taskBackendBaseUrl],
  );

  const onUavImgTrackingTask = useCallback(
    async (payload: { rectId: number; videoDetectType: 0 | 1 }) => {
      const ap = (mqttAirportSn ?? activeStream?.uav?.airportSN ?? "").trim();
      if (!ap) throw new Error("缺少机场 SN");
      const requestBody = {
        airportSN: ap,
        rectId: payload.rectId,
        videoDetectType: payload.videoDetectType,
      };
      const stamp = Date.now();
      try {
        const json = await postUavImgTrackingTask({
          airportSN: ap,
          rectId: payload.rectId,
          videoDetectType: payload.videoDetectType,
        });
        setTaskTrace({
          request: requestBody,
          httpStatus: json.status ?? 200,
          responseText: JSON.stringify(json),
          at: stamp,
        });
        if (json.taskId) setUavTrackTaskId(json.taskId);
        showUavBottomFeedback("无人机目标跟踪已发送", "success");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTaskTrace({
          request: requestBody,
          httpStatus: null,
          responseText: "",
          fetchError: msg,
          at: stamp,
        });
        showUavBottomFeedback(`无人机跟踪失败：${msg}`, "error");
        throw e;
      }
    },
    [activeStream?.uav?.airportSN, mqttAirportSn, showUavBottomFeedback],
  );

  const onUavStopTrackingTask = useCallback(async () => {
    const tid = uavTrackTaskId?.trim();
    if (!tid) {
      showUavBottomFeedback("无可停止的无人机跟踪任务", "warn");
      return;
    }
    await postUavTaskStop({ taskIds: [tid] });
    setUavTrackTaskId(null);
    showUavBottomFeedback("已发送取消无人机跟踪", "success");
  }, [showUavBottomFeedback, uavTrackTaskId]);

  const onUavLensSwitch = useCallback(
    async (lens: UavVideoLensType) => {
      const dr = (mqttDeviceSn ?? activeStream?.uav?.deviceSN ?? "").trim();
      if (!dr) {
        showUavBottomFeedback("缺少无人机 SN，无法切换镜头", "warn");
        return;
      }
      try {
        await postUavSwitchVideoCamera({
          droneSn: dr,
          payloadIndex: uavMainPayloadIndexForDrone(dr),
          videoType: lens,
        });
        setUavActiveLens(lens);
        showUavBottomFeedback(
          lens === "wide" ? "已切换广角" : lens === "ir" ? "已切换红外" : "已切换变焦",
          "success",
        );
      } catch (e) {
        showUavBottomFeedback(
          `镜头切换失败：${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        throw e;
      }
    },
    [activeStream?.uav?.deviceSN, mqttDeviceSn, showUavBottomFeedback],
  );

  useEffect(() => {
    setUavTrackTaskId(null);
  }, [activeStreamId]);

  if (loadErr) {
    return (
      <div
        className={cn(
          "flex min-h-[120px] items-center justify-center rounded-none border border-white/[0.06] bg-black/50 p-3 text-center text-[10px] text-red-400",
          className,
        )}
      >
        配置加载失败：{loadErr}
      </div>
    );
  }

  if (!cfg || !activeStream) {
    return (
      <div
        className={cn(
          "flex min-h-[120px] items-center justify-center rounded-none border border-white/[0.06] bg-black/50 p-3 text-[10px] text-nexus-text-muted",
          className,
        )}
      >
        正在加载光电配置…
      </div>
    );
  }

  return (
    <div
      ref={panelRootRef}
      role={dockPidNorm ? "group" : undefined}
      aria-label={dockPidNorm ? `光电面板 ${dockPidNorm}` : undefined}
      style={
        panelHeightPx != null
          ? { height: panelHeightPx, maxHeight: "min(92vh, 960px)" }
          : undefined
      }
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-none border border-white/[0.06] bg-black/60",
        panelHeightPx != null && "shrink-0",
        eoPanelSelected && "ring-2 ring-inset ring-sky-400/55",
        className,
      )}
      onPointerDownCapture={() => {
        if (dockPidNorm) setEoFocusedDockPanel(dockPidNorm);
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <EoStreamContextMenu
          config={cfg}
          activeStreamId={activeStreamId}
          onSelectStream={onSelectStream}
          extraItems={contextMenuExtraItems}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {activeStream?.uav ? (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/85">
                {(!reuseSharedStream && (uavPlayLoading || !uavPlaySignalingUrl || uavPlayErr)) ||
                (reuseSharedStream && !sharedMediaStream) ? (
                  <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-3 py-6 text-center text-[11px] text-nexus-text-muted">
                    {reuseSharedStream
                      ? "等待小窗画面…"
                      : (uavPlayErr ?? (uavPlayLoading ? "正在解析无人机视频地址…" : "等待无人机流…"))}
                    {!reuseSharedStream && mqttWsUrl
                      ? ` · MQTT：${mqttDroneInDock === null ? "未收到舱状态" : mqttDroneInDock ? "舱内→机场画面" : "舱外→主摄"}`
                      : !reuseSharedStream && platformMqtt.status === "loading" && !mqttWsUrlFromEnv
                        ? " · MQTT：正在从私有云获取地址…"
                        : !reuseSharedStream
                          ? " · MQTT：无可用 WebSocket 地址，无法自动舱内/外切换"
                          : ""}
                    {!reuseSharedStream && uavResolveDebug ? ` · ${uavResolveDebug}` : ""}
                  </div>
                ) : (
                  <EoVideoPlayStage
                    className="absolute inset-0 min-h-0"
                    stageRef={wrapRef}
                    signalingUrl={
                      reuseSharedStream
                        ? playSignalingUrl || "shared://parent-media-stream"
                        : playSignalingUrl
                    }
                    iceServers={cfg.iceServers}
                    streamLabel={activeStream.label}
                    videoRef={videoRef}
                    peerConnectionRef={peerConnectionRef}
                    exposePeerForDetection={Boolean(detectionEntityId && detectionEnabled)}
                    entityId={detectionEntityId}
                    detectionEnabled={detectionEnabled}
                    bareVideoPlayback={isBurnInPlayback}
                    suppressDrawnBoxes={burnInHideOverlay}
                    onDetectionDiagnostic={handleDetectionDiagnostic}
                    selectedBoxId={selectedBoxId}
                    onSelectBox={handleSelectDetectionBox}
                    taskBackendBaseUrl={taskBackendBaseUrl}
                    onSaveTaskBackendBaseUrl={onSaveTaskBackendBaseUrl}
                    onSingleTrackTask={onSingleTrackTask}
                    enableYuan8PickTrack={isYuan8Stream}
                    onTaskClientLog={appendClientLog}
                    snapshotSavePath={snapshotSavePath}
                    recordSavePath={recordSavePath}
                    onSaveCapturePaths={onSaveCapturePaths}
                    captureLocalFolderLabel={captureFolderLabel}
                    captureLocalFolderSupported={isShowDirectoryPickerSupported()}
                    onPickCaptureLocalFolder={handlePickCaptureLocalFolder}
                    onClearCaptureLocalFolder={handleClearCaptureLocalFolder}
                    detectionBoxes={detectionBoxes}
                    onDetectionBoxesChange={setDetectionBoxes}
                    onBottomCenterToast={onUavBottomCenterToast}
                    sideToolbarReserved
                    onCaptureReadyChange={onEoCaptureReadyChange}
                    snapshotCanvasRef={snapshotCanvasRef}
                    uavCameraAim={uavCameraAimUi}
                    expandedMode={effectiveExpandedMode}
                    ddsCameraEntityId={cameraDdsEntityId}
                    uavAirportSn={mqttAirportSn ?? activeStream?.uav?.airportSN ?? null}
                    onUavImgTrackingTask={onUavImgTrackingTask}
                    onUavStopTrackingTask={onUavStopTrackingTask}
                    uavTrackingActive={uavTrackingActive}
                    webRtcKickEpoch={
                      reuseSharedStream ? 0 : uavWebRtcKick + dockPlaybackKick
                    }
                    stallWatchIntervalMs={
                      reuseSharedStream ? undefined : WEBRTC_UAV_STALL_WATCH_INTERVAL_MS
                    }
                    onStallRecover={reuseSharedStream ? undefined : handleUavStallRecover}
                    sharedMediaStream={sharedMediaStream}
                    sharedPlaybackOnly={preferSharedPlayback}
                    uavTrackProjectVisible={uavTrackProjectVisible}
                    uavTrackProjectAfterTakeoff={mqttDroneInDock === false}
                    uavTrackProjectDroneSn={mqttDeviceSn ?? activeStream?.uav?.deviceSN ?? null}
                    uavTrackProjectMqttTelemetry={mqttTelemetry}
                  />
                )}
                {effectiveExpandedMode && (reuseSharedStream || (uavPlaySignalingUrl && !uavPlayErr)) ? (
                  <div className="pointer-events-none absolute inset-x-0 top-2 z-[28] flex justify-center px-2">
                    <EoUavLensSwitchBar
                      droneSn={(mqttDeviceSn ?? activeStream?.uav?.deviceSN ?? "").trim()}
                      activeLens={uavActiveLens}
                      disabled={!mqttDeviceSn?.trim() && !activeStream?.uav?.deviceSN?.trim()}
                      onSwitch={onUavLensSwitch}
                    />
                  </div>
                ) : null}
                <div className="pointer-events-none absolute inset-0 z-30">
                  {effectiveExpandedMode && !classicToolsCaptureOnly ? (
                    <div className="pointer-events-none absolute left-1 top-1/2 flex max-h-[calc(100%-8px)] -translate-y-1/2 flex-col items-start justify-center overflow-visible">
                      <EoVideoFloatingTools
                        className="pointer-events-auto"
                        variant="uav"
                        hideExpandButton
                        expandedMode
                        captureReady={captureReady}
                        isRecording={isRecording}
                        onSnapshot={handleSnapshot}
                        onToggleRecord={handleToggleRecord}
                        onUavClientLog={appendClientLog}
                        onUavPsdkNotify={showUavBottomFeedback}
                        onUavGimbalCenter={onUavGimbalCenter}
                        onUavGimbalDown={onUavGimbalDown}
                        uavGatewaySn={mqttAirportSn}
                        uavPsdkDisabled={!mqttAirportSn?.trim() || !activeStream?.uav}
                        uavGimbalDisabled={!mqttAirportSn?.trim() || !activeStream?.uav}
                        uavPayloadToolsOnly
                        uavPopPanelSide="right"
                      />
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "pointer-events-none absolute right-1 top-1/2 flex max-h-[calc(100%-8px)] -translate-y-1/2 flex-col items-end justify-center gap-1 overflow-visible",
                    )}
                  >
                    {classicToolsCaptureOnly ? (
                      <div className="flex flex-row items-start gap-1.5">
                        {snapshotPreview ? (
                          <EoSnapshotPreviewPopout
                            key={snapshotPreview.objectUrl}
                            preview={snapshotPreview}
                            onDismiss={dismissSnapshotPreview}
                            onOpen={onOpenCapturePath}
                            onCollect={onSnapshotCollect}
                            onAnalyze={onSnapshotAnalyze}
                          />
                        ) : null}
                        <EoVideoFloatingTools
                          className="pointer-events-auto"
                          variant="uav"
                          hideExpandButton
                          captureOnly
                          captureReady={captureReady}
                          isRecording={isRecording}
                          onSnapshot={handleSnapshot}
                          onToggleRecord={handleToggleRecord}
                          onReconnectStream={handleReconnectStream}
                          reconnectStreamBusy={reconnectStreamBusy}
                        />
                      </div>
                    ) : (
                      <>
                    {!disableExpand ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          "pointer-events-auto border border-white/25 bg-transparent text-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
                          expandedMode && "border-sky-400/45 bg-sky-950/50 text-sky-300",
                        )}
                        title={expandedMode ? "恢复默认窗口" : "放大窗口"}
                        aria-label={expandedMode ? "恢复默认窗口" : "放大窗口"}
                        onClick={toggleExpand}
                      >
                        {expandedMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        "pointer-events-auto border bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
                        uavCtrlAuth.hasAuth
                          ? "border-sky-400/45 bg-sky-950/50 text-sky-200 hover:border-sky-400/55 hover:bg-sky-900/65 hover:text-sky-50"
                          : "border-white/25 text-white/85",
                        uavCtrlAuth.busy || !mqttAirportSn ? "cursor-not-allowed opacity-50" : "",
                        isControlling ? "ring-2 ring-sky-400/45" : "",
                      )}
                      onClick={toggleUavAuth}
                      disabled={uavCtrlAuth.busy || !mqttAirportSn}
                      title={
                        uavCtrlAuth.busy
                          ? "处理中…"
                          : uavCtrlAuth.hasAuth
                            ? isControlling
                              ? "控制中（点击退出控制）"
                              : "退出控制"
                            : "获取控制权"
                      }
                      aria-label={
                        uavCtrlAuth.busy
                          ? "处理中"
                          : uavCtrlAuth.hasAuth
                            ? isControlling
                              ? "控制中，点击退出控制"
                              : "退出控制"
                            : "获取控制权"
                      }
                      aria-pressed={uavCtrlAuth.hasAuth}
                    >
                      {uavCtrlAuth.busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Joystick className="size-3.5" />
                      )}
                    </Button>
                    {mqttDroneInDock === true ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          "pointer-events-auto border border-white/25 bg-transparent text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
                          !mqttAirportSn || uavActionBusy?.takeoff ? "cursor-not-allowed opacity-50" : "",
                        )}
                        title="起飞"
                        aria-label="起飞"
                        disabled={!mqttAirportSn || Boolean(uavActionBusy?.takeoff)}
                        onClick={() => void triggerUavAction("takeoff")}
                      >
                        {uavActionBusy?.takeoff ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <PlaneTakeoff className="size-3.5" aria-hidden />
                        )}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        "pointer-events-auto border border-white/25 bg-transparent text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
                        !mqttAirportSn || uavActionBusy?.back ? "cursor-not-allowed opacity-50" : "",
                      )}
                      title="返航"
                      aria-label="返航"
                      disabled={!mqttAirportSn || Boolean(uavActionBusy?.back)}
                      onClick={() => void triggerUavAction("back")}
                    >
                      {uavActionBusy?.back ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Home className="size-3.5" aria-hidden />
                      )}
                    </Button>
                    <div className="flex flex-row items-start gap-1.5">
                      {snapshotPreview ? (
                        <EoSnapshotPreviewPopout
                          key={snapshotPreview.objectUrl}
                          preview={snapshotPreview}
                          onDismiss={dismissSnapshotPreview}
                          onOpen={onOpenCapturePath}
                          onCollect={onSnapshotCollect}
                          onAnalyze={onSnapshotAnalyze}
                        />
                      ) : null}
                      <EoVideoFloatingTools
                        className="pointer-events-auto"
                        variant="uav"
                        hideExpandButton
                        expandedMode={effectiveExpandedMode}
                        onToggleExpand={toggleExpand}
                        uavDockExpanded={uavDockExpanded}
                        lockUavDockExpanded={classicFixedExpanded}
                        onToggleUavDock={() => {
                          if (classicFixedExpanded) return;
                          setUavDockExpanded((v) => !v);
                        }}
                        pipOpen={pipOpen}
                        onTogglePip={togglePip}
                        captureReady={captureReady}
                        isRecording={isRecording}
                        onSnapshot={handleSnapshot}
                        onToggleRecord={handleToggleRecord}
                        onReconnectStream={handleReconnectStream}
                        reconnectStreamBusy={reconnectStreamBusy}
                        onUavClientLog={appendClientLog}
                        onUavPsdkNotify={showUavBottomFeedback}
                        onUavGimbalCenter={onUavGimbalCenter}
                        onUavGimbalDown={onUavGimbalDown}
                        uavGatewaySn={mqttAirportSn}
                        uavPsdkDisabled={!mqttAirportSn?.trim() || !activeStream?.uav}
                        uavGimbalDisabled={!mqttAirportSn?.trim() || !activeStream?.uav}
                        uavVideoOnly={uavVideoOnly}
                        onToggleUavVideoOnly={() => setUavVideoOnly((v) => !v)}
                        uavTrackProjectVisible={uavTrackProjectVisible}
                        onToggleUavTrackProject={() => setUavTrackProjectVisible((v) => !v)}
                        uavTrackProjectDisabled={mqttDroneInDock !== false}
                        showUavExpandedDebugToggle={!EO_VIDEO_DEBUG_UI && effectiveExpandedMode}
                        uavExpandedDebugOpen={uavExpandedDebugOpen}
                        onToggleUavExpandedDebug={() => setUavExpandedDebugOpen((v) => !v)}
                        omitUavPayloadTools={effectiveExpandedMode}
                      />
                    </div>
                      </>
                    )}
                  </div>
                </div>
                {/* 控制台在上、状态条在下，叠在画面上；底栏 pb-0 贴容器底；手柄可收起罗盘/状态/控制台 */}
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 z-[25] flex max-h-[min(58vh,420px)] flex-col justify-end gap-0 px-0 pb-0",
                    uavDockExpanded ? "pt-8" : "pt-2",
                  )}
                >
                  {uavDockExpanded ? (
                    <div className="pointer-events-none min-h-0 min-w-0 overflow-y-auto overscroll-contain">
                      <EoUavConsoleDock
                        transparent
                        streamLabel={activeStream.label}
                        mqttConnected={mqttHud.connected}
                        droneInDock={mqttDroneInDock}
                        telemetry={mqttTelemetry}
                        keyPressed={keyState}
                        onAction={triggerUavAction}
                        actionBusy={uavActionBusy}
                        onClientLog={appendClientLog}
                      />
                    </div>
                  ) : null}
                  {!EO_VIDEO_DEBUG_UI && effectiveExpandedMode && uavExpandedDebugOpen ? (
                    <div className="pointer-events-auto z-[26] w-full max-h-[min(42vh,300px)] shrink-0 overflow-auto border-t border-white/[0.12] bg-black/82 backdrop-blur-sm">
                      <EoVideoTaskTracePanel
                        trace={taskTrace}
                        clientEcho={clientEcho}
                        uavMqttStatus={[uavMqttFooterLine, drcDebugLine].filter(Boolean).join("\n")}
                      />
                    </div>
                  ) : null}
                  <div className="pointer-events-auto shrink-0">
                    <EoVideoBottomFloater
                      variant="uav"
                      streamLabel={activeStream.label}
                      batteryPercent={uavBottomBatteryPct}
                      taskLine={ddsBottomTaskLine}
                      centerLine={uavBottomFeedback?.text}
                      centerTone={uavBottomFeedback?.tone}
                    />
                  </div>
                </div>
                <EoPipFloatingPlayer
                  key={`eo-pip-${pipStreamId || activeStreamId}`}
                  open={showEoPipFloatingPlayer}
                  expandedMode={effectiveExpandedMode}
                  config={cfg}
                  iceServers={cfg.iceServers}
                  pipStreamId={pipStreamId || activeStreamId}
                  onSelectPipStream={setPipStreamId}
                  onSwapWithMain={swapPipWithMain}
                  signalingUrl={pipSignalingUrl}
                  loading={pipResolving}
                  error={pipErr}
                  streamLabel={pipStreamLabel}
                />
              </div>
            ) : (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/85">
                  {showCameraLoadingGate && !reuseSharedStream ? (
                    <div className="flex h-full min-h-[200px] flex-1 items-center justify-center px-3 text-center text-[11px] text-nexus-text-muted">
                      {cameraResolveErr ??
                        (cameraResolveLoading ? "正在解析光电相机流地址…" : "等待相机流…")}
                    </div>
                  ) : isThirdPartyUdpStream ? (
                    <>
                      <EoHighSpeedYuvStack
                        ref={thirdPartyStackRef}
                        className="absolute inset-0 min-h-0"
                        videoWidth={thirdPartyLive.videoWidth}
                        videoHeight={thirdPartyLive.videoHeight}
                        strideY={thirdPartyLive.strideY}
                        yuv420={null}
                        boxes={[]}
                        fovOverlayBoxes={thirdPartyFovOverlayBoxes}
                        placeholderHint={[
                          `第三方相机 · ${activeStream?.label ?? ""} · ${activeStream?.id ?? ""}`,
                          activeStream?.multicastUdp ? `组播 UDP ${activeStream.multicastUdp}（服务端中继 → WS）` : "",
                          thirdPartyLive.hint ||
                            "(Next 需在 Node 起中继；端口见 EO_THIRD_PARTY_CAMERA_WS_PORT，默认 40777)",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                      {showThirdPartySubPipStack ? (
                        <EoThirdPartySubCamPipStack
                          entityIds={thirdPartySubPipIds}
                          expandedMode={effectiveExpandedMode}
                          sideToolbarReserved
                        />
                      ) : null}
                    </>
                  ) : reuseSharedStream && !sharedMediaStream ? (
                    <div className="flex h-full min-h-[200px] flex-1 items-center justify-center px-3 text-center text-[11px] text-nexus-text-muted">
                      等待小窗画面…
                    </div>
                  ) : (
                    <>
                      <EoVideoPlayStage
                        stageRef={wrapRef}
                        signalingUrl={
                          reuseSharedStream
                            ? playSignalingUrl || "shared://parent-media-stream"
                            : playSignalingUrl
                        }
                        iceServers={cfg.iceServers}
                        streamLabel={activeStream.label}
                        videoRef={videoRef}
                        peerConnectionRef={peerConnectionRef}
                        exposePeerForDetection={Boolean(detectionEntityId && detectionEnabled)}
                        entityId={detectionEntityId}
                        detectionEnabled={detectionEnabled}
                        bareVideoPlayback={isBurnInPlayback}
                    suppressDrawnBoxes={burnInHideOverlay}
                        onDetectionDiagnostic={handleDetectionDiagnostic}
                        selectedBoxId={selectedBoxId}
                        onSelectBox={handleSelectDetectionBox}
                        taskBackendBaseUrl={taskBackendBaseUrl}
                        onSaveTaskBackendBaseUrl={onSaveTaskBackendBaseUrl}
                        onSingleTrackTask={onSingleTrackTask}
                        enableYuan8PickTrack={isYuan8Stream}
                        onTaskClientLog={appendClientLog}
                        snapshotSavePath={snapshotSavePath}
                        recordSavePath={recordSavePath}
                        onSaveCapturePaths={onSaveCapturePaths}
                        captureLocalFolderLabel={captureFolderLabel}
                        captureLocalFolderSupported={isShowDirectoryPickerSupported()}
                        onPickCaptureLocalFolder={handlePickCaptureLocalFolder}
                        onClearCaptureLocalFolder={handleClearCaptureLocalFolder}
                        detectionBoxes={detectionBoxes}
                        onDetectionBoxesChange={setDetectionBoxes}
                        onBottomCenterToast={showCameraBottomFeedback}
                        sideToolbarReserved
                        onCaptureReadyChange={onEoCaptureReadyChange}
                        snapshotCanvasRef={snapshotCanvasRef}
                        expandedMode={effectiveExpandedMode}
                        ddsCameraEntityId={cameraDdsEntityId}
                        sharedMediaStream={sharedMediaStream}
                        sharedPlaybackOnly={preferSharedPlayback}
                        webRtcKickEpoch={reuseSharedStream ? 0 : dockPlaybackKick}
                      />
                      <EoExpandedCameraPtzHud
                        expandedMode={effectiveExpandedMode}
                        entityId={cameraDdsEntityId}
                        disabled={Boolean(showCameraLoadingGate)}
                      />
                    </>
                  )}
                  <div className="pointer-events-none absolute inset-0 z-30">
                    <div className="pointer-events-none absolute right-1 top-1/2 flex max-h-[calc(100%-8px)] -translate-y-1/2 flex-col items-end justify-center gap-1 overflow-visible">
                      <div className="flex flex-row items-start gap-1.5">
                        {snapshotPreview ? (
                          <EoSnapshotPreviewPopout
                            key={snapshotPreview.objectUrl}
                            preview={snapshotPreview}
                            onDismiss={dismissSnapshotPreview}
                            onOpen={onOpenCapturePath}
                            onCollect={onSnapshotCollect}
                            onAnalyze={onSnapshotAnalyze}
                          />
                        ) : null}
                        <EoVideoFloatingTools
                        className="pointer-events-auto"
                        variant="camera"
                        hideExpandButton={disableExpand || classicToolsCaptureOnly}
                        captureOnly={classicToolsCaptureOnly}
                        expandedMode={effectiveExpandedMode}
                        onToggleExpand={disableExpand || classicToolsCaptureOnly ? undefined : toggleExpand}
                        ptzSupported={ptzSupported}
                        ptzPanelOpen={ptzPanelOpen}
                        onTogglePtzPanel={() => setPtzPanelOpen((v) => !v)}
                        pipOpen={pipOpen}
                        onTogglePip={classicToolsCaptureOnly ? undefined : togglePip}
                        pipThirdPartySubCamsAvailable={isThirdPartyUdpStream && thirdPartySubPipIds.length > 0}
                        captureReady={isThirdPartyUdpStream ? thirdPartyCaptureReady : captureReady}
                        isRecording={isRecording}
                        onSnapshot={handleSnapshot}
                        onToggleRecord={handleToggleRecord}
                        onReconnectStream={handleReconnectStream}
                        reconnectStreamBusy={reconnectStreamBusy}
                        thirdPartyCamControls={!classicToolsCaptureOnly && isThirdPartyUdpStream}
                        onThirdPartyCamKind={handleThirdPartyCamKindSelect}
                        thirdPartyCamBusy={thirdPartyCamBusy}
                        thirdPartyDirectMoveSupported={
                          !classicToolsCaptureOnly && (isThirdPartyUdpStream || isYuan8Stream)
                        }
                        showCameraExpandedDebugToggle={
                          !classicToolsCaptureOnly && !EO_VIDEO_DEBUG_UI && effectiveExpandedMode
                        }
                        cameraExpandedDebugOpen={cameraExpandedDebugOpen}
                        onToggleCameraExpandedDebug={() =>
                          setCameraExpandedDebugOpen((v) => !v)
                        }
                        calcRecordSupported={
                          !classicToolsCaptureOnly &&
                          effectiveExpandedMode &&
                          ptzSupported &&
                          !isThirdPartyUdpStream
                        }
                        onOpenCalcRecord={() => calcRecord.setDialogOpen(true)}
                        aimCollectSupported={
                          !classicToolsCaptureOnly && ptzSupported && !isThirdPartyUdpStream
                        }
                        aimCollectChecked={aimTrackCollect.checked}
                        aimCollectBusy={aimTrackCollect.busy}
                        onToggleAimCollect={() => void aimTrackCollect.toggleCollect()}
                        burnInHideOverlaySupported={
                          !classicToolsCaptureOnly && ptzSupported && !isThirdPartyUdpStream
                        }
                        burnInHideOverlayChecked={burnInHideOverlay}
                        burnInHideOverlayBusy={burnInHideOverlayBusy}
                        onToggleBurnInHideOverlay={() => void handleToggleBurnInHideOverlay()}
                        aimUpdateSupported={!classicToolsCaptureOnly && aimUpdateSupported}
                        aimUpdateBusy={aimUpdateBusy}
                        onAimUpdate={() => void handleAimUpdate()}
                        pidSettingsSupported={
                          !classicToolsCaptureOnly &&
                          effectiveExpandedMode &&
                          ptzSupported &&
                          !isThirdPartyUdpStream
                        }
                        onOpenPidSettings={() => setPidSettingsOpen(true)}
                      />
                      </div>
                    </div>
                  </div>
                  {/* 云台横条单行避让右侧工具；底栏本体全宽贴底（勿与云台共用外层 pl/pr/pb） */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] flex max-h-[min(58vh,420px)] flex-col justify-end gap-1 px-0 pb-0 pt-10">
                    {ptzPanelOpen && isYuan8Stream && activeStream?.id ? (
                      <div className="pointer-events-auto flex w-full shrink-0 justify-end pl-2 pr-14 pb-px max-sm:pr-3">
                        <EoYuan8PtzPanel
                          entityId={activeStream.id}
                          backendBaseUrl={taskBackendBaseUrl}
                          onClientLog={appendClientLog}
                        />
                      </div>
                    ) : ptzPanelOpen && isThirdPartyUdpStream && activeStream?.id ? (
                      <div className="pointer-events-auto flex w-full shrink-0 justify-end pl-2 pr-14 pb-px max-sm:pr-3">
                        <EoThirdPartyDirectMovePad
                          entityId={activeStream.id}
                          backendBaseUrl={taskBackendBaseUrl}
                          onClientLog={appendClientLog}
                        />
                      </div>
                    ) : ptzPanelOpen && ptzSupported && detectionEntityId ? (
                      <div className="pointer-events-auto flex w-full shrink-0 justify-end pl-2 pr-14 pb-px max-sm:pr-3">
                        <EoVideoPtzPanel
                          entityId={detectionEntityId}
                          backendBaseUrl={taskBackendBaseUrl}
                          onClientLog={appendClientLog}
                        />
                      </div>
                    ) : null}
                    {!EO_VIDEO_DEBUG_UI && effectiveExpandedMode && cameraExpandedDebugOpen ? (
                      <div className="pointer-events-auto z-[26] w-full max-h-[min(42vh,300px)] shrink-0 overflow-auto border-t border-white/[0.12] bg-black/82 backdrop-blur-sm">
                        <EoVideoTaskTracePanel
                          trace={taskTrace}
                          clientEcho={clientEcho}
                          uavMqttStatus={uavMqttFooterLine || undefined}
                          streamKindLine={
                            isThirdPartyUdpStream
                              ? `第三方类型：UDP 图传（YUV / WS 中继）· ${activeStream?.id ?? ""}`
                              : isThirdPartyWebrtcStream
                                ? `第三方类型：WebRTC · ${activeStream?.id ?? ""}`
                                : undefined
                          }
                          detectionWsLine={
                            detectionEntityId && detectionDiag.trim() ? detectionDiag : undefined
                          }
                          detectionWsTitle={
                            detectionEntityId && detectionDiagHover.trim()
                              ? detectionDiagHover
                              : undefined
                          }
                        />
                      </div>
                    ) : null}
                    <div className="pointer-events-auto w-full shrink-0">
                      <EoVideoBottomFloater
                        variant="camera"
                        streamLabel={activeStream.label}
                        taskLine={ddsBottomTaskLine}
                        centerLine={cameraBottomFeedback?.text}
                        centerTone={cameraBottomFeedback?.tone}
                      />
                    </div>
                  </div>
                  <EoPipFloatingPlayer
                    key={`eo-pip-${pipStreamId || activeStreamId}`}
                    open={showEoPipFloatingPlayer}
                    expandedMode={expandedMode}
                    config={cfg}
                    iceServers={cfg.iceServers}
                    pipStreamId={pipStreamId || activeStreamId}
                    onSelectPipStream={setPipStreamId}
                    onSwapWithMain={swapPipWithMain}
                    signalingUrl={pipSignalingUrl}
                    loading={pipResolving}
                    error={pipErr}
                    streamLabel={pipStreamLabel}
                  />
                </div>
            )}
          </div>
        </EoStreamContextMenu>
      </div>
      {resizable && EO_VIDEO_DEBUG_UI ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调节光电窗口高度"
          onPointerDown={onResizeStripPointerDown}
          className="group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-t border-white/[0.08] bg-black/50 hover:bg-white/10"
        >
          <div className="h-0.5 w-14 rounded-full bg-white/20 group-hover:bg-white/40" />
        </div>
      ) : null}
      {EO_VIDEO_DEBUG_UI ? (
        <EoVideoTaskTracePanel
          trace={taskTrace}
          clientEcho={clientEcho}
          uavMqttStatus={uavMqttFooterLine || undefined}
          streamKindLine={
            isThirdPartyUdpStream
              ? `第三方类型：UDP 图传（YUV / WS 中继）· ${activeStream?.id ?? ""}`
              : isThirdPartyWebrtcStream
                ? `第三方类型：WebRTC · ${activeStream?.id ?? ""}`
                : undefined
          }
          detectionWsLine={
            detectionEntityId && detectionDiag.trim() ? detectionDiag : undefined
          }
          detectionWsTitle={
            detectionEntityId && detectionDiagHover.trim() ? detectionDiagHover : undefined
          }
        />
      ) : null}
      {!expandedMode && !disableExpand && typeof window !== "undefined" ? (
        <EoVideoExpandFloatingFrame
          open={zoomWindowOpen}
          onClose={() => {
            setZoomWindowOpen(false);
            restoreDockVideoAfterZoom();
          }}
          persistKey={`${(streamPersistKey || entity || "default").trim()}::expandFrame`}
          title={expandFloatingFrameTitle}
        >
          {/**
           * 放大窗口：
           * - 与小窗口共用同一个 streamPersistKey（去掉 ::zoom 后缀）→ 共用 syncKey
           * - 双向同步：任意一侧切流，SyncStore 自动通知另一侧跟上
           * - 不传 sharedPlayback / sharedMediaStream：放大窗口独立建 WebRTC，
           *   避免 reuseSharedStream=true 时永远"等待小窗画面"导致黑屏
           * - initialStreamId 传当前流作为 seed，放大窗口首屏直接从正确流开始
           */}
          <EoVideoPanel
            key={`eo-zoom:${entity || "default"}`}
            configUrl={configUrl}
            entityId={
              isThirdPartyUdpStreamEntry(activeStream)
                ? activeStream.id
                : parseCameraEntityIdFromStreamId(activeStreamId) ||
                  (activeStreamId && /^camera[_-]?\d+$/i.test(activeStreamId.trim())
                    ? canonicalEntityId(activeStreamId)
                    : entityId)
            }
            streamPersistKey={streamPersistKey || entity || "default"}
            initialStreamId={activeStreamId}
            expandedMode
            onToggleExpand={() => {
              setZoomWindowOpen(false);
            }}
            className="h-full min-h-0 w-full border-0 bg-black"
            resizable={false}
          />
        </EoVideoExpandFloatingFrame>
      ) : null}

      <EoCaptureCollectDialog
        open={collectDialogOpen}
        onClose={closeCollectDialog}
        isUav={Boolean(activeStream?.uav)}
        kind={collectTarget?.kind ?? snapshotPreview?.kind ?? "snapshot"}
        blob={collectTarget?.blob ?? null}
        fileName={collectTarget?.fileName ?? snapshotPreview?.fileName ?? "capture.bin"}
        dataType={eoCollectDataTypeForPreviewKind(collectTarget?.kind ?? snapshotPreview?.kind ?? "snapshot")}
        onStatus={(line) => appendClientLog(`${new Date().toLocaleTimeString()} 采集：${line}`)}
        onSuccess={(repoPath) => {
          appendClientLog(`${new Date().toLocaleTimeString()} 采集上传成功：${repoPath}`);
          toast.success("采集上传成功", { description: repoPath });
        }}
        onError={(msg) => {
          appendClientLog(`${new Date().toLocaleTimeString()} 采集上传失败：${msg}`);
          toast.error("采集上传失败", { description: msg });
        }}
      />

      <EoCalcRecordDialog
        open={calcRecord.dialogOpen}
        onClose={() => calcRecord.setDialogOpen(false)}
        cameraName={calcRecord.cameraName}
        baselineTargetId={calcRecord.baselineTargetId}
        canRecord={calcRecord.canRecord}
        recordBlockReason={calcRecord.recordBlockReason}
        sessionActive={calcRecord.sessionActive}
        canStartSession={calcRecord.canStartSession}
        recording={calcRecord.recording}
        recordSessionLabel={calcRecord.recordSessionLabel}
        rowCount={calcRecord.rowCount}
        pendingSyncCount={calcRecord.pendingSyncCount}
        nfsSynced={calcRecord.nfsSynced}
        syncBusy={calcRecord.syncBusy}
        locationPoints={calcRecord.locationPoints}
        aimSeaBusy={calcRecord.aimSeaBusy}
        aimSkyBusy={calcRecord.aimSkyBusy}
        onToggleRecording={calcRecord.toggleRecording}
        onSyncSession={() => void calcRecord.syncSessionToNfs()}
        onDeleteSession={() => void calcRecord.deleteSession()}
        onSeaAim={() => void calcRecord.requestAimParam(0)}
        onSkyAim={() => void calcRecord.requestAimParam(1)}
        onResetDefault={calcRecord.resetDefaultParams}
        showLocation={() => setCalcRecordLocationOpen(true)}
      />

      <EoPidSettingsDialog
        open={pidSettingsOpen}
        onClose={() => setPidSettingsOpen(false)}
        entityId={cameraDdsEntityId ?? ""}
        backendBaseUrl={taskBackendBaseUrl}
        cameraName={activeStream?.label ?? cameraDdsEntityId ?? ""}
        onClientLog={appendClientLog}
      />
      <EoCalcRecordLocationDialog
        open={calcRecordLocationOpen}
        onClose={() => setCalcRecordLocationOpen(false)}
        points={calcRecord.locationPoints}
      />

    </div>
  );
}

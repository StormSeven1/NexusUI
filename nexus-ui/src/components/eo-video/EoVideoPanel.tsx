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
  createEoVideoRecorder,
  pickRecordMimeAndExtension,
  saveCaptureBlob,
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
  mergeRegistryStreams,
  stripRegistryStreams,
} from "@/lib/eo-video/mergeEoVideoRegistry";
import { canonicalEntityId, parseCameraEntityIdFromStreamId } from "@/lib/camera-entity-id";
import {
  fetchCameraEntityPlayback,
  fetchEntityPlaybackAny,
} from "@/lib/eo-video/resolveCameraEntityPlayback";
import { buildUavZlmSignalingUrl, buildUavZlmStreamKey, getUavZlmWebrtcBaseUrl } from "@/lib/eo-video/buildUavZlmWebrtcUrl";
import { fetchUavPlatformSignalingUrl } from "@/lib/eo-video/resolveUavLiveByPlatform";
import { fetchResolvedUavPlaybackIds } from "@/lib/eo-video/resolveUavPlaybackByEntity";
import type { EoDetectionBox, EoVideoStreamEntry, EoVideoStreamsConfig } from "@/lib/eo-video/types";
import { postUavControlAction, type UavControlAction } from "@/lib/eo-video/uavControlClient";
import { pokeDroneLiveStream } from "@/lib/eo-video/pokeDroneLiveStream";
import { resolveEoPipPlaybackUrl } from "@/lib/eo-video/resolveEoPipPlaybackUrl";
import { useEoVideoDdsTaskLine } from "@/hooks/useEoVideoDdsTaskLine";
import { blobToBase64DataOnly } from "@/lib/eo-video/blobToBase64";
import { Button } from "@/components/ui/button";
import { Joystick, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useVlmChatInjectStore } from "@/stores/vlm-chat-inject-store";
import { toast } from "sonner";
import { EoUavConsoleDock } from "./EoUavConsoleDock";
import { EoPipFloatingPlayer } from "./EoPipFloatingPlayer";
import { EoStreamContextMenu } from "./EoStreamContextMenu";
import { EoVideoBottomFloater } from "./EoVideoBottomFloater";
import { EoVideoFloatingTools } from "./EoVideoFloatingTools";
import { EoVideoPlayStage } from "./EoVideoPlayStage";
import { EoVideoPtzPanel } from "./EoVideoPtzPanel";
import type { EoVideoTaskTrace } from "./EoVideoTaskTracePanel";
import { EoVideoTaskTracePanel } from "./EoVideoTaskTracePanel";
import { EoSnapshotPreviewPopout, type EoSnapshotPreviewPayload } from "./EoSnapshotPreviewPopout";
import { useAppConfigStore } from "@/stores/app-config-store";
import { getDefaultEoCameraTaskBackendBaseUrl } from "@/lib/map-app-config";

export interface EoVideoPanelProps {
  configUrl?: string;
  /** 与 base-vue 一致：实体 id 优先，走 `/api/entity-v1/{id}` + 检测 WS */
  entityId?: string;
  className?: string;
  /** 底部拖拽条调节整体高度（约 200–920px） */
  resizable?: boolean;
}

function isCameraEntityId(id: string): boolean {
  return /^camera_[0-9]{3}$/i.test(id);
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
/** 已有画面则不调私有云推流；黑屏超时后再发 poke（对齐现场「仅在拉不到时再推」） */
const BLACK_SCREEN_LIVE_POKE_MS = 5000;

export function EoVideoPanel({
  configUrl = "/config/eo-video.streams.json",
  entityId,
  className,
  resizable = true,
}: EoVideoPanelProps) {
  const [cfg, setCfg] = useState<EoVideoStreamsConfig | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [activeStreamId, setActiveStreamId] = useState("");
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
  const captureDirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [captureFolderLabel, setCaptureFolderLabel] = useState("");
  const [ptzPanelOpen, setPtzPanelOpen] = useState(false);
  /** 无人机：右侧手柄与相机 PTZ 同类，收起时隐藏罗盘/机场与机体状态/QWEASD 与动作面板 */
  const [uavDockExpanded, setUavDockExpanded] = useState(true);
  /** 应用内右上画中画（独立 WebRTC；与浏览器原生 video 悬浮条无关） */
  const [pipOpen, setPipOpen] = useState(false);
  const [pipStreamId, setPipStreamId] = useState("");
  const [pipSignalingUrl, setPipSignalingUrl] = useState("");
  const [pipResolving, setPipResolving] = useState(false);
  const [pipErr, setPipErr] = useState<string | null>(null);
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
  const snapshotPreviewRef = useRef<EoSnapshotPreviewPayload | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [uavPlaySignalingUrl, setUavPlaySignalingUrl] = useState<string | null>(null);
  const [uavPlayLoading, setUavPlayLoading] = useState(false);
  const [uavPlayErr, setUavPlayErr] = useState<string | null>(null);
  const [uavResolveDebug, setUavResolveDebug] = useState<string>("");
  const uavDebugLoggedRef = useRef("");
  const uavPlayLoggedRef = useRef("");
  const uavUrlsRef = useRef<{ dock: string; air: string } | null>(null);
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
    return () => {
      const u = snapshotPreviewRef.current?.objectUrl;
      if (u) URL.revokeObjectURL(u);
    };
  }, []);

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
      const h = await loadCaptureDirHandle();
      if (cancelled || !h) return;
      captureDirHandleRef.current = h;
      setCaptureFolderLabel(h.name);
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
    setUavDockExpanded(true);
  }, [activeStreamId]);

  useEffect(() => {
    return () => {
      recorderCtlRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const onSynced = () => {
      void (async () => {
        const cams = await fetchCameraRegistryFromPublic();
        const devs = await fetchDroneDevicesFromPublic();
        setCfg((prev) => {
          if (!prev) return prev;
          try {
            return mergeRegistryStreams(stripRegistryStreams(prev), cams, devs);
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
        await fetch("/api/eo-drone-registry/sync", { method: "POST" }).catch(() => {});
        if (cancelled) return;
        const cameras = await fetchCameraRegistryFromPublic();
        const devices = await fetchDroneDevicesFromPublic();

        if (entity) {
          const p = await fetchCameraEntityPlayback(entity);
          if (cancelled) return;

          const buildCfg = (zOthersStreams: EoVideoStreamEntry[]): EoVideoStreamsConfig => {
            const streamsMap = new Map<string, EoVideoStreamEntry>();
            streamsMap.set(entity, {
              id: entity,
              label: p.label,
              signalingUrl: p.signalingUrl,
            });
            for (const s of zOthersStreams) streamsMap.set(s.id, s);
            const streams = Array.from(streamsMap.values());
            const base: EoVideoStreamsConfig = {
              defaultStreamId: entity,
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
            return mergeRegistryStreams(base, cameras, devices);
          };

          // 先出首屏：避免 /api/eo-webrtc-sources 慢或挂起时长时间卡在「正在加载光电配置」
          setCfg(buildCfg([]));
          setActiveStreamId(entity);
          setLoadErr(null);

          void loadZOthersWebRtcSources()
            .then((zOthersStreams) => {
              if (cancelled) return;
              setCfg(buildCfg(zOthersStreams));
            })
            .catch(() => {
              /* 附加源失败不影响当前实体流 */
            });
          return;
        }

        const c = await loadEoVideoConfig(configUrl);
        if (cancelled) return;
        setCfg(mergeRegistryStreams(c, cameras, devices));
        setActiveStreamId(c.defaultStreamId);
        setLoadErr(null);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configUrl, entity]);

  const activeStream = useMemo(
    () => cfg?.streams.find((s) => s.id === activeStreamId) ?? cfg?.streams[0],
    [cfg, activeStreamId],
  );

  /**
   * 检测 WS / 画框仅绑定「当前正在看的流」。
   * 不可在无法从 streamId 解析相机时仍用页面 entity 兜底：光电页 entity 常为 camera_xxx，
   * 切到无人机后仍会订阅相机检测，框会叠在无人机画面上。
   */
  const detectionEntityId = useMemo(() => {
    /** 勿用 activeStream 的 streams[0] 回退判断 uav：失配时会错把相机检测关掉或反过来 */
    if (cfg?.streams.find((s) => s.id === activeStreamId)?.uav) return undefined;
    const sid = activeStreamId.trim();
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

  const detectionEnabled = Boolean(detectionEntityId && cfg);
  const ptzSupported = Boolean(detectionEntityId && /^camera_[0-9]{3}$/i.test(detectionEntityId));

  /** 底部条右侧：相机 DDS（Camera WS 旁路）/ 无人机航线与状态 */
  const ddsBottomTaskLine = useEoVideoDdsTaskLine({
    variant: activeStream?.uav ? "uav" : "camera",
    cameraEntityId: detectionEntityId,
    droneSn: activeStream?.uav?.deviceSN ?? uavMqttProductIds?.device ?? null,
  });

  useEffect(() => {
    if (!ptzSupported) setPtzPanelOpen(false);
  }, [ptzSupported]);

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

  const { droneInDock: mqttDroneInDock, mqttAirportLatLon, mqttTelemetry, mqttHud, publishStickControl } = useUavMqttDockState({
    enabled: Boolean(activeStream?.uav && mqttWsUrl && (mqttAirportSn || mqttDeviceSn)),
    airportSN: mqttAirportSn,
    deviceSN: mqttDeviceSn,
    wsUrl: mqttWsUrl || null,
    mqttUsername: mqttWsAuthUser ?? null,
    mqttPassword: mqttWsAuthPass ?? null,
  });

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
      setUavMqttProductIds(null);
      setUavPlaySignalingUrl(null);
      setUavPlayLoading(false);
      setUavPlayErr(null);
      setUavResolveDebug("");
      return;
    }
    let cancelled = false;
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
        uavUrlsRef.current = urls;

        // 舱内/舱外切换仅由下方 MQTT effect 驱动，避免本异步与 mqtt 状态竞态导致起飞后仍卡机场
        setUavPlaySignalingUrl(urls.dock || urls.air || "");
      } catch (e) {
        if (!cancelled) {
          setUavPlayErr(e instanceof Error ? e.message : String(e));
          setUavPlaySignalingUrl(null);
          setUavResolveDebug((prev) => prev || "uav resolve failed before url ready");
        }
      } finally {
        if (!cancelled) setUavPlayLoading(false);
      }
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
  ]);

  useEffect(() => {
    const urls = uavUrlsRef.current;
    if (!activeStream?.uav || !urls) return;
    if (mqttDroneInDock === null) {
      if (urls.dock) setUavPlaySignalingUrl(urls.dock);
      return;
    }
    setUavPlaySignalingUrl(mqttDroneInDock ? urls.dock : (urls.air || urls.dock));
  }, [mqttDroneInDock, activeStream?.uav, activeStreamId]);

  useEffect(() => {
    const s = activeStream;
    if (!s || s.uav) {
      setCameraResolvedUrl(null);
      setCameraResolveLoading(false);
      setCameraResolveErr(null);
      return;
    }
    const needDeferred =
      s.registrySource === "camera" ||
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
  }, [activeStream, activeStreamId]);

  const playSignalingUrl = (() => {
    if (!activeStream) return "";
    if (activeStream.uav) return uavPlaySignalingUrl ?? "";
    if (cameraResolvedUrl) return cameraResolvedUrl;
    return activeStream.signalingUrl ?? "";
  })();

  const pipStreamLabel = useMemo(() => {
    if (!cfg || !pipStreamId) return "";
    return cfg.streams.find((s) => s.id === pipStreamId)?.label ?? pipStreamId;
  }, [cfg, pipStreamId]);

  const togglePip = useCallback(() => {
    setPipOpen((was) => {
      const next = !was;
      if (next && activeStreamId) setPipStreamId(activeStreamId);
      return next;
    });
  }, [activeStreamId]);

  useEffect(() => {
    if (!pipOpen || !cfg || !pipStreamId.trim()) {
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
  ]);

  const showCameraLoadingGate =
    !activeStream?.uav &&
    Boolean(activeStream) &&
    (activeStream?.registrySource === "camera" ||
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
    setActiveStreamId(id);
  }, []);

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

  /** 流已在推送时画面已出帧，不发私有云 poke；超时仍黑时再发（对齐 WatchSys 「先播再兜底」） */
  useEffect(() => {
    if (!activeStream?.uav) return;
    if (!uavPlaySignalingUrl?.trim()) return;
    if (uavPlayLoading) return;
    if (uavPlayErr) return;

    const tid = window.setTimeout(() => {
      const el = videoRef.current;
      if (!el || (el.videoWidth > 0 && el.videoHeight > 0)) return;

      const uv = activeStream?.uav;
      if (!uv) return;
      const ap = (mqttAirportSn ?? uv.airportSN ?? "").trim();
      const dr = (mqttDeviceSn ?? uv.deviceSN ?? "").trim();
      const mainPayload = dr === "1581F6QAD241200BWX4E" ? DRONE_MAIN_PAYLOAD_SPECIAL : DRONE_MAIN_PAYLOAD;

      void (async () => {
        const [dockRes, airRes] = await Promise.allSettled([
          ap ? pokeDroneLiveStream(ap, AIRPORT_FPV_PAYLOAD) : Promise.resolve(undefined),
          dr ? pokeDroneLiveStream(dr, mainPayload) : Promise.resolve(undefined),
        ]);
        const fmt = (
          settled: PromiseSettledResult<{ ok?: boolean; detail?: string } | undefined>,
        ): string =>
          settled.status === "fulfilled"
            ? settled.value?.ok === false
              ? settled.value.detail ?? "fail"
              : "sent"
            : settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason);
        appendClientLog(
          `${new Date().toLocaleTimeString()} 黑屏超 ${BLACK_SCREEN_LIVE_POKE_MS}ms → 私有云推流唤醒 dock=${fmt(
            dockRes as PromiseSettledResult<{ ok?: boolean; detail?: string } | undefined>,
          )} · air=${fmt(
            airRes as PromiseSettledResult<{ ok?: boolean; detail?: string } | undefined>,
          )}`,
        );
      })();
    }, BLACK_SCREEN_LIVE_POKE_MS);

    return () => window.clearTimeout(tid);
  }, [
    activeStream,
    activeStreamId,
    appendClientLog,
    mqttAirportSn,
    mqttDeviceSn,
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
    async (action: UavControlAction) => {
      if (!mqttAirportSn) {
        appendClientLog(`${new Date().toLocaleTimeString()} 无法执行 ${action}：缺少 airportSN`);
        return;
      }
      if (action === "takeoff" && !mqttAirportLatLon) {
        appendClientLog(
          `${new Date().toLocaleTimeString()} 无法起飞：尚未从 MQTT 解析到机场经纬（请确认已订阅 thing/product/{SN}/state|osd 且报文含 data.latitude/longitude）`,
        );
        return;
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
        if (!ret.ok) {
          appendClientLog(`${new Date().toLocaleTimeString()} 无人机控制 ${action} 失败`);
          showUavBottomFeedback(`控制失败：${action}`, "error");
          return;
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
        showUavBottomFeedback(`${action} 指令已发送`, "success");
      } catch (e) {
        appendClientLog(
          `${new Date().toLocaleTimeString()} 无人机控制 ${action} 异常：${e instanceof Error ? e.message : String(e)}`,
        );
        showUavBottomFeedback(`${action} 异常`, "error");
      } finally {
        setUavActionBusy((prev) => ({ ...prev, [action]: false }));
      }
    },
    [appendClientLog, mqttAirportLatLon, mqttAirportSn, mqttDeviceSn, showUavBottomFeedback],
  );

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

  // 键盘手控（对应 C++ ptzmainwidget keyPressEvent/keyReleaseEvent + mainwindow slot_onUavStartCtrl）
  const { keyState, isControlling } = useUavKeyboardControl({
    enabled: Boolean(activeStream?.uav),
    airportSN: mqttAirportSn,
    hasAuth: uavCtrlAuth.hasAuth,
    publishStickMqtt: publishStickControl,
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
      const dir = await pickCaptureDirectoryHandle();
      await saveCaptureDirHandle(dir);
      captureDirHandleRef.current = dir;
      setCaptureFolderLabel(dir.name);
      appendClientLog(`${new Date().toLocaleTimeString()} 已绑定本机保存文件夹「${dir.name}」，截图/录屏将直接写入该目录`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      appendClientLog(`${new Date().toLocaleTimeString()} 选择文件夹失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [appendClientLog]);

  const handleClearCaptureLocalFolder = useCallback(async () => {
    await clearCaptureDirHandle();
    captureDirHandleRef.current = null;
    setCaptureFolderLabel("");
    appendClientLog(`${new Date().toLocaleTimeString()} 已清除本机保存文件夹绑定（将改回浏览器下载）`);
  }, [appendClientLog]);

  const dismissSnapshotPreview = useCallback(() => {
    setSnapshotPreview((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  }, []);

  const onSnapshotCollectStub = useCallback(async () => {
    appendClientLog(`${new Date().toLocaleTimeString()} 采集：（功能预留）`);
  }, [appendClientLog]);

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
    useVlmChatInjectStore.getState().scheduleVlmExchange({
      userText: "请对下面图片进行",
      imageUrl: p.objectUrl,
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
    const v = videoRef.current;
    if (!v) return;
    const name = buildEoCaptureFilename({
      configuredPath: snapshotSavePath,
      streamLabel: activeStream?.label,
      kind: "snapshot",
      ext: "png",
    });
    try {
      const blob = await captureEoPlaybackToPngBlob(v, snapshotCanvasRef.current);
      try {
        const mode = await saveCaptureBlob(blob, name, captureDirHandleRef.current);
        appendClientLog(
          `${new Date().toLocaleTimeString()} ${
            mode === "directory" ? `截图已保存到本机文件夹：${name}` : `截图已保存（下载）：${name}`
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
          objectUrl: URL.createObjectURL(blob),
          blob,
          fileName: name,
        };
      });
    } catch (e) {
      appendClientLog(`${new Date().toLocaleTimeString()} 截图失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeStream?.label, appendClientLog, snapshotSavePath]);

  const handleToggleRecord = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (recorderCtlRef.current?.isRecording()) {
      recorderCtlRef.current.stop();
      return;
    }
    const { mimeType, ext } = pickRecordMimeAndExtension();
    const name = buildEoCaptureFilename({
      configuredPath: recordSavePath,
      streamLabel: activeStream?.label,
      kind: "record",
      ext,
    });
    const ctl = createEoVideoRecorder({
      video: v,
      fileName: name,
      mimeType,
      onSaveBlob: async (blob, suggested) => {
        const extFromBlob = blob.type.includes("mp4") ? "mp4" : blob.type.includes("webm") ? "webm" : ext;
        const base = suggested.replace(/\.(mp4|webm)$/i, "");
        const finalName = `${base}.${extFromBlob}`;
        const mode = await saveCaptureBlob(blob, finalName, captureDirHandleRef.current);
        appendClientLog(
          `${new Date().toLocaleTimeString()} ${
            mode === "directory" ? `录屏已写入本机文件夹：${finalName}` : `录屏已触发下载：${finalName}`
          }`,
        );
      },
      onError: (msg) => {
        appendClientLog(`${new Date().toLocaleTimeString()} 录屏：${msg}`);
        setIsRecording(false);
        recorderCtlRef.current = null;
      },
      onStarted: () => {
        setIsRecording(true);
        appendClientLog(
          `${new Date().toLocaleTimeString()} 录屏开始 → 容器 ${ext.toUpperCase()}${ext === "webm" ? "（当前浏览器不支持 MP4 录制）" : ""}，将保存为 ${name}`,
        );
      },
      onStopped: () => {
        setIsRecording(false);
        recorderCtlRef.current = null;
      },
    });
    recorderCtlRef.current = ctl;
    ctl.start();
  }, [activeStream?.label, appendClientLog, recordSavePath]);

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
      style={
        panelHeightPx != null
          ? { height: panelHeightPx, maxHeight: "min(92vh, 960px)" }
          : undefined
      }
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-none border border-white/[0.06] bg-black/60",
        panelHeightPx != null && "shrink-0",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <EoStreamContextMenu config={cfg} activeStreamId={activeStreamId} onSelectStream={onSelectStream}>
          <div className="flex min-h-0 flex-1 flex-col">
            {activeStream?.uav ? (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/85">
                {uavPlayLoading || !uavPlaySignalingUrl || uavPlayErr ? (
                  <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-3 py-6 text-center text-[11px] text-nexus-text-muted">
                    {uavPlayErr ?? (uavPlayLoading ? "正在解析无人机视频地址…" : "等待无人机流…")}
                    {mqttWsUrl
                      ? ` · MQTT：${mqttDroneInDock === null ? "未收到舱状态" : mqttDroneInDock ? "舱内→机场画面" : "舱外→主摄"}`
                      : platformMqtt.status === "loading" && !mqttWsUrlFromEnv
                        ? " · MQTT：正在从私有云获取地址…"
                        : " · MQTT：无可用 WebSocket 地址，无法自动舱内/外切换"}
                    {uavResolveDebug ? ` · ${uavResolveDebug}` : ""}
                  </div>
                ) : (
                  <EoVideoPlayStage
                    className="absolute inset-0 min-h-0"
                    stageRef={wrapRef}
                    signalingUrl={playSignalingUrl}
                    iceServers={cfg.iceServers}
                    streamLabel={activeStream.label}
                    videoRef={videoRef}
                    peerConnectionRef={peerConnectionRef}
                    exposePeerForDetection={Boolean(detectionEntityId)}
                    entityId={detectionEntityId}
                    detectionEnabled={detectionEnabled}
                    onDetectionDiagnostic={handleDetectionDiagnostic}
                    selectedBoxId={selectedBoxId}
                    onSelectBox={setSelectedBoxId}
                    taskBackendBaseUrl={taskBackendBaseUrl}
                    onSaveTaskBackendBaseUrl={onSaveTaskBackendBaseUrl}
                    onSingleTrackTask={onSingleTrackTask}
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
                    uavCameraAim={uavCameraAimUi}
                  />
                )}
                <div className="pointer-events-none absolute inset-0 z-30">
                  <div className="pointer-events-none absolute right-2 top-1/2 flex max-h-[min(88vh,560px)] -translate-y-1/2 flex-col items-end justify-center gap-2">
                    {/* 无人机控制授权（对应 C++ m_pCameraRootBtn），与右侧悬浮工具同尺寸方钮 */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
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
                      className={cn(
                        "pointer-events-auto border bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
                        uavCtrlAuth.hasAuth
                          ? "border-sky-400/45 bg-sky-950/50 text-sky-200 hover:border-sky-400/55 hover:bg-sky-900/65 hover:text-sky-50"
                          : "border-white/25 text-white/85",
                        uavCtrlAuth.busy || !mqttAirportSn ? "cursor-not-allowed opacity-50" : "",
                        isControlling ? "ring-2 ring-sky-400/45" : "",
                      )}
                    >
                      {uavCtrlAuth.busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Joystick className="size-3.5" />
                      )}
                    </Button>
                    <div className="pointer-events-auto flex flex-row items-center gap-2">
                      {snapshotPreview ? (
                        <EoSnapshotPreviewPopout
                          key={snapshotPreview.objectUrl}
                          preview={snapshotPreview}
                          onDismiss={dismissSnapshotPreview}
                          onCollect={onSnapshotCollectStub}
                          onAnalyze={onSnapshotAnalyze}
                        />
                      ) : null}
                      <EoVideoFloatingTools
                        className="pointer-events-auto"
                        variant="uav"
                        uavDockExpanded={uavDockExpanded}
                        onToggleUavDock={() => setUavDockExpanded((v) => !v)}
                        pipOpen={pipOpen}
                        onTogglePip={togglePip}
                        captureReady={captureReady}
                        isRecording={isRecording}
                        onSnapshot={handleSnapshot}
                        onToggleRecord={handleToggleRecord}
                        onUavClientLog={appendClientLog}
                      />
                    </div>
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
                  <div className="pointer-events-auto shrink-0">
                    <EoVideoBottomFloater
                      variant="uav"
                      streamLabel={activeStream.label}
                      taskLine={ddsBottomTaskLine}
                      centerLine={uavBottomFeedback?.text}
                      centerTone={uavBottomFeedback?.tone}
                    />
                  </div>
                </div>
                <EoPipFloatingPlayer
                  key={`eo-pip-${pipStreamId || activeStreamId}`}
                  open={pipOpen && Boolean(activeStream)}
                  config={cfg}
                  iceServers={cfg.iceServers}
                  pipStreamId={pipStreamId || activeStreamId}
                  onSelectPipStream={setPipStreamId}
                  signalingUrl={pipSignalingUrl}
                  loading={pipResolving}
                  error={pipErr}
                  streamLabel={pipStreamLabel}
                />
              </div>
            ) : (
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/85">
                  {showCameraLoadingGate ? (
                    <div className="flex h-full min-h-[200px] flex-1 items-center justify-center px-3 text-center text-[11px] text-nexus-text-muted">
                      {cameraResolveErr ??
                        (cameraResolveLoading ? "正在解析光电相机流地址…" : "等待相机流…")}
                    </div>
                  ) : (
                    <EoVideoPlayStage
                    stageRef={wrapRef}
                    signalingUrl={playSignalingUrl}
                    iceServers={cfg.iceServers}
                    streamLabel={activeStream.label}
                    videoRef={videoRef}
                    peerConnectionRef={peerConnectionRef}
                    exposePeerForDetection={Boolean(detectionEntityId)}
                    entityId={detectionEntityId}
                    detectionEnabled={detectionEnabled}
                    onDetectionDiagnostic={handleDetectionDiagnostic}
                    selectedBoxId={selectedBoxId}
                    onSelectBox={setSelectedBoxId}
                    taskBackendBaseUrl={taskBackendBaseUrl}
                    onSaveTaskBackendBaseUrl={onSaveTaskBackendBaseUrl}
                    onSingleTrackTask={onSingleTrackTask}
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
                    />
                  )}
                  <div className="pointer-events-none absolute inset-0 z-30">
                    <div className="pointer-events-none absolute right-2 top-1/2 flex max-h-[min(88vh,560px)] -translate-y-1/2 flex-col items-end justify-center gap-2">
                      <EoVideoFloatingTools
                        className="pointer-events-auto"
                        variant="camera"
                        ptzSupported={ptzSupported}
                        ptzPanelOpen={ptzPanelOpen}
                        onTogglePtzPanel={() => setPtzPanelOpen((v) => !v)}
                        pipOpen={pipOpen}
                        onTogglePip={togglePip}
                        captureReady={captureReady}
                        isRecording={isRecording}
                        onSnapshot={handleSnapshot}
                        onToggleRecord={handleToggleRecord}
                      />
                      {snapshotPreview ? (
                        <EoSnapshotPreviewPopout
                          key={snapshotPreview.objectUrl}
                          preview={snapshotPreview}
                          onDismiss={dismissSnapshotPreview}
                          onCollect={onSnapshotCollectStub}
                          onAnalyze={onSnapshotAnalyze}
                        />
                      ) : null}
                    </div>
                  </div>
                  {/* 云台横条单行避让右侧工具；底栏本体全宽贴底（勿与云台共用外层 pl/pr/pb） */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] flex max-h-[min(58vh,420px)] flex-col justify-end gap-1 px-0 pb-0 pt-10">
                    {ptzPanelOpen && ptzSupported && detectionEntityId ? (
                      <div className="pointer-events-auto flex w-full shrink-0 justify-end pl-2 pr-14 pb-px max-sm:pr-3">
                        <EoVideoPtzPanel
                          entityId={detectionEntityId}
                          backendBaseUrl={taskBackendBaseUrl}
                          onClientLog={appendClientLog}
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
                    open={pipOpen && Boolean(activeStream)}
                    config={cfg}
                    iceServers={cfg.iceServers}
                    pipStreamId={pipStreamId || activeStreamId}
                    onSelectPipStream={setPipStreamId}
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
      {resizable ? (
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
      <EoVideoTaskTracePanel
        trace={taskTrace}
        clientEcho={clientEcho}
        uavMqttStatus={uavMqttFooterLine || undefined}
        detectionWsLine={
          detectionEntityId && detectionDiag.trim() ? detectionDiag : undefined
        }
        detectionWsTitle={
          detectionEntityId && detectionDiagHover.trim() ? detectionDiagHover : undefined
        }
      />

    </div>
  );
}

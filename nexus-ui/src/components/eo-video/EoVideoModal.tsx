"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraIcon, ChevronRight, Loader2, Video } from "lucide-react";
import { EoDetectionOverlay } from "@/components/eo-video/EoDetectionOverlay";
import { EoVideoViewport } from "@/components/eo-video/EoVideoViewport";
import { DraggableModal } from "@/components/ui/DraggableModal";
import { Button } from "@/components/ui/button";
import { useEoSyncedDetections } from "@/hooks/useEoSyncedDetections";
import { getHttpConfig } from "@/lib/map-app-config";
import { useAppConfigStore } from "@/stores/app-config-store";
import { useAssetStore, type AssetData } from "@/stores/asset-store";
import { useAppStore } from "@/stores/app-store";
import {
  buildCaptureFileName,
  capturePlaybackToPngBlob,
  createVideoRecorder,
  pickRecordMimeAndExtension,
  saveCaptureBlobToServer,
  type EoVideoRecordController,
} from "@/lib/eo-video/capture";
import { createEoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { EoRuntimeStream, EoVideoIceServer } from "@/lib/eo-video/types";
import { signalingUrlFromWebrtcUrl } from "@/lib/eo-video/buildSignalingUrl";

const DEFAULT_ICE_SERVERS: EoVideoIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const STREAM_GROUPS = [
  { id: "camera", label: "\u76f8\u673a" },
  { id: "drone", label: "\u65e0\u4eba\u673a" },
] as const;
const STREAM_MENU_WIDTH = 384;
const STREAM_MENU_HEIGHT = 360;

type StreamGroupId = (typeof STREAM_GROUPS)[number]["id"];
type GroupedRuntimeStream = EoRuntimeStream & { groupId: StreamGroupId };

function readStringProperty(properties: Record<string, unknown> | null | undefined, key: string): string {
  if (!properties) return "";
  const value = properties[key];
  return typeof value === "string" ? value.trim() : "";
}

function streamGroupForAsset(asset: AssetData, properties: Record<string, unknown> | null): StreamGroupId {
  const assetType = String(asset.asset_type ?? "").trim().toLowerCase();
  if (assetType === "drone" || assetType === "uav") return "drone";
  const hint = [
    asset.id,
    asset.name,
    asset.asset_type,
    properties?.assetType,
    properties?.asset_type,
    properties?.specificType,
    properties?.specific_type,
    properties?.type,
    properties?.config_kind,
    properties?.deviceSn,
    properties?.device_sn,
  ]
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (hint.includes("drone") || hint.includes("uav") || hint.includes("\u65e0\u4eba\u673a")) return "drone";
  return "camera";
}

function toRuntimeStream(asset: AssetData): GroupedRuntimeStream | null {
  const properties =
    asset.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const sensorVideoUrl = readStringProperty(properties, "sensor_video_url");
  if (!sensorVideoUrl) return null;
  return {
    id: asset.id,
    label: asset.name || asset.id,
    entityId: asset.id,
    sensorVideoUrl,
    groupId: streamGroupForAsset(asset, properties),
  };
}

function detectionEntityIdFromAsset(asset: AssetData | null | undefined): string {
  return asset?.id?.trim() ?? "";
}

function toPlaybackUrl(sensorVideoUrl: string): string {
  if (!sensorVideoUrl.trim()) {
    throw new Error("Missing sensor video url from realtime entity");
  }
  if (sensorVideoUrl.startsWith("webrtc://")) {
    return signalingUrlFromWebrtcUrl(sensorVideoUrl);
  }
  if (sensorVideoUrl.includes("/index/api/webrtc")) {
    return sensorVideoUrl;
  }
  if (sensorVideoUrl.startsWith("rtsp://") || sensorVideoUrl.startsWith("rtsps://")) {
    throw new Error(`Current EO player does not support direct RTSP playback: ${sensorVideoUrl}`);
  }
  throw new Error(`Unsupported stream url format: ${sensorVideoUrl.slice(0, 120)}`);
}

function buildBackendCaptureUrl(): string {
  const backendUrl = getHttpConfig().backendUrl.trim();
  if (!backendUrl) {
    throw new Error("Missing backendUrl in app-config");
  }
  return `${backendUrl.replace(/\/+$/, "")}/api/eo-video/capture/save`;
}

function readTargetDomainLabel(asset: AssetData | null): string {
  const props =
    asset?.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const candidates = [
    props?.targetType,
    props?.target_type,
    props?.currentTargetType,
    props?.current_target_type,
    props?.missionTargetType,
    props?.mission_target_type,
    props?.mode,
    props?.taskMode,
    props?.task_mode,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim().toLowerCase();
    if (!text) continue;
    if (text === "1" || text.includes("air") || text.includes("\u5bf9\u7a7a") || text.includes("uav")) return "\u5bf9\u7a7a";
    if (text === "0" || text.includes("sea") || text.includes("\u5bf9\u6d77") || text.includes("ship")) return "\u5bf9\u6d77";
  }
  return "\u7a7a\u95f2\u4e2d";
}

export function EoVideoModal() {
  const appConfigStatus = useAppConfigStore((s) => s.status);
  const assets = useAssetStore((s) => s.assets);
  const open = useAppStore((s) => s.eoVideoModalOpen);
  const setOpen = useAppStore((s) => s.setEoVideoModalOpen);
  const runtimeStreams = useMemo(
    () => assets.map(toRuntimeStream).filter((item): item is GroupedRuntimeStream => Boolean(item)),
    [assets],
  );
  const streamGroups = useMemo(
    () =>
      STREAM_GROUPS.map((group) => ({
        ...group,
        streams: runtimeStreams.filter((stream) => stream.groupId === group.id),
      })),
    [runtimeStreams],
  );
  const [activeStreamId, setActiveStreamId] = useState("");
  const [activeMenuGroupId, setActiveMenuGroupId] = useState<StreamGroupId>("camera");
  const [, setCaptureHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<"snapshot" | "record" | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const [overlayIntrinsic, setOverlayIntrinsic] = useState({ width: 0, height: 0 });
  const captureReadyRef = useRef(false);
  const overlayIntrinsicRef = useRef({ width: 0, height: 0 });
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const videoReceiverRef = useRef<RTCRtpReceiver | null>(null);
  const webCodecsPresentationRef = useRef<EoWebCodecsPresentation>({
    active: false,
    width: 0,
    height: 0,
    canvas: null,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const recordControllerRef = useRef<EoVideoRecordController | null>(null);
  const encodedSyncHub = useMemo(() => createEoEncodedSyncHub(), []);

  useEffect(() => {
    if (appConfigStatus === "idle") {
      void useAppConfigStore.getState().ensureLoaded();
    }
  }, [appConfigStatus]);

  useEffect(() => {
    if (!runtimeStreams.length) {
      setActiveStreamId("");
      return;
    }
    setActiveStreamId((prev) => {
      if (prev && runtimeStreams.some((item) => item.id === prev)) return prev;
      return runtimeStreams[0]?.id ?? "";
    });
  }, [runtimeStreams]);

  useEffect(() => {
    return () => {
      recordControllerRef.current?.stop();
    };
  }, []);

  const activeStream = useMemo(
    () => runtimeStreams.find((item) => item.id === activeStreamId) ?? runtimeStreams[0] ?? null,
    [activeStreamId, runtimeStreams],
  );
  const activeAsset = useMemo(
    () => assets.find((item) => item.id === activeStream?.id) ?? null,
    [activeStream, assets],
  );
  const targetDomainLabel = useMemo(() => readTargetDomainLabel(activeAsset), [activeAsset]);
  const activeMenuGroup = useMemo(
    () => streamGroups.find((group) => group.id === activeMenuGroupId) ?? streamGroups[0],
    [activeMenuGroupId, streamGroups],
  );
  const activeStreamGroupId = activeStream?.groupId;

  useEffect(() => {
    if (!activeStreamGroupId || contextMenu.open) return;
    setActiveMenuGroupId(activeStreamGroupId);
  }, [activeStreamGroupId, contextMenu.open]);

  const playbackState = useMemo(() => {
    if (!activeStream) {
      return { playbackUrl: "", error: "等待后端实体实时数据..." };
    }
    try {
      return { playbackUrl: toPlaybackUrl(activeStream.sensorVideoUrl), error: null as string | null };
    } catch (error) {
      return { playbackUrl: "", error: error instanceof Error ? error.message : String(error) };
    }
  }, [activeStream]);

  const backendState = useMemo(() => {
    if (appConfigStatus !== "ready") {
      return {
        captureSaveUrl: "",
        error: "App config is still loading",
      };
    }
    try {
      return {
        captureSaveUrl: buildBackendCaptureUrl(),
        error: null as string | null,
      };
    } catch (error) {
      return {
        captureSaveUrl: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [appConfigStatus]);

  const detection = useEoSyncedDetections({
    entityId: detectionEntityIdFromAsset(activeAsset),
    enabled: open && Boolean(activeStream) && !backendState.error,
    encodedSyncHub,
    videoIntrinsicWidth: overlayIntrinsic.width,
    videoIntrinsicHeight: overlayIntrinsic.height,
    videoRef,
  });

  useEffect(() => {
    const syncReady = () => {
      const video = videoRef.current;
      const videoReady = Boolean(video && video.videoWidth > 0 && video.videoHeight > 0);
      const canvasReady = Boolean(
        webCodecsPresentationRef.current.active &&
          webCodecsPresentationRef.current.width > 0 &&
          webCodecsPresentationRef.current.height > 0 &&
          webCodecsPresentationRef.current.canvas,
      );
      const nextCaptureReady = videoReady || canvasReady;
      if (captureReadyRef.current !== nextCaptureReady) {
        captureReadyRef.current = nextCaptureReady;
        setCaptureReady(nextCaptureReady);
      }
      if (canvasReady) {
        const { width, height } = webCodecsPresentationRef.current;
        if (overlayIntrinsicRef.current.width !== width || overlayIntrinsicRef.current.height !== height) {
          const next = { width, height };
          overlayIntrinsicRef.current = next;
          setOverlayIntrinsic(next);
        }
        return;
      }
      if (overlayIntrinsicRef.current.width !== 0 || overlayIntrinsicRef.current.height !== 0) {
        const next = { width: 0, height: 0 };
        overlayIntrinsicRef.current = next;
        setOverlayIntrinsic(next);
      }
    };
    syncReady();
    const video = videoRef.current;
    video?.addEventListener("loadeddata", syncReady);
    video?.addEventListener("loadedmetadata", syncReady);
    video?.addEventListener("canplay", syncReady);
    video?.addEventListener("playing", syncReady);
    video?.addEventListener("resize", syncReady);
    const timer = window.setInterval(syncReady, 300);
    return () => {
      video?.removeEventListener("loadeddata", syncReady);
      video?.removeEventListener("loadedmetadata", syncReady);
      video?.removeEventListener("canplay", syncReady);
      video?.removeEventListener("playing", syncReady);
      video?.removeEventListener("resize", syncReady);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu.open) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
    };
    const closeMenuOnBlur = () => {
      setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("blur", closeMenuOnBlur);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("blur", closeMenuOnBlur);
    };
  }, [contextMenu.open]);

  const contextMenuMaxHeight = Math.max(180, (containerRef.current?.clientHeight ?? 0) - contextMenu.y - 8);

  const onSnapshot = async () => {
    if (!activeStream) {
      setCaptureHint("\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u76f8\u673a\u5b9e\u4f53\u3002");
      return;
    }
    if (!captureReady) {
      setCaptureHint("\u89c6\u9891\u8fd8\u6ca1\u51c6\u5907\u597d\uff0c\u6682\u65f6\u65e0\u6cd5\u622a\u56fe\u3002");
      return;
    }
    if (!backendState.captureSaveUrl) {
      setCaptureHint("\u540e\u7aef\u622a\u56fe\u4fdd\u5b58\u5730\u5740\u4e0d\u53ef\u7528\u3002");
      return;
    }
    setBusy("snapshot");
    try {
      const blob = await capturePlaybackToPngBlob(videoRef.current, webCodecsPresentationRef.current.canvas);
      const fileName = buildCaptureFileName(activeStream.label, "snapshot", "png");
      const savedPath = await saveCaptureBlobToServer(blob, backendState.captureSaveUrl, {
        kind: "snapshot",
        streamLabel: activeStream.label,
        fileName,
      });
      setCaptureHint(`截图已保存: ${savedPath}`);
    } catch (error) {
      setCaptureHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const onToggleRecord = async () => {
    if (!activeStream) {
      setCaptureHint("\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u76f8\u673a\u5b9e\u4f53\u3002");
      return;
    }
    if (!isRecording) {
      if (!videoRef.current) {
        setCaptureHint("\u89c6\u9891\u5143\u7d20\u5c1a\u672a\u5c31\u7eea\uff0c\u6682\u65f6\u65e0\u6cd5\u5f55\u50cf\u3002");
        return;
      }
      if (!backendState.captureSaveUrl) {
        setCaptureHint("\u540e\u7aef\u5f55\u50cf\u4fdd\u5b58\u5730\u5740\u4e0d\u53ef\u7528\u3002");
        return;
      }
      const picked = pickRecordMimeAndExtension();
      const fileName = buildCaptureFileName(activeStream.label, "record", picked.ext);
      recordControllerRef.current = createVideoRecorder({
        video: videoRef.current,
        fileName,
        mimeType: picked.mimeType,
        onSaveBlob: async (blob, savedFileName) => {
          setBusy("record");
          try {
            const savedPath = await saveCaptureBlobToServer(blob, backendState.captureSaveUrl, {
              kind: "record",
              streamLabel: activeStream.label,
              fileName: savedFileName,
            });
            setCaptureHint(`录像已保存: ${savedPath}`);
          } catch (error) {
            setCaptureHint(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(null);
          }
        },
        onError: (message) => setCaptureHint(message),
        onStarted: () => {
          setIsRecording(true);
          setCaptureHint("\u5f00\u59cb\u5f55\u50cf\u3002");
        },
        onStopped: () => {
          setIsRecording(false);
        },
      });
      recordControllerRef.current.start();
      return;
    }

    recordControllerRef.current?.stop();
  };

  const renderContextMenu = contextMenu.open ? (
    <div
      ref={contextMenuRef}
      className="absolute z-[12] flex max-w-[calc(100%-16px)] overflow-visible text-sm text-white shadow-2xl"
      style={{
        left: `${contextMenu.x}px`,
        top: `${contextMenu.y}px`,
        width: `${STREAM_MENU_WIDTH}px`,
        maxHeight: `${contextMenuMaxHeight}px`,
      }}
    >
      <div className="w-44 overflow-hidden rounded-md border border-white/10 bg-[#30313a]/95 py-1 backdrop-blur-md">
        <div className="px-3 py-2 text-xs font-semibold text-cyan-300">视频源</div>
        {streamGroups.map((group) => {
          const selected = group.id === activeMenuGroup?.id;
          return (
            <button
              key={group.id}
              type="button"
              className={`flex h-9 w-full items-center justify-between px-3 text-left transition-colors ${
                selected ? "bg-white/10 text-white" : "text-white/85 hover:bg-white/8 hover:text-white"
              }`}
              onFocus={() => setActiveMenuGroupId(group.id)}
              onMouseEnter={() => setActiveMenuGroupId(group.id)}
              onClick={() => setActiveMenuGroupId(group.id)}
            >
              <span className="min-w-0 truncate">{group.label}</span>
              <span className="ml-2 flex items-center gap-1 text-white/45">
                <span className="text-[10px]">{group.streams.length}</span>
                <ChevronRight size={14} />
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="ml-1 min-w-52 flex-1 overflow-hidden rounded-md border border-white/10 bg-[#292b34]/95 py-1 backdrop-blur-md"
        style={{ maxHeight: `${contextMenuMaxHeight}px` }}
      >
        <div className="max-h-full overflow-y-auto overscroll-contain">
          {activeMenuGroup && activeMenuGroup.streams.length ? (
            activeMenuGroup.streams.map((stream) => {
              const active = stream.id === activeStream?.id;
              return (
                <button
                  key={stream.id}
                  type="button"
                  className={`flex h-9 w-full items-center px-3 text-left transition-colors ${
                    active
                      ? "bg-white/10 font-medium text-white"
                      : "text-white/85 hover:bg-white/8 hover:text-white"
                  }`}
                  onClick={() => {
                    setActiveStreamId(stream.id);
                    setActiveMenuGroupId(stream.groupId);
                    setContextMenu((prev) => ({ ...prev, open: false }));
                  }}
                >
                  <span className="min-w-0 truncate">{stream.label}</span>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-sm text-white/55">暂无视频源</div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <DraggableModal
      open={open}
      onClose={() => setOpen(false)}
      title="光电视频"
      icon={Camera}
      size="auto"
      minWidth={520}
      minHeight={320}
      initialX={260}
      initialY={120}
      className="overflow-hidden"
      headerClassName="px-3 py-2"
      contentClassName="flex min-h-0 flex-1 px-1.5 pb-1.5 pt-1"
    >
      <div className="flex min-h-0 h-full min-w-0 w-full flex-1 flex-col">
        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-[3px] bg-black ring-1 ring-white/10"
          onContextMenu={(event) => {
            event.preventDefault();
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            setActiveMenuGroupId(activeStream?.groupId ?? "camera");
            setContextMenu({
              open: true,
              x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - STREAM_MENU_WIDTH - 8)),
              y: Math.max(8, Math.min(event.clientY - rect.top, rect.height - STREAM_MENU_HEIGHT - 8)),
            });
          }}
        >
          <EoVideoViewport
            signalingUrl={playbackState.playbackUrl}
            iceServers={DEFAULT_ICE_SERVERS}
            enabled={open && Boolean(playbackState.playbackUrl)}
            videoRef={videoRef}
            peerConnectionRef={peerConnectionRef}
            encodedSyncHub={encodedSyncHub}
            videoReceiverRef={videoReceiverRef}
            webCodecsPresentationRef={webCodecsPresentationRef}
          />

          <div className="pointer-events-none absolute left-3 top-3 z-[6] rounded-md bg-black/55 px-2.5 py-1 text-xs font-medium text-white/95 backdrop-blur-sm">
            当前目标: {targetDomainLabel}
          </div>

          <div className="pointer-events-none absolute left-3 top-12 z-[6] max-w-[calc(100%-104px)] rounded-md bg-black/45 px-2.5 py-1 text-[11px] font-medium text-cyan-100/95 backdrop-blur-sm">
            检测ID: {detectionEntityIdFromAsset(activeAsset) || "-"} | {detection.diag || "等待检测数据..."}
          </div>

          <div className="absolute right-3 top-1/2 z-[6] flex -translate-y-1/2 flex-col gap-2">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="border-white/20 bg-black/35 text-white hover:bg-white/15"
              onClick={() => void onSnapshot()}
              disabled={busy === "snapshot" || !activeStream}
              title="截图"
              aria-label="截图"
            >
              {busy === "snapshot" ? <Loader2 className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={isRecording ? "destructive" : "outline"}
              className={!isRecording ? "border-white/20 bg-black/35 text-white hover:bg-white/15" : undefined}
              onClick={() => void onToggleRecord()}
              disabled={busy === "record" || !activeStream}
              title={isRecording ? "\u505c\u6b62\u5f55\u50cf" : "\u5f00\u59cb\u5f55\u50cf"}
              aria-label={isRecording ? "\u505c\u6b62\u5f55\u50cf" : "\u5f00\u59cb\u5f55\u50cf"}
            >
              {busy === "record" ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
            </Button>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-[6] rounded-md bg-black/45 px-2.5 py-1 text-sm font-medium text-white/95 backdrop-blur-sm">
            {activeStream?.label ?? "等待相机实体..."}
          </div>

          {renderContextMenu}


          <EoDetectionOverlay
            containerRef={containerRef}
            videoRef={videoRef}
            boxes={detection.boxes}
            videoObjectFit="fill"
            videoIntrinsicWidth={overlayIntrinsic.width}
            videoIntrinsicHeight={overlayIntrinsic.height}
          />
        </div>
      </div>
    </DraggableModal>
  );
}


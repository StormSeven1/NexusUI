"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  Crosshair,
  Loader2,
  Monitor,
  Maximize2,
  Minimize2,
  Gamepad2,
  PictureInPicture2,
  Radar,
  SunMedium,
  Video,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postUavPsdkPayload, uploadUavPsdkAudio } from "@/lib/eo-video/postUavPsdkPayload";
import type { ThirdPartyCamTaskKind } from "@/lib/eo-video/thirdPartyCamTaskClient";

export interface EoVideoFloatingToolsProps {
  className?: string;
  variant: "camera" | "uav";
  ptzSupported?: boolean;
  ptzPanelOpen?: boolean;
  onTogglePtzPanel?: () => void;
  /** 无人机：底部罗盘/状态/控制台是否展开（与相机 PTZ 开关同类交互） */
  uavDockExpanded?: boolean;
  onToggleUavDock?: () => void;
  /** 右侧工具栏应用内画中画（与 Chromium 顶层悬浮控件无关） */
  pipOpen?: boolean;
  onTogglePip?: () => void;
  captureReady: boolean;
  isRecording: boolean;
  onSnapshot: () => void;
  onToggleRecord: () => void;
  /** 形态切换：默认态<->放大态 */
  onToggleExpand?: () => void;
  expandedMode?: boolean;
  /** 占位快捷指令日志（云台回中等） */
  onUavClientLog?: (line: string) => void;
  /** 载荷喊话/探照结果提示（对齐底栏反馈） */
  onUavPsdkNotify?: (text: string, tone?: "success" | "error" | "warn") => void;
  /** 云台回中（对齐 Qt `m_pBtnUavCamCenter`，`reset_mode`=0） */
  onUavGimbalCenter?: () => void | Promise<void>;
  /** 云台向下（对齐 Qt `m_pBtnUavCamDown`，`reset_mode`=1） */
  onUavGimbalDown?: () => void | Promise<void>;
  /** 无机场 SN 等无法发私有云指令时禁用 */
  uavGimbalDisabled?: boolean;
  /**
   * 载荷喊话/探照：`gateway_sn` 与 `PtzMainWidget` 中 `m_droneSNAndAirportSNMap[..].back()`（机场网关 SN）一致。
   */
  uavGatewaySn?: string | null;
  /** 不传则沿用 `uavGimbalDisabled`（与云台同源：无机场/无流时禁控） */
  uavPsdkDisabled?: boolean;
  /** 无人机：true = 关闭检测订阅与对齐，仅裸播 WebRTC（排查卡顿） */
  uavVideoOnly?: boolean;
  onToggleUavVideoOnly?: () => void;
  /** 第三方相机：CAMTASK（搜索 / 跟踪 / 聚焦）与停止任务 */
  thirdPartyCamControls?: boolean;
  onThirdPartyCamKind?: (kind: ThirdPartyCamTaskKind) => void;
  thirdPartyCamBusy?: boolean;
  /** 第三方相机：可展开方位 DIRECTMOVE 十字键（与 PTZ 手柄同一入口） */
  thirdPartyDirectMoveSupported?: boolean;
  /**
   * 为 true 时不渲染首项「放大」按钮（由父级单独置顶，如无人机右侧栏）。
   */
  hideExpandButton?: boolean;
}

const uavOverlayToolClass =
  "border border-white/25 bg-transparent text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white";

type UavPop = "speaker" | "light" | null;

type LightMode = "off" | "strong" | "constant" | "warning";

/** 与 `PtzMainWidget::OpenLighter` widget index 一致 */
const LIGHT_WIDGET: Record<Exclude<LightMode, "off">, number> = {
  constant: 9,
  strong: 11,
  warning: 13,
};

const popPanelClass =
  "absolute right-[calc(100%+8px)] top-0 z-[100] w-[220px] rounded-md border border-white/15 bg-[rgb(22,27,34)] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.45)]";

const popBtnClass =
  "rounded border border-white/15 bg-[#1E2329] px-2 py-1 text-[10px] text-white/90 hover:bg-[#2D3339] active:bg-[#4A4F55] data-[on=1]:border-sky-500/60 data-[on=1]:bg-sky-950/40 disabled:opacity-45";

/**
 * 叠在视频右侧的悬浮工具列：相机含录屏/截图/PTZ/画中画；无人机含控制台与画中画及喊话/探照等。
 * 喊话、探照对齐 Qt `openDroneSpeaker` / `openDroneLighter`：在图标按钮左侧弹出小窗，两窗互斥。
 */
export function EoVideoFloatingTools({
  className,
  variant,
  ptzSupported = false,
  ptzPanelOpen = false,
  onTogglePtzPanel,
  uavDockExpanded = true,
  onToggleUavDock,
  pipOpen = false,
  onTogglePip,
  captureReady,
  isRecording,
  onSnapshot,
  onToggleRecord,
  onToggleExpand,
  expandedMode = false,
  onUavClientLog,
  onUavPsdkNotify,
  onUavGimbalCenter,
  onUavGimbalDown,
  uavGimbalDisabled = false,
  uavGatewaySn = null,
  uavPsdkDisabled,
  uavVideoOnly = false,
  onToggleUavVideoOnly,
  thirdPartyCamControls = false,
  onThirdPartyCamKind,
  thirdPartyCamBusy = false,
  thirdPartyDirectMoveSupported = false,
  hideExpandButton = false,
}: EoVideoFloatingToolsProps) {
  const log = useCallback((s: string) => onUavClientLog?.(`${new Date().toLocaleTimeString()} ${s}`), [onUavClientLog]);
  const notify = useCallback(
    (text: string, tone: "success" | "error" | "warn" = "success") => onUavPsdkNotify?.(text, tone),
    [onUavPsdkNotify],
  );

  const psdkBlocked = uavPsdkDisabled ?? uavGimbalDisabled;
  const gateway = (uavGatewaySn ?? "").trim();

  const [uavPop, setUavPop] = useState<UavPop>(null);
  const [thirdPartyModePopOpen, setThirdPartyModePopOpen] = useState(false);
  const speakerWrapRef = useRef<HTMLDivElement | null>(null);
  const lightWrapRef = useRef<HTMLDivElement | null>(null);
  const thirdPartyModeWrapRef = useRef<HTMLDivElement | null>(null);

  const [lightMode, setLightMode] = useState<LightMode>("off");
  const [lightBrightness, setLightBrightness] = useState(50);
  const [lightBusy, setLightBusy] = useState(false);
  /** 与 Qt `m_nCurLightNum` 一致：上次下过开的 widget index */
  const lastLightIndexRef = useRef<number>(-1);

  const [speakerText, setSpeakerText] = useState("");
  const [speakerBusy, setSpeakerBusy] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recMimeRef = useRef<string>("audio/webm");
  const holdingRecRef = useRef(false);

  useEffect(() => {
    if (!uavPop && !thirdPartyModePopOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (speakerWrapRef.current?.contains(t)) return;
      if (lightWrapRef.current?.contains(t)) return;
      if (thirdPartyModeWrapRef.current?.contains(t)) return;
      setUavPop(null);
      setThirdPartyModePopOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [uavPop, thirdPartyModePopOpen]);

  /** 探照：`psdk_widget_value_set`，与 `PtzMainWidget::OpenLighter` / `ShutDownLighter` 同序先发关再发开。 */
  const syncPayloadLight = useCallback(
    async (mode: LightMode, brightness: number, opts?: { quiet?: boolean }) => {
      if (!gateway || psdkBlocked) {
        notify(!gateway ? "缺少机场网关 SN（gateway_sn），无法下探照指令" : "当前无法操控载荷", "warn");
        return;
      }
      setLightBusy(true);
      try {
        const prev = lastLightIndexRef.current;
        if (prev >= 0) {
          const off = await postUavPsdkPayload({
            gatewaySn: gateway,
            cmd: "psdk_widget_value_set",
            data: { index: prev, widget_value: 0 },
          });
          log(`[探照关灯] index=${prev} → ${JSON.stringify(off).slice(0, 380)}`);
          if (!off.ok) {
            notify(off.message || off.detail || "探照关闭失败", "error");
          }
          lastLightIndexRef.current = -1;
        }
        if (mode === "off") {
          if (!opts?.quiet) notify("探照模式已关闭", "success");
          return;
        }
        const widgetIndex = LIGHT_WIDGET[mode];
        void brightness;
        const on = await postUavPsdkPayload({
          gatewaySn: gateway,
          cmd: "psdk_widget_value_set",
          data: { index: widgetIndex, widget_value: 1 },
        });
        log(`[探照开灯] mode=${mode} index=${widgetIndex} → ${JSON.stringify(on).slice(0, 380)}`);
        if (on.ok) {
          lastLightIndexRef.current = widgetIndex;
          if (!opts?.quiet) {
            notify(`探照：${mode === "strong" ? "强闪" : mode === "constant" ? "常亮" : "警示"}`, "success");
          }
        } else {
          notify(on.message || on.detail || "探照开启失败", "error");
        }
      } finally {
        setLightBusy(false);
      }
    },
    [gateway, log, notify, psdkBlocked],
  );

  const onPickLightMode = (m: Exclude<LightMode, "off">) => {
    if (lightBusy) return;
    setLightMode((cur) => {
      const toggledOff = cur === m;
      const next: LightMode = toggledOff ? "off" : m;
      void syncPayloadLight(next, lightBrightness);
      return next;
    });
  };

  const sendSpeakerText = async () => {
    const txt = speakerText.trim();
    if (!txt) {
      notify("请先输入喊话内容", "warn");
      return;
    }
    if (!gateway || psdkBlocked) return;
    setSpeakerBusy(true);
    try {
      const ret = await postUavPsdkPayload({
        gatewaySn: gateway,
        cmd: "psdk_input_box_text_set",
        data: { text_value: txt },
      });
      log(`[文字喊话] ${JSON.stringify(ret).slice(0, 520)}`);
      if (ret.ok) notify("文字喊话已下发", "success");
      else notify(ret.message || ret.detail || "文字喊话失败", "error");
    } finally {
      setSpeakerBusy(false);
    }
  };

  const stopQuickRecording = useCallback(async () => {
    if (!holdingRecRef.current) return;
    holdingRecRef.current = false;
    const mr = mediaRecRef.current;
    mediaRecRef.current = null;
    const stream = micStreamRef.current;
    micStreamRef.current = null;
    if (!mr) {
      stream?.getTracks().forEach((x) => x.stop());
      return;
    }

    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      try {
        mr.stop();
      } catch {
        resolve();
      }
    });
    stream?.getTracks().forEach((x) => x.stop());

    const blob = new Blob(recChunksRef.current, { type: recMimeRef.current || "audio/webm" });
    recChunksRef.current = [];
    if (!gateway || psdkBlocked) return;
    if (blob.size < 16) {
      notify("录音过短", "warn");
      return;
    }
    setSpeakerBusy(true);
    try {
      const name = `uav_quick_${Date.now()}.webm`;
      const up = await uploadUavPsdkAudio(blob, name);
      log(`[喊话上传] ${JSON.stringify(up).slice(0, 420)}`);
      if (!up.ok || !up.fileId || !up.md5) {
        notify(up.message || up.detail || "音频上传失败", "error");
        return;
      }
      const ret = await postUavPsdkPayload({
        gatewaySn: gateway,
        cmd: "speaker_audio_play_start",
        data: { file: { name, md5: up.md5, file_id: up.fileId } },
      });
      log(`[语音喊话播放] ${JSON.stringify(ret).slice(0, 420)}`);
      if (ret.ok) notify("语音喊话已下发", "success");
      else notify(ret.message || ret.detail || "语音喊话下发失败", "error");
    } finally {
      setSpeakerBusy(false);
    }
  }, [gateway, log, notify, psdkBlocked]);

  const startQuickRecording = async () => {
    if (!gateway || psdkBlocked) return;
    if (holdingRecRef.current || speakerBusy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, MediaRecorder.isTypeSupported(preferred) ? { mimeType: preferred } : undefined);
      recMimeRef.current = mr.mimeType || "audio/webm";
      recChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mr.start(120);
      mediaRecRef.current = mr;
      holdingRecRef.current = true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "无法访问麦克风", "error");
    }
  };

  useEffect(() => {
    return () => {
      holdingRecRef.current = false;
      try {
        mediaRecRef.current?.stop();
      } catch {
        /* noop */
      }
      mediaRecRef.current = null;
      micStreamRef.current?.getTracks().forEach((x) => {
        try {
          x.stop();
        } catch {
          /* noop */
        }
      });
      micStreamRef.current = null;
      recChunksRef.current = [];
    };
  }, []);

  const focusSpeakerTextSetting = () => {
    queueMicrotask(() => textAreaRef.current?.focus({ preventScroll: true }));
    log("[喊话面板] 设置：聚焦文字输入");
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-0.5 py-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      {hideExpandButton ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "border border-white/25 bg-transparent text-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
            expandedMode && "border-sky-400/45 bg-sky-950/50 text-sky-300",
          )}
          title={expandedMode ? "恢复默认窗口" : "放大窗口"}
          aria-label={expandedMode ? "恢复默认窗口" : "放大窗口"}
          onClick={() => onToggleExpand?.()}
        >
          {expandedMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      )}
      {thirdPartyCamControls ? (
        <div className="relative" ref={thirdPartyModeWrapRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "border border-white/25 bg-transparent text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
              thirdPartyModePopOpen ? "border-sky-400/45 bg-sky-950/50 text-sky-300" : "",
            )}
            title="第三方相机（搜索 / 跟踪 / 聚焦 / 停止）"
            aria-label="第三方相机任务"
            aria-expanded={thirdPartyModePopOpen}
            onClick={() => setThirdPartyModePopOpen((v) => !v)}
          >
            <Radar className="size-3.5" />
          </Button>
          {thirdPartyModePopOpen ? (
            <div
              role="dialog"
              aria-label="第三方相机任务"
              className={popPanelClass}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p className="mb-2 text-[10px] font-medium text-white/55">第三方相机</p>
              <div className="flex flex-col gap-1.5">
                {(
                  [
                    ["SEARCH", "ThirdPartyCamCamTask · SEARCH", "搜索"] as const,
                    ["TRACK", "ThirdPartyCamCamTask · TRACK", "跟踪"] as const,
                    ["FOCUS", "ThirdPartyCamCamTask · FOCUS", "聚焦"] as const,
                    ["STOP", "ThirdPartyCamStopTask · params.entityId", "停止"] as const,
                  ] as const
                ).map(([k, title, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={popBtnClass}
                    disabled={thirdPartyCamBusy}
                    title={title}
                    onClick={() => {
                      onThirdPartyCamKind?.(k);
                      setThirdPartyModePopOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {thirdPartyCamBusy ? (
                <div className="mt-2 flex justify-end">
                  <Loader2 className="size-3.5 animate-spin text-white/60" aria-hidden />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn(
          "border border-white/25 bg-transparent text-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
          isRecording ? "text-red-400" : "text-white/85",
        )}
        disabled={!isRecording && !captureReady}
        title={isRecording ? "停止录屏" : "开始录屏"}
        aria-label={isRecording ? "停止录屏" : "开始录屏"}
        onClick={onToggleRecord}
      >
        <Video className={cn("size-3.5", isRecording && "animate-pulse")} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="border border-white/25 bg-transparent text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white"
        disabled={!captureReady}
        title="截图（PNG）"
        aria-label="截图"
        onClick={onSnapshot}
      >
        <Camera className="size-3.5" />
      </Button>

      {variant === "uav" && onToggleUavVideoOnly && expandedMode ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={
            uavVideoOnly
              ? "仅播放视频（已关闭检测）— 点击恢复检测框与对齐"
              : "仅播放视频：关闭检测订阅与对齐，减轻卡顿"
          }
          aria-label={uavVideoOnly ? "恢复检测叠加" : "仅播放视频"}
          aria-pressed={uavVideoOnly}
          className={cn(
            "border border-white/25 bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
            uavVideoOnly
              ? "border-emerald-400/55 bg-emerald-950/45 text-emerald-200"
              : "text-white/85",
          )}
          onClick={() => onToggleUavVideoOnly()}
        >
          <Monitor className="size-3.5" />
        </Button>
      ) : null}

      {!expandedMode ? null : variant === "camera" ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!ptzSupported && !thirdPartyDirectMoveSupported}
            title={
              thirdPartyDirectMoveSupported && !ptzSupported
                ? ptzPanelOpen
                  ? "收起第三方相机方位控制"
                  : "展开第三方相机方位控制（DIRECTMOVE）"
                : ptzSupported
                  ? ptzPanelOpen
                    ? "收起右下云台控制"
                    : "展开右下云台控制（云台 / 对焦 / 变焦）"
                  : "需要相机实体（camera_001 等）"
            }
            aria-label="相机云台控制显隐"
            aria-pressed={ptzPanelOpen && (ptzSupported || thirdPartyDirectMoveSupported)}
            className={cn(
              "border border-white/25 bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white disabled:opacity-50",
              ptzPanelOpen && (ptzSupported || thirdPartyDirectMoveSupported)
                ? "border-sky-400/45 bg-sky-950/50 text-sky-300"
                : "text-white/85",
            )}
            onClick={() => onTogglePtzPanel?.()}
          >
            <Gamepad2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={pipOpen ? "关闭画中画小窗" : "画中画（右上小窗；右键切换源流）"}
            aria-label="画中画"
            aria-pressed={pipOpen}
            className={cn(
              "border border-white/25 bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
              pipOpen ? "border-sky-400/45 bg-sky-950/50 text-sky-300" : "text-white/85",
            )}
            onClick={() => onTogglePip?.()}
          >
            <PictureInPicture2 className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={
              uavDockExpanded ? "收起无人机罗盘与控制台" : "展开无人机罗盘、状态与控制面板"
            }
            aria-label="无人机控制台显隐"
            aria-pressed={uavDockExpanded}
            className={cn(
              "border border-white/25 bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
              uavDockExpanded
                ? "border-sky-400/45 bg-sky-950/50 text-sky-300"
                : "text-white/85",
            )}
            onClick={() => onToggleUavDock?.()}
          >
            <Gamepad2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={pipOpen ? "关闭画中画小窗" : "画中画（右上小窗；右键切换源流）"}
            aria-label="画中画"
            aria-pressed={pipOpen}
            className={cn(
              "border border-white/25 bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white",
              pipOpen ? "border-sky-400/45 bg-sky-950/50 text-sky-300" : "text-white/85",
            )}
            onClick={() => onTogglePip?.()}
          >
            <PictureInPicture2 className="size-3.5" />
          </Button>
          <div className="my-0.5 h-px w-6 bg-gradient-to-r from-transparent via-white/35 to-transparent" aria-hidden />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={uavOverlayToolClass}
            title="云台回中（gimbal_reset · reset_mode=0）"
            aria-label="云台回中"
            disabled={uavGimbalDisabled || !onUavGimbalCenter}
            onClick={() => void onUavGimbalCenter?.()}
          >
            <Crosshair className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={uavOverlayToolClass}
            title="云台向下（gimbal_reset · reset_mode=1）"
            aria-label="云台向下"
            disabled={uavGimbalDisabled || !onUavGimbalDown}
            onClick={() => void onUavGimbalDown?.()}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <div className="relative" ref={speakerWrapRef}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                uavOverlayToolClass,
                uavPop === "speaker" ? "border-sky-400/45 bg-sky-950/50 text-sky-300" : "",
              )}
              title="喊话"
              aria-label="喊话"
              aria-expanded={uavPop === "speaker"}
              onClick={() => {
                setUavPop((cur) => (cur === "speaker" ? null : "speaker"));
              }}
            >
              <Volume2 className="size-3.5" />
            </Button>
            {uavPop === "speaker" ? (
              <div
                role="dialog"
                aria-label="无人机喊话"
                className={popPanelClass}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className={popBtnClass}
                    disabled={psdkBlocked || speakerBusy || !gateway}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      void startQuickRecording();
                    }}
                    onPointerUp={(e) => {
                      e.preventDefault();
                      void stopQuickRecording();
                    }}
                    onPointerLeave={() => void stopQuickRecording()}
                  >
                    按住录音
                  </button>
                  <button
                    type="button"
                    className={popBtnClass}
                    onClick={() => focusSpeakerTextSetting()}
                  >
                    设置
                  </button>
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    className="h-6 px-2 bg-sky-900/65 text-[10px] text-white hover:bg-sky-800/85"
                    disabled={psdkBlocked || speakerBusy || !gateway.trim()}
                    onClick={() => void sendSpeakerText()}
                  >
                    发送
                  </Button>
                  {speakerBusy ? <Loader2 className="size-3.5 animate-spin text-white/60" aria-hidden /> : null}
                </div>
                <textarea
                  ref={textAreaRef}
                  value={speakerText}
                  onChange={(e) => setSpeakerText(e.target.value)}
                  placeholder="输入文字后发送（对应 UAVSpeakerWidget 文本喊话）"
                  rows={2}
                  className="mb-2 w-full resize-none rounded border border-white/15 bg-black/35 px-2 py-1 text-[10px] text-white placeholder:text-white/35 focus:border-sky-500/55 focus:outline-none"
                />
                {!gateway ? <p className="mt-1 text-[9px] text-amber-200/85">缺少网关 SN</p> : null}
              </div>
            ) : null}
          </div>
          <div className="relative" ref={lightWrapRef}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                uavOverlayToolClass,
                uavPop === "light" ? "border-sky-400/45 bg-sky-950/50 text-sky-300" : "",
              )}
              title="探照灯"
              aria-label="探照灯"
              aria-expanded={uavPop === "light"}
              onClick={() => {
                setUavPop((cur) => (cur === "light" ? null : "light"));
              }}
            >
              <SunMedium className="size-3.5" />
            </Button>
            {uavPop === "light" ? (
              <div
                role="dialog"
                aria-label="探照灯"
                className={popPanelClass}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-end">
                  {lightBusy ? <Loader2 className="size-3 animate-spin text-white/60" aria-hidden /> : null}
                </div>
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    data-on={lightMode === "strong" ? 1 : 0}
                    className={popBtnClass}
                    disabled={lightBusy || psdkBlocked || !gateway}
                    onClick={() => onPickLightMode("strong")}
                  >
                    强闪
                  </button>
                  <button
                    type="button"
                    data-on={lightMode === "constant" ? 1 : 0}
                    className={popBtnClass}
                    disabled={lightBusy || psdkBlocked || !gateway}
                    onClick={() => onPickLightMode("constant")}
                  >
                    常亮
                  </button>
                  <button
                    type="button"
                    data-on={lightMode === "warning" ? 1 : 0}
                    className={popBtnClass}
                    disabled={lightBusy || psdkBlocked || !gateway}
                    onClick={() => onPickLightMode("warning")}
                  >
                    警示
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-white/85">
                  <span className="shrink-0 text-white/60">亮度</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={lightBrightness}
                    disabled={lightMode === "off" || psdkBlocked || !gateway || lightBusy}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLightBrightness(v);
                      if (lightMode !== "off") void syncPayloadLight(lightMode, v, { quiet: true });
                    }}
                    className="h-1 flex-1 accent-sky-500 disabled:opacity-40"
                  />
                  <span className="w-6 tabular-nums text-white/50">{lightBrightness}</span>
                </div>
                {!gateway ? <p className="mt-1 text-[9px] text-amber-200/85">缺少网关 SN</p> : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

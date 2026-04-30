"use client";

import {
  Camera,
  ChevronDown,
  Crosshair,
  Gamepad2,
  PictureInPicture2,
  SunMedium,
  Video,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  /** 占位快捷指令日志（云台回中等） */
  onUavClientLog?: (line: string) => void;
}

const uavOverlayToolClass =
  "border border-white/25 bg-transparent text-white/85 shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white";

/**
 * 叠在视频右侧的悬浮工具列：相机含录屏/截图/PTZ/画中画；无人机含控制台与画中画及快捷占位等。
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
  onUavClientLog,
}: EoVideoFloatingToolsProps) {
  const log = (s: string) => onUavClientLog?.(`${new Date().toLocaleTimeString()} ${s}`);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-0.5 py-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
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

      {variant === "camera" ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!ptzSupported}
            title={
              ptzSupported
                ? ptzPanelOpen
                  ? "收起右下云台控制"
                  : "展开右下云台控制（云台 / 对焦 / 变焦）"
                : "需要相机实体（camera_001 等）"
            }
            aria-label="相机云台控制显隐"
            aria-pressed={ptzPanelOpen && ptzSupported}
            className={cn(
              "border border-white/25 bg-transparent shadow-[0_1px_3px_rgba(0,0,0,0.65)] hover:bg-white/10 hover:text-white disabled:opacity-50",
              ptzPanelOpen && ptzSupported
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
            title="云台回中（占位）"
            onClick={() => log("无人机工具：云台回中（占位）")}
          >
            <Crosshair className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={uavOverlayToolClass}
            title="云台向下（占位）"
            onClick={() => log("无人机工具：云台向下（占位）")}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={uavOverlayToolClass}
            title="喊话（占位）"
            onClick={() => log("无人机工具：喊话（占位）")}
          >
            <Volume2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={uavOverlayToolClass}
            title="探照（占位）"
            onClick={() => log("无人机工具：探照（占位）")}
          >
            <SunMedium className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

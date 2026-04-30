"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LensConcave, LensConvex, ZoomIn, ZoomOut } from "lucide-react";
import { postEoPtzMove, postEoPtzStop, type EoPtzDirection } from "@/lib/eo-video/eoPtzTaskClient";
import { cn } from "@/lib/utils";

export interface EoVideoPtzPanelProps {
  className?: string;
  entityId: string;
  backendBaseUrl: string;
  onClientLog?: (line: string) => void;
}

function PtzPadButton({
  label,
  title,
  onPointerDown,
  onPointerUpCancel,
  className,
  children,
}: {
  label: string;
  title: string;
  onPointerDown: () => void;
  onPointerUpCancel: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded border border-white/35 bg-black/55 text-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.65)] transition hover:border-white/50 hover:bg-black/72 active:bg-black/85",
        "h-8 w-8 sm:h-[2.125rem] sm:w-[2.125rem]",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        onPointerDown();
      }}
      onPointerUp={(e) => {
        if ((e.currentTarget as HTMLButtonElement).hasPointerCapture(e.pointerId)) {
          (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
        }
        onPointerUpCancel();
      }}
      onPointerCancel={onPointerUpCancel}
      onPointerLeave={() => {
        onPointerUpCancel();
      }}
    >
      {children}
    </button>
  );
}

/**
 * 云台 / 变倍 / 聚焦：按下发 PTZMoveTask，松开发 PTZControlStop（对齐 base-vue CameraView.vue）。
 */
export function EoVideoPtzPanel({ className, entityId, backendBaseUrl, onClientLog }: EoVideoPtzPanelProps) {
  const controllingRef = useRef(false);
  const currentDirRef = useRef<EoPtzDirection | null>(null);

  const log = useCallback(
    (line: string) => {
      onClientLog?.(`${new Date().toLocaleTimeString()} ${line}`);
    },
    [onClientLog],
  );

  const stop = useCallback(async () => {
    if (!controllingRef.current) return;
    controllingRef.current = false;
    const dir = currentDirRef.current;
    currentDirRef.current = null;
    try {
      const res = await postEoPtzStop({ entityId, backendBaseUrl });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        log(`云台停止失败 HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
      }
    } catch (e) {
      log(`云台停止异常：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [backendBaseUrl, entityId, log]);

  const start = useCallback(
    async (direction: EoPtzDirection) => {
      if (controllingRef.current) return;
      controllingRef.current = true;
      currentDirRef.current = direction;
      try {
        const res = await postEoPtzMove({ entityId, backendBaseUrl, direction });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          controllingRef.current = false;
          currentDirRef.current = null;
          log(`云台「${direction}」失败 HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
        }
      } catch (e) {
        controllingRef.current = false;
        currentDirRef.current = null;
        log(`云台「${direction}」异常：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [backendBaseUrl, entityId, log],
  );

  const bindPad = (direction: EoPtzDirection, label: string, title: string) => ({
    label,
    title,
    onPointerDown: () => void start(direction),
    onPointerUpCancel: () => void stop(),
  });

  return (
    <div
      className={cn(
        "flex w-full shrink-0 flex-row flex-wrap items-center justify-end gap-x-4 gap-y-2",
        "[text-shadow:0_1px_2px_rgba(0,0,0,0.85)]",
        className,
      )}
    >
      <div className="flex shrink-0 flex-row items-center gap-0.5">
        <PtzPadButton {...bindPad("LEFT", "左", "左")}>
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </PtzPadButton>
        <div className="flex flex-col gap-0.5">
          <PtzPadButton {...bindPad("UP", "上", "上（按住移动，松开停止）")}>
            <ArrowUp className="size-3.5" strokeWidth={2} />
          </PtzPadButton>
          <PtzPadButton {...bindPad("DOWN", "下", "下")}>
            <ArrowDown className="size-3.5" strokeWidth={2} />
          </PtzPadButton>
        </div>
        <PtzPadButton {...bindPad("RIGHT", "右", "右")}>
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </PtzPadButton>
      </div>
      <div
        className="hidden min-h-0 shrink-0 self-stretch w-px bg-gradient-to-b from-transparent via-white/28 to-transparent sm:block"
        aria-hidden
      />
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-0.5">
          <PtzPadButton {...bindPad("ZOOM_IN", "变倍+", "变倍增大（按住）")}>
            <ZoomIn className="size-3.5" strokeWidth={2} />
          </PtzPadButton>
          <PtzPadButton {...bindPad("ZOOM_OUT", "变倍−", "变倍减小（按住）")}>
            <ZoomOut className="size-3.5" strokeWidth={2} />
          </PtzPadButton>
        </div>
        <div className="flex items-center gap-0.5">
          <PtzPadButton {...bindPad("FOCUS_IN", "对焦+", "对焦调近（按住）")}>
            <LensConvex className="size-3.5" strokeWidth={2} />
          </PtzPadButton>
          <PtzPadButton {...bindPad("FOCUS_OUT", "对焦−", "对焦拉远（按住）")}>
            <LensConcave className="size-3.5" strokeWidth={2} />
          </PtzPadButton>
        </div>
      </div>
    </div>
  );
}

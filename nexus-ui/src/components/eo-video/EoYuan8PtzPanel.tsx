"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ZoomIn, ZoomOut } from "lucide-react";
import {
  postYuan8ServoTask,
  postYuan8ZoomTask,
  YUAN8_ZOOM_IN,
  YUAN8_ZOOM_OUT,
  YUAN8_ZOOM_STOP,
  type Yuan8ServoControlType,
} from "@/lib/eo-video/yuan8TaskClient";
import { evaluateThirdPartyTaskHttpResponse } from "@/lib/thirdPartyTaskServiceResponse";
import { cn } from "@/lib/utils";

export interface EoYuan8PtzPanelProps {
  className?: string;
  entityId: string;
  backendBaseUrl: string;
  onClientLog?: (line: string) => void;
}

type ActiveKind = "servo" | "zoom" | null;

function PadBtn({
  label,
  title,
  onPointerDown,
  onPointerUpCancel,
  children,
}: {
  label: string;
  title: string;
  onPointerDown: () => void;
  onPointerUpCancel: () => void;
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
      onPointerLeave={onPointerUpCancel}
    >
      {children}
    </button>
  );
}

/**
 * 8院云台：方向 3003（3左/4右/5上/6下/7停），变倍 3004（0xF0/0x0F/0x00）。
 * 按下发连续动作，松开发停止。
 */
export function EoYuan8PtzPanel({ className, entityId, backendBaseUrl, onClientLog }: EoYuan8PtzPanelProps) {
  const activeRef = useRef<ActiveKind>(null);

  const log = useCallback(
    (line: string) => onClientLog?.(`${new Date().toLocaleTimeString()} ${line}`),
    [onClientLog],
  );

  const stopAll = useCallback(async () => {
    const kind = activeRef.current;
    if (!kind) return;
    activeRef.current = null;
    const id = entityId.trim();
    if (!id) return;
    try {
      if (kind === "servo") {
        const res = await postYuan8ServoTask({ entityId: id, backendBaseUrl, controlType: 7 });
        const text = await res.text().catch(() => "");
        const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
        if (!outcome.accepted) log(`8院伺服停止未受理 · ${outcome.logLine}`);
      } else {
        const res = await postYuan8ZoomTask({ entityId: id, backendBaseUrl, zoomCommand: YUAN8_ZOOM_STOP });
        const text = await res.text().catch(() => "");
        const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
        if (!outcome.accepted) log(`8院变倍停止未受理 · ${outcome.logLine}`);
      }
    } catch (e) {
      log(`8院停止异常：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [backendBaseUrl, entityId, log]);

  const startServo = useCallback(
    async (controlType: Yuan8ServoControlType, label: string) => {
      if (activeRef.current) return;
      activeRef.current = "servo";
      const id = entityId.trim();
      if (!id) {
        activeRef.current = null;
        return;
      }
      try {
        const res = await postYuan8ServoTask({ entityId: id, backendBaseUrl, controlType });
        const text = await res.text().catch(() => "");
        const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
        if (!outcome.accepted) {
          activeRef.current = null;
          log(`8院伺服「${label}」未受理 · ${outcome.logLine}`);
        }
      } catch (e) {
        activeRef.current = null;
        log(`8院伺服「${label}」异常：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [backendBaseUrl, entityId, log],
  );

  const startZoom = useCallback(
    async (zoomCommand: number, label: string) => {
      if (activeRef.current) return;
      activeRef.current = "zoom";
      const id = entityId.trim();
      if (!id) {
        activeRef.current = null;
        return;
      }
      try {
        const res = await postYuan8ZoomTask({ entityId: id, backendBaseUrl, zoomCommand });
        const text = await res.text().catch(() => "");
        const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
        if (!outcome.accepted) {
          activeRef.current = null;
          log(`8院变倍「${label}」未受理 · ${outcome.logLine}`);
        }
      } catch (e) {
        activeRef.current = null;
        log(`8院变倍「${label}」异常：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [backendBaseUrl, entityId, log],
  );

  const bindServo = (controlType: Yuan8ServoControlType, label: string, title: string) => ({
    label,
    title: `${title}（按下连续，松开停止）`,
    onPointerDown: () => void startServo(controlType, label),
    onPointerUpCancel: () => void stopAll(),
  });

  const bindZoom = (zoomCommand: number, label: string, title: string) => ({
    label,
    title: `${title}（按下连续，松开停止）`,
    onPointerDown: () => void startZoom(zoomCommand, label),
    onPointerUpCancel: () => void stopAll(),
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
        <PadBtn {...bindServo(3, "左", "左")}>
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </PadBtn>
        <div className="flex flex-col gap-0.5">
          <PadBtn {...bindServo(5, "上", "上")}>
            <ArrowUp className="size-3.5" strokeWidth={2} />
          </PadBtn>
          <PadBtn {...bindServo(6, "下", "下")}>
            <ArrowDown className="size-3.5" strokeWidth={2} />
          </PadBtn>
        </div>
        <PadBtn {...bindServo(4, "右", "右")}>
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </PadBtn>
      </div>
      <div
        className="hidden min-h-0 shrink-0 self-stretch w-px bg-gradient-to-b from-transparent via-white/28 to-transparent sm:block"
        aria-hidden
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <PadBtn {...bindZoom(YUAN8_ZOOM_IN, "变倍+", "变倍增大")}>
          <ZoomIn className="size-3.5" strokeWidth={2} />
        </PadBtn>
        <PadBtn {...bindZoom(YUAN8_ZOOM_OUT, "变倍−", "变倍减小")}>
          <ZoomOut className="size-3.5" strokeWidth={2} />
        </PadBtn>
      </div>
      <span className="max-w-[12rem] text-[10px] leading-snug text-white/55">
        8院 · 伺服 3003 · 变倍 3004
      </span>
    </div>
  );
}

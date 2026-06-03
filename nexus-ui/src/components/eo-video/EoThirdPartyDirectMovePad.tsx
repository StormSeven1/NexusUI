"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import {
  postThirdPartyDirectMove,
  THIRD_PARTY_DM_PAN_TILT_MAX,
  THIRD_PARTY_DM_PAN_TILT_MIN,
  THIRD_PARTY_DM_STEP,
  THIRD_PARTY_DM_ZOOM_DEFAULT,
} from "@/lib/eo-video/thirdPartyDirectMoveClient";
import { evaluateThirdPartyTaskHttpResponse } from "@/lib/thirdPartyTaskServiceResponse";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { useEoThirdPartyUdpDevStatusStore } from "@/stores/eo-third-party-udp-dev-status-store";
import { cn } from "@/lib/utils";

/** 与 `PtzMainWidget::onHighSpeedDirectMoveTimer`：`m_highSpeedDirectMoveDirection` 0 上 1 下 2 左 3 右 */
type DirectMoveDir = 0 | 1 | 2 | 3;

export interface EoThirdPartyDirectMovePadProps {
  className?: string;
  entityId: string;
  backendBaseUrl: string;
  onClientLog?: (line: string) => void;
}

function clampPanTilt(v: number): number {
  return Math.min(THIRD_PARTY_DM_PAN_TILT_MAX, Math.max(THIRD_PARTY_DM_PAN_TILT_MIN, v));
}

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
 * 第三方相机 DIRECTMOVE（0x3001）：对齐 Qt 按住方向键 → 立即发一次 + 每 1s 重复；松开停。
 * 内部维护 pan/tilt/zoom（步进与边界与 `onHighSpeedDirectMoveTimer` 一致）。
 */
export function EoThirdPartyDirectMovePad({
  className,
  entityId,
  backendBaseUrl,
  onClientLog,
}: EoThirdPartyDirectMovePadProps) {
  const log = useCallback(
    (line: string) => onClientLog?.(`${new Date().toLocaleTimeString()} ${line}`),
    [onClientLog],
  );

  const panRef = useRef(0);
  const tiltRef = useRef(0);
  const zoomRef = useRef(0);
  const dirRef = useRef<DirectMoveDir | -1>(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const storeKey = canonicalEntityId(entityId) || entityId.trim().toLowerCase();
  const devStatus = useEoThirdPartyUdpDevStatusStore((s) =>
    storeKey ? s.byEntityId[storeKey]?.devStatus : undefined,
  );

  useEffect(() => {
    panRef.current = 0;
    tiltRef.current = 0;
    zoomRef.current = 0;
    dirRef.current = -1;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [entityId]);

  /** 对齐 Qt `onHighSpeedDevStatusBasicReceived`：以 UDP 0x1001 上报为 DIRECTMOVE 基准 */
  useEffect(() => {
    if (!devStatus) return;
    if (dirRef.current >= 0) return;
    panRef.current = devStatus.pan;
    tiltRef.current = devStatus.tilt;
    if (devStatus.zoom !== undefined && devStatus.zoom >= 0) {
      zoomRef.current = devStatus.zoom;
    }
  }, [devStatus]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    dirRef.current = -1;
  }, []);

  const sendDirectMove = useCallback(async () => {
    const id = entityId.trim();
    if (!id) return;
    let pan = panRef.current;
    let tilt = tiltRef.current;
    const d = dirRef.current;
    if (d < 0) return;

    switch (d) {
      case 0:
        tilt += THIRD_PARTY_DM_STEP;
        break;
      case 1:
        tilt -= THIRD_PARTY_DM_STEP;
        break;
      case 2:
        pan -= THIRD_PARTY_DM_STEP;
        break;
      case 3:
        pan += THIRD_PARTY_DM_STEP;
        break;
      default:
        return;
    }
    pan = clampPanTilt(pan);
    tilt = clampPanTilt(tilt);
    panRef.current = pan;
    tiltRef.current = tilt;
    const zoom = zoomRef.current > 0 ? zoomRef.current : THIRD_PARTY_DM_ZOOM_DEFAULT;

    try {
      const res = await postThirdPartyDirectMove({
        entityId: id,
        backendBaseUrl,
        pan,
        tilt,
        zoom,
      });
      const text = await res.text().catch(() => "");
      const outcome = evaluateThirdPartyTaskHttpResponse(res.ok, text);
      if (!outcome.accepted) {
        log(`第三方 DIRECTMOVE 未受理 pan=${pan.toFixed(2)} tilt=${tilt.toFixed(2)} zoom=${zoom.toFixed(1)} · ${outcome.logLine}`);
      }
    } catch (e) {
      log(`第三方 DIRECTMOVE 请求异常：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [backendBaseUrl, entityId, log]);

  const startHold = useCallback(
    (direction: DirectMoveDir) => {
      stopTimer();
      dirRef.current = direction;
      void sendDirectMove();
      timerRef.current = setInterval(() => void sendDirectMove(), 1000);
    },
    [sendDirectMove, stopTimer],
  );

  useEffect(() => () => stopTimer(), [stopTimer]);

  const bindDir = (direction: DirectMoveDir, label: string, title: string) => ({
    label,
    title: `${title}（对齐 Qt：按下即发 + 每秒重复，松开停止）`,
    onPointerDown: () => startHold(direction),
    onPointerUpCancel: () => stopTimer(),
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
        <PadBtn {...bindDir(2, "左", "左")}>
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </PadBtn>
        <div className="flex flex-col gap-0.5">
          <PadBtn {...bindDir(0, "上", "上")}>
            <ArrowUp className="size-3.5" strokeWidth={2} />
          </PadBtn>
          <PadBtn {...bindDir(1, "下", "下")}>
            <ArrowDown className="size-3.5" strokeWidth={2} />
          </PadBtn>
        </div>
        <PadBtn {...bindDir(3, "右", "右")}>
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </PadBtn>
      </div>
      <span className="max-w-[14rem] text-[10px] leading-snug text-white/55">
        第三方 DIRECTMOVE · 步进 {THIRD_PARTY_DM_STEP}° · pan/tilt ∈ [{THIRD_PARTY_DM_PAN_TILT_MIN},{" "}
        {THIRD_PARTY_DM_PAN_TILT_MAX}]
        {devStatus ? (
          <>
            <br />
            状态 0x1001 · panVehicle{" "}
            {devStatus.panVehicle != null && Number.isFinite(devStatus.panVehicle)
              ? `${devStatus.panVehicle.toFixed(1)}°`
              : "—"}{" "}
            · pan {devStatus.pan.toFixed(1)}° · tilt {devStatus.tilt.toFixed(1)}°
            {devStatus.zoom !== undefined ? ` · zoom ${devStatus.zoom.toFixed(0)}` : null}
          </>
        ) : (
          <>
            <br />
            等待 MSG_DEV_STATUS_BASIC…
          </>
        )}
      </span>
    </div>
  );
}

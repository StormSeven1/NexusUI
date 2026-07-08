import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchUavDrcSessionStatus,
  formatUavDrcDebugLine,
  stopUavStickSession,
  updateUavStickSession,
  type UavDrcSessionStatus,
} from "@/lib/eo-video/uavDrcSessionClient";

/**
 * 无人机键盘手控
 * stick / heart_beat 经 Next 服务端 mqtt://1883 下发（与 C++ mqttworker 同 broker），
 * 避免生产 HTTPS 下浏览器 wss-mqtt publish 被限流导致 ~1–4m/s。
 */

export type UavKeyCode = "Q" | "W" | "E" | "A" | "S" | "D" | "Z" | "C";

export interface UavKeyState {
  Q: boolean;
  W: boolean;
  E: boolean;
  A: boolean;
  S: boolean;
  D: boolean;
  Z: boolean;
  C: boolean;
}

const INITIAL_KEY_STATE: UavKeyState = {
  Q: false,
  W: false,
  E: false,
  A: false,
  S: false,
  D: false,
  Z: false,
  C: false,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function isAnyKeyPressed(state: UavKeyState): boolean {
  return Object.values(state).some((v) => v);
}

export interface UseUavKeyboardControlOpts {
  enabled: boolean;
  airportSN: string | null;
  hasAuth: boolean;
  onLog?: (line: string) => void;
  onNeedAuth?: () => void;
  onControlStart?: () => void;
  /** 浏览器 MQTT 仅用于 OSD 订阅状态展示 */
  mqttRxConnected?: boolean;
  /** 为 true 时每 1s 拉取服务端 DRC 会话状态（放大调试面板） */
  pollDrcStatus?: boolean;
}

export function useUavKeyboardControl(opts: UseUavKeyboardControlOpts) {
  const [keyState, setKeyState] = useState<UavKeyState>(INITIAL_KEY_STATE);
  const [drcStatus, setDrcStatus] = useState<UavDrcSessionStatus | null>(null);
  const keyStateRef = useRef<UavKeyState>(INITIAL_KEY_STATE);
  const optsRef = useRef(opts);
  const syncWarnAtRef = useRef(0);
  optsRef.current = opts;

  const isControlling = isAnyKeyPressed(keyState);

  const pushKeysToServer = useCallback(async (keys: UavKeyState) => {
    const sn = optsRef.current.airportSN;
    if (!sn) return;
    const ret = await updateUavStickSession(sn, keys);
    if (ret.ok) {
      setDrcStatus(ret);
      return;
    }
    const now = Date.now();
    if (now - syncWarnAtRef.current > 3000) {
      syncWarnAtRef.current = now;
      optsRef.current.onLog?.(
        `${new Date().toLocaleTimeString()} 键盘手控：服务端 DRC 同步失败（${ret.detail ?? ret.stickLastError ?? "unknown"}）`,
      );
    }
  }, []);

  const stopControlInternal = useCallback(
    (logLine?: string) => {
      keyStateRef.current = INITIAL_KEY_STATE;
      setKeyState(INITIAL_KEY_STATE);
      const sn = optsRef.current.airportSN;
      if (sn) {
        void stopUavStickSession(sn).then((ret) => {
          if (ret.ok) setDrcStatus(ret);
        });
      }
      if (logLine) optsRef.current.onLog?.(logLine);
    },
    [],
  );

  useEffect(() => {
    if (!opts.enabled || !opts.airportSN || !opts.hasAuth) {
      if (isAnyKeyPressed(keyStateRef.current)) {
        stopControlInternal();
      }
    }
  }, [opts.enabled, opts.airportSN, opts.hasAuth, stopControlInternal]);

  useEffect(() => {
    if (!opts.enabled) return;

    const applyKey = (key: UavKeyCode, pressed: boolean) => {
      const prev = keyStateRef.current;
      if (prev[key] === pressed) return;

      const newState = { ...prev, [key]: pressed };
      keyStateRef.current = newState;
      setKeyState(newState);
      void pushKeysToServer(newState);

      if (pressed) {
        if (!isAnyKeyPressed(prev)) {
          optsRef.current.onLog?.(`键盘手控开始（${key}）`);
          optsRef.current.onControlStart?.();
        }
        return;
      }

      if (!isAnyKeyPressed(newState)) {
        stopControlInternal("键盘手控停止");
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toUpperCase();
      if (!(key in INITIAL_KEY_STATE)) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (!optsRef.current.hasAuth) {
        optsRef.current.onNeedAuth?.();
        return;
      }
      applyKey(key as UavKeyCode, true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (!(key in INITIAL_KEY_STATE)) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      applyKey(key as UavKeyCode, false);
    };

    const handleWindowBlur = () => {
      if (isAnyKeyPressed(keyStateRef.current)) {
        stopControlInternal("键盘手控停止（窗口失焦）");
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handleWindowBlur();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [opts.enabled, pushKeysToServer, stopControlInternal]);

  useEffect(() => {
    if (!opts.pollDrcStatus || !opts.airportSN) return;
    let cancelled = false;
    const poll = () => {
      void fetchUavDrcSessionStatus(opts.airportSN!).then((ret) => {
        if (!cancelled && ret.ok) setDrcStatus(ret);
      });
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [opts.pollDrcStatus, opts.airportSN]);

  const stopControl = useCallback(() => {
    stopControlInternal();
  }, [stopControlInternal]);

  const drcDebugLine = formatUavDrcDebugLine(drcStatus, {
    mqttRxConnected: opts.mqttRxConnected,
    keys: keyState,
  });

  return {
    keyState,
    isControlling,
    stopControl,
    drcStatus,
    drcDebugLine,
  };
}

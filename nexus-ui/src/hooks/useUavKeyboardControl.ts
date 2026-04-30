import { useEffect, useRef, useState, useCallback } from "react";
import type { UavStickControlPayload } from "@/hooks/useUavMqttDockState";
import { postUavStickControl } from "@/lib/eo-video/uavAuthClient";

/**
 * 无人机键盘手控 hook
 * 对应 C++ ptzmainwidget.cpp keyPressEvent/keyReleaseEvent + mainwindow.cpp slot_onUavStartCtrl
 */

export type UavKeyCode = "Q" | "W" | "E" | "A" | "S" | "D" | "Z" | "C";

export interface UavKeyState {
  Q: boolean; // yaw left (逆时针旋转)
  W: boolean; // pitch forward (前)
  E: boolean; // yaw right (顺时针旋转)
  A: boolean; // roll left (左平移)
  S: boolean; // pitch backward (后)
  D: boolean; // roll right (右平移)
  Z: boolean; // throttle down (下降)
  C: boolean; // throttle up (上升)
}

const KEY_VALUES: Record<UavKeyCode, number> = {
  Q: 440,
  W: 660,
  E: 440,
  A: 660,
  S: 660,
  D: 660,
  Z: 550,
  C: 660,
};

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

export interface UseUavKeyboardControlOpts {
  /** 是否启用键盘控制 */
  enabled: boolean;
  /** 机场 SN */
  airportSN: string | null;
  /** 是否已授权控制 */
  hasAuth: boolean;
  /** 日志回调 */
  onLog?: (line: string) => void;
  /** 未授权时的回调 */
  onNeedAuth?: () => void;
  /**
   * 浏览器经 WS MQTT 直连下发 stick_control（与 `useUavMqttDockState().publishStickControl` 一致）。
   * 返回 true 表示已由 MQTT 发出，跳过 HTTP `/api/uav-control/stick`。
   */
  publishStickMqtt?: (payload: UavStickControlPayload) => boolean;
}

export function useUavKeyboardControl(opts: UseUavKeyboardControlOpts) {
  const [keyState, setKeyState] = useState<UavKeyState>(INITIAL_KEY_STATE);
  const seqRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSendRef = useRef(0);

  const isAnyKeyPressed = Object.values(keyState).some((v) => v);

  // 启动 50ms 定时器
  useEffect(() => {
    if (!opts.enabled || !opts.airportSN || !opts.hasAuth || !isAnyKeyPressed) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        const now = Date.now();
        if (now - lastSendRef.current < 45) return; // 防止发送过快

        const roll = 1024 + (keyState.D ? KEY_VALUES.D : 0) - (keyState.A ? KEY_VALUES.A : 0);
        const pitch = 1024 + (keyState.W ? KEY_VALUES.W : 0) - (keyState.S ? KEY_VALUES.S : 0);
        const throttle = 1024 + (keyState.C ? KEY_VALUES.C : 0) - (keyState.Z ? KEY_VALUES.Z : 0);
        const yaw = 1024 + (keyState.E ? KEY_VALUES.E : 0) - (keyState.Q ? KEY_VALUES.Q : 0);

        const seq = seqRef.current;
        const stickPayload: UavStickControlPayload = { roll, pitch, throttle, yaw, seq };

        if (opts.publishStickMqtt?.(stickPayload)) {
          seqRef.current = (seqRef.current + 1) % 65536;
          lastSendRef.current = now;
          return;
        }

        postUavStickControl({
          airportSN: opts.airportSN!,
          roll,
          pitch,
          throttle,
          yaw,
          seq,
        }).catch(() => {
          /* 静默失败，避免日志刷屏 */
        });

        seqRef.current = (seqRef.current + 1) % 65536;
        lastSendRef.current = now;
      }, 50);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [opts.enabled, opts.airportSN, opts.hasAuth, opts.publishStickMqtt, isAnyKeyPressed, keyState]);

  // 键盘事件处理
  useEffect(() => {
    if (!opts.enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // 忽略按住重复
      const key = e.key.toUpperCase();
      if (!(key in INITIAL_KEY_STATE)) return;

      // 检查授权
      if (!opts.hasAuth) {
        opts.onNeedAuth?.();
        return;
      }

      setKeyState((prev) => {
        if (prev[key as UavKeyCode]) return prev; // 已经按下
        const newState = { ...prev, [key]: true };
        // 如果是第一个按键，记录日志
        if (!Object.values(prev).some((v) => v)) {
          opts.onLog?.(`键盘手控开始（${key}）`);
        }
        return newState;
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (!(key in INITIAL_KEY_STATE)) return;

      setKeyState((prev) => {
        if (!prev[key as UavKeyCode]) return prev; // 未按下
        const newState = { ...prev, [key]: false };
        // 如果全部释放，记录日志
        if (!Object.values(newState).some((v) => v)) {
          opts.onLog?.(`键盘手控停止`);
          seqRef.current = 0;
        }
        return newState;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [opts]);

  const stopControl = useCallback(() => {
    setKeyState(INITIAL_KEY_STATE);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    seqRef.current = 0;
  }, []);

  return {
    keyState,
    isControlling: isAnyKeyPressed,
    stopControl,
  };
}

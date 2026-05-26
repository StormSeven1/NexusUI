"use client";

import { useEffect, useRef } from "react";
import { announceAlarmOnce, seedSpokenAlarmIds, unlockAlarmSpeech } from "@/lib/alarm-speech";
import { useAlertStore } from "@/stores/alert-store";
import { useTrackStore } from "@/stores/track-store";

/**
 * 订阅 alert-store：每条告警（alarm_id = AlertData.id）仅语音播报一次。
 * 文案：「距离xx海里，方位xx度发现威胁目标，目标尾号xxxx」
 */
export function AlarmSpeechAnnouncer() {
  const alerts = useAlertStore((s) => s.alerts);
  const tracks = useTrackStore((s) => s.tracks);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    const unlock = () => unlockAlarmSpeech();
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!bootstrappedRef.current) {
      seedSpokenAlarmIds(alerts.map((a) => a.id));
      bootstrappedRef.current = true;
      return;
    }

    for (const alert of alerts) {
      announceAlarmOnce(alert, tracks);
    }
  }, [alerts, tracks]);

  return null;
}

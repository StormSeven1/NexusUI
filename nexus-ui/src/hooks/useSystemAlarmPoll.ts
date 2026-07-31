"use client";

/**
 * 每 2s 拉取 AlarmSys 系统告警全量快照（经 Next BFF `/api/system-alarms`），写入 alert-store。
 */

import { useEffect, useRef } from "react";

import {
  compareAlertNewestFirst,
  systemAlarmToAlertData,
  type SystemAlarmApiItem,
} from "@/lib/system-alarm";
import { useAlertStore } from "@/stores/alert-store";

const POLL_MS = 2_000;

type ApiResponse = {
  ok?: boolean;
  alarms?: SystemAlarmApiItem[];
  error?: string;
};

export function useSystemAlarmPoll() {
  const syncSystemAlarms = useAlertStore((s) => s.syncSystemAlarms);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/system-alarms", { cache: "no-store" });
        const body = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || body.ok === false) {
          // 上游短暂失败时不清空已有系统告警，避免列表闪空
          return;
        }
        const list = Array.isArray(body.alarms) ? body.alarms : [];
        const alerts = list
          .map(systemAlarmToAlertData)
          .sort(compareAlertNewestFirst);
        syncSystemAlarms(alerts);
      } catch {
        /* 网络错误：保留上次快照 */
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [syncSystemAlarms]);
}

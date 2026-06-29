import { useEffect, useState } from "react";
import { resolveQuickWorkflowDailyActiveUrl } from "@/lib/quick-workflow-client";

const POLL_MS = 5000;

/**
 * 顶栏「日常查证」是否应高亮：仅当任务管理中有运行中的 `auto_duty_workflow`。
 * 不用 DDS CameraVerification——区域航迹查证/搜索查证等助手工作流也会下发同名相机子任务。
 */
export function useAutoDutyDailyVerificationActive(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(resolveQuickWorkflowDailyActiveUrl(), { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { active?: boolean };
        if (!cancelled) setActive(Boolean(json.active));
      } catch {
        if (!cancelled) setActive(false);
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return active;
}

/** @deprecated 使用 `useAutoDutyDailyVerificationActive`；DDS 无法区分日常查证与助手查证 */
export function useDailyVerificationDdsActive(): boolean {
  return useAutoDutyDailyVerificationActive();
}

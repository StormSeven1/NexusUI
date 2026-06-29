"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, ClipboardCheck, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import { fetchActiveAlarmSchemeId } from "@/lib/alarm-scheme-api";
import {
  startDailyVerificationWorkflow,
  stopDailyVerificationCameras,
  stopDailyVerificationWorkflow,
} from "@/lib/daily-verification-workflow";
import { getHttpChatConfig } from "@/lib/map-app-config";
import {
  captureScreenOnceToPng,
  startTopNavScreenRecording,
  stopTopNavScreenRecording,
} from "@/lib/top-nav-capture";
import { useAutoDutyDailyVerificationActive } from "@/hooks/use-daily-verification-dds-active";

function quickBtnClass(active?: boolean) {
  return cn(
    "flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
    active
      ? "border-nexus-accent/60 bg-nexus-accent/15 text-nexus-accent"
      : "border-nexus-border bg-nexus-bg-elevated text-nexus-text-secondary hover:border-nexus-accent/40 hover:text-nexus-text-primary",
  );
}

export function TopNavQuickActions() {
  const dailyVerificationEnabled = useAppStore((s) => s.dailyVerificationEnabled);
  const setDailyVerificationEnabled = useAppStore((s) => s.setDailyVerificationEnabled);
  const pushDailyVerificationThreadId = useAppStore((s) => s.pushDailyVerificationThreadId);
  const clearDailyVerificationThreads = useAppStore((s) => s.clearDailyVerificationThreads);
  const dailyVerificationThreadIds = useAppStore((s) => s.dailyVerificationThreadIds);
  const autoDutyWorkflowActive = useAutoDutyDailyVerificationActive();
  const dailyVerificationButtonActive = dailyVerificationEnabled || autoDutyWorkflowActive;
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);

  const [screenRecording, setScreenRecording] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [dailyVerifyBusy, setDailyVerifyBusy] = useState(false);

  /** Qt/其它客户端启动 auto_duty_workflow 时，同步顶栏 checked（不含助手区域航迹查证等工作流） */
  useEffect(() => {
    if (autoDutyWorkflowActive && !dailyVerificationEnabled) {
      setDailyVerificationEnabled(true);
      return;
    }
    if (
      !autoDutyWorkflowActive &&
      dailyVerificationEnabled &&
      dailyVerificationThreadIds.length === 0
    ) {
      setDailyVerificationEnabled(false);
    }
  }, [
    autoDutyWorkflowActive,
    dailyVerificationEnabled,
    dailyVerificationThreadIds.length,
    setDailyVerificationEnabled,
  ]);

  /** 与 Qt `sig_dailyHandleToggled` → `ThreatListTable::sendDailyHandleTask` / `stopDailyHandleTask`（工作流模式 1）一致 */
  const onToggleDailyVerification = async () => {
    if (dailyVerifyBusy) return;
    if (dailyVerificationButtonActive) {
      setDailyVerifyBusy(true);
      try {
        const ids = [...dailyVerificationThreadIds];
        const stopRet = await stopDailyVerificationWorkflow({ localThreadIds: ids });
        const cfg = await useAppConfigStore.getState().ensureLoaded();
        if (cfg.cameraManagement) {
          await stopDailyVerificationCameras(cfg.cameraManagement);
        }
        clearDailyVerificationThreads();
        setDailyVerificationEnabled(false);
        if (!stopRet.ok && stopRet.error) {
          toast.error("日常查证停止异常", { description: stopRet.error });
        } else {
          const n = stopRet.terminated.length;
          toast.success("日常查证已结束", {
            description: n > 0 ? `已终止 ${n} 个工作流线程` : "已请求停止查证任务",
          });
        }
      } finally {
        setDailyVerifyBusy(false);
      }
      return;
    }

    setDailyVerifyBusy(true);
    try {
      await useAppConfigStore.getState().ensureLoaded();
      const chat = getHttpChatConfig();
      const wf = chat.dailyVerificationWorkflowId?.trim() || "auto_duty_workflow-quick-1";
      const schemeRet = await fetchActiveAlarmSchemeId();
      if (!schemeRet.ok) {
        toast.error("日常查证启动失败", { description: schemeRet.error });
        return;
      }
      const ret = await startDailyVerificationWorkflow({
        workflowId: wf,
        schemaId: schemeRet.schemeId,
      });
      if (!ret.ok) {
        toast.error("日常查证启动失败", { description: ret.error });
        return;
      }
      pushDailyVerificationThreadId(ret.threadId);
      setDailyVerificationEnabled(true);
      if (!rightSidebarOpen) toggleRightSidebar();
      setRightPanelTab("chat");
      toast.success("日常查证已启动", {
        description: `scheme_id=${schemeRet.schemeId} · ${ret.threadId}`,
      });
    } catch (e) {
      toast.error("日常查证异常", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDailyVerifyBusy(false);
    }
  };

  const onScreenshot = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("截屏不可用", { description: "当前浏览器不支持屏幕共享 API" });
      return;
    }
    setCaptureBusy(true);
    try {
      await captureScreenOnceToPng();
      toast.success("截屏已保存", { description: "已下载 PNG 文件" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("abort") && !msg.includes("NotAllowedError")) {
        toast.error("截屏失败", { description: msg });
      }
    } finally {
      setCaptureBusy(false);
    }
  };

  const onToggleRecord = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("录屏不可用", { description: "当前浏览器不支持屏幕共享 API" });
      return;
    }
    if (screenRecording) {
      stopTopNavScreenRecording();
      return;
    }
    const ok = await startTopNavScreenRecording({
      onError: (msg) => {
        setScreenRecording(false);
        if (!msg.toLowerCase().includes("abort") && !msg.includes("NotAllowedError")) {
          toast.error("录屏启动失败", { description: msg });
        }
      },
      onStopped: () => setScreenRecording(false),
    });
    if (ok) {
      setScreenRecording(true);
      toast.message("录屏中", { description: "再次点击「录屏」或结束共享后保存 WebM" });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={quickBtnClass(dailyVerificationButtonActive)}
        disabled={dailyVerifyBusy}
        title="开启：POST quick-workflow 启动自主值班查证。关闭：查工作流 history 终止全部运行中的 auto_duty_workflow，并停止对海/对空光电查证（任意客户端均可停止）。"
        onClick={() => void onToggleDailyVerification()}
      >
        <ClipboardCheck size={13} />
        <span className="hidden xl:inline">{dailyVerifyBusy ? "查证…" : "日常查证"}</span>
      </button>

      <button
        type="button"
        className={quickBtnClass(false)}
        disabled={captureBusy}
        title="选择共享画面后保存一帧 PNG"
        onClick={() => void onScreenshot()}
      >
        <Camera size={13} />
        <span className="hidden xl:inline">截屏</span>
      </button>

      <button
        type="button"
        className={quickBtnClass(screenRecording)}
        title="选择共享区域后录屏为 WebM；再次点击结束"
        onClick={() => void onToggleRecord()}
      >
        <Video size={13} />
        <span className="hidden xl:inline">{screenRecording ? "录屏中" : "录屏"}</span>
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Camera, ClipboardCheck, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import {
  startDailyVerificationWorkflow,
  terminateDailyVerificationThreads,
} from "@/lib/daily-verification-workflow";
import { getHttpChatConfig } from "@/lib/map-app-config";
import {
  captureScreenOnceToPng,
  startTopNavScreenRecording,
  stopTopNavScreenRecording,
} from "@/lib/top-nav-capture";

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
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);

  const [screenRecording, setScreenRecording] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [dailyVerifyBusy, setDailyVerifyBusy] = useState(false);

  /** 与 Qt `sig_dailyHandleToggled` → `ThreatListTable::sendDailyHandleTask` / `stopDailyHandleTask`（工作流模式 1）一致 */
  const onToggleDailyVerification = async () => {
    if (dailyVerifyBusy) return;
    if (dailyVerificationEnabled) {
      setDailyVerifyBusy(true);
      try {
        const ids = [...dailyVerificationThreadIds];
        await terminateDailyVerificationThreads(ids);
        clearDailyVerificationThreads();
        setDailyVerificationEnabled(false);
        toast.success("日常查证已结束", {
          description: ids.length ? `已请求终止 ${ids.length} 个工作流线程` : "已关闭",
        });
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
      const schema = chat.dailyVerificationSchemaId?.trim() ?? "";
      const ret = await startDailyVerificationWorkflow({
        workflowId: wf,
        schemaId: schema,
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
        description: `POST ${chat.quickWorkflowUrl?.slice(0, 48) ?? ""}… · ${ret.threadId}`,
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
        className={quickBtnClass(dailyVerificationEnabled)}
        disabled={dailyVerifyBusy}
        title="与 Qt 一致：开启 POST http.chat.quickWorkflowUrl（自主值班查证工作流），关闭 POST …/workflows/{threadId}/terminate。需配置 dailyVerificationSchemaId。"
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

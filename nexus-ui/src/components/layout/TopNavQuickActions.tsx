"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, ClipboardCheck, ScanSearch, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
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
import {
  describeBirdCaptureBlockReason,
  listFuseAirBirdCaptureCandidates,
} from "@/lib/fuse-air-bird-capture";
import {
  checkBirdRadarCaptureBackend,
  fetchBirdRadarCaptureStatus,
  startBirdRadarCapture,
  stopBirdRadarCapture,
} from "@/lib/bird-radar-capture-api";
import { BirdRadarCaptureUploadDialog } from "@/components/layout/BirdRadarCaptureUploadDialog";

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

  const [birdCaptureEnabled, setBirdCaptureEnabled] = useState(false);
  const [birdCaptureBusy, setBirdCaptureBusy] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadRowCount, setUploadRowCount] = useState(0);
  const [uploadAutoStopped, setUploadAutoStopped] = useState(false);
  const autoStopHandledRef = useRef<string | null>(null);

  const openUploadDialog = useCallback(
    (stopResult: { filename: string; rowCount: number; stopReason?: string }) => {
      setUploadBlob(null);
      setUploadFileName(stopResult.filename);
      setUploadRowCount(stopResult.rowCount);
      setUploadAutoStopped(Boolean(stopResult.stopReason?.startsWith("auto_idle")));
      setUploadDialogOpen(true);
    },
    [],
  );

  /** 页面加载时同步后端采集状态（外部 API 也可能已启动） */
  useEffect(() => {
    void (async () => {
      try {
        const st = await fetchBirdRadarCaptureStatus();
        if (st.recording) setBirdCaptureEnabled(true);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  /** 轮询后端采集状态：1min 无 qualifying 航迹时自动停止并弹上传框 */
  useEffect(() => {
    if (!birdCaptureEnabled) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const st = await fetchBirdRadarCaptureStatus();
          if (!st.recording && st.autoStopped?.ok) {
            const sid = st.autoStopped.sessionId;
            if (autoStopHandledRef.current === sid) return;
            autoStopHandledRef.current = sid;
            setBirdCaptureEnabled(false);
            toast.message("探鸟采集已自动结束", {
              description: "超过 1 分钟未再出现自报位+探鸟融合航迹",
            });
            await openUploadDialog(st.autoStopped);
          } else if (!st.recording && birdCaptureEnabled) {
            setBirdCaptureEnabled(false);
          }
        } catch {
          /* 后端未就绪时忽略 */
        }
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [birdCaptureEnabled, openUploadDialog]);

  const onToggleBirdRadarCapture = async () => {
    if (birdCaptureBusy) return;

    if (birdCaptureEnabled) {
      setBirdCaptureBusy(true);
      try {
        const ret = await stopBirdRadarCapture("ui");
        setBirdCaptureEnabled(false);
        if (!ret.ok) {
          toast.error("探鸟采集停止失败", { description: ret.message });
          return;
        }
        toast.success("探鸟采集已结束", {
          description: `${ret.filename} · ${ret.rowCount} 行`,
        });
        await openUploadDialog(ret);
      } finally {
        setBirdCaptureBusy(false);
      }
      return;
    }

    setBirdCaptureBusy(true);
    try {
      await useAppConfigStore.getState().ensureLoaded();
      const tracks = useTrackStore.getState().tracks;
      const candidates = listFuseAirBirdCaptureCandidates(tracks);
      if (candidates.length === 0) {
        toast.error("无法开始探鸟采集", {
          description: describeBirdCaptureBlockReason(tracks),
        });
        return;
      }

      const backendCheck = await checkBirdRadarCaptureBackend();
      if (!backendCheck.ok) {
        toast.error("无法开始探鸟采集", { description: backendCheck.message });
        return;
      }

      const ret = await startBirdRadarCapture("ui");
      if (!ret.ok) {
        toast.error("探鸟采集启动失败", { description: ret.message });
        return;
      }

      autoStopHandledRef.current = null;
      setBirdCaptureEnabled(true);
      toast.success("探鸟采集已开始", {
        description: `探鸟批号 ${ret.pihaos.join(", ")} · ${ret.filename}`,
      });
    } catch (e) {
      toast.error("探鸟采集异常", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBirdCaptureBusy(false);
    }
  };

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
    <>
      <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
        <button
          type="button"
          className={quickBtnClass(birdCaptureEnabled)}
          disabled={birdCaptureBusy}
          title="开启：校验对空融合含自报位+探鸟雷达后开始记录 CSV。关闭：结束采集并上传 DataLink。超过 1 分钟无符合条件航迹将自动停止。"
          onClick={() => void onToggleBirdRadarCapture()}
        >
          <ScanSearch size={13} className="shrink-0" />
          <span className="whitespace-nowrap">
            {birdCaptureBusy ? "探鸟…" : birdCaptureEnabled ? "探鸟采集中" : "探鸟采集"}
          </span>
        </button>

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

      <BirdRadarCaptureUploadDialog
        open={uploadDialogOpen}
        onClose={() => {
          setUploadDialogOpen(false);
          setUploadBlob(null);
        }}
        fileName={uploadFileName}
        rowCount={uploadRowCount}
        blob={uploadBlob}
        autoStopped={uploadAutoStopped}
      />
    </>
  );
}

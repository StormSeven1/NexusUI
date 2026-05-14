"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Boxes, Camera, ClipboardCheck, Home, Video, ChevronDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import {
  startDailyVerificationWorkflow,
  terminateDailyVerificationThreads,
} from "@/lib/daily-verification-workflow";
import { useUavQuickContextStore } from "@/stores/uav-quick-context-store";
import { postUavControlAction } from "@/lib/eo-video/uavControlClient";
import { getHttpChatConfig, type SoftwareCompositionLinkItem } from "@/lib/map-app-config";
import { getAllFleetAirportSNs, primaryDroneSnForAirport } from "@/lib/uav-fleet-airports";
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
  const lastAirportSN = useUavQuickContextStore((s) => s.lastAirportSN);
  const lastDeviceSN = useUavQuickContextStore((s) => s.lastDeviceSN);

  const [links, setLinks] = useState<SoftwareCompositionLinkItem[]>([]);
  const [softOpen, setSoftOpen] = useState(false);
  const softBtnRef = useRef<HTMLButtonElement>(null);
  const softMenuRef = useRef<HTMLUListElement>(null);
  const [softAnchor, setSoftAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [hotbackBusy, setHotbackBusy] = useState(false);
  const [screenRecording, setScreenRecording] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [dailyVerifyBusy, setDailyVerifyBusy] = useState(false);

  useEffect(() => {
    void useAppConfigStore
      .getState()
      .ensureLoaded()
      .then((c) => setLinks(c.softwareCompositionLinks ?? []))
      .catch(() => setLinks([]));
  }, []);

  const updateSoftAnchor = useCallback(() => {
    const el = softBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSoftAnchor({
      left: Math.max(8, r.right - 200),
      top: r.bottom + 4,
      width: Math.max(200, r.width),
    });
  }, []);

  useEffect(() => {
    if (!softOpen) return;
    updateSoftAnchor();
    const onScroll = () => setSoftOpen(false);
    const onResize = () => updateSoftAnchor();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [softOpen, updateSoftAnchor]);

  useEffect(() => {
    if (!softOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (softBtnRef.current?.contains(t)) return;
      if (softMenuRef.current?.contains(t)) return;
      setSoftOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSoftOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [softOpen]);

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

  const onReturnAllDrones = async () => {
    const airports = getAllFleetAirportSNs(lastAirportSN).sort();
    if (airports.length === 0) {
      toast.error("一键返航失败", {
        description: "未发现任何机场 SN（需 WS 机务关系或光电视频已解析 MQTT 机场）",
      });
      return;
    }
    setReturnBusy(true);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    try {
      for (const ap of airports) {
        const device =
          primaryDroneSnForAirport(ap) ??
          (lastAirportSN?.trim() === ap ? lastDeviceSN?.trim() || undefined : undefined);
        try {
          const ret = await postUavControlAction({
            action: "back",
            airportSN: ap,
            deviceSN: device,
          });
          if (ret.ok) ok += 1;
          else {
            fail += 1;
            errors.push(`${ap}: 未确认成功`);
          }
        } catch (e) {
          fail += 1;
          errors.push(`${ap}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (fail === 0) {
        toast.success("一键返航已下发", { description: `共 ${ok} 个机场（全部无人机返航）` });
      } else {
        toast.warning("一键返航部分失败", {
          description: `成功 ${ok}，失败 ${fail}。${errors.slice(0, 3).join("；")}${errors.length > 3 ? "…" : ""}`,
        });
      }
    } finally {
      setReturnBusy(false);
    }
  };

  const onHotbackAll = async () => {
    const airports = getAllFleetAirportSNs(lastAirportSN).sort();
    if (airports.length === 0) {
      toast.error("一键热备失败", {
        description: "未发现任何机场 SN（需 WS 机务关系或光电视频已解析 MQTT 机场）",
      });
      return;
    }
    setHotbackBusy(true);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    try {
      for (const ap of airports) {
        const device =
          primaryDroneSnForAirport(ap) ??
          (lastAirportSN?.trim() === ap ? lastDeviceSN?.trim() || undefined : undefined);
        try {
          const ret = await postUavControlAction({
            action: "hotback",
            airportSN: ap,
            deviceSN: device,
          });
          if (ret.ok) ok += 1;
          else {
            fail += 1;
            errors.push(`${ap}: 未确认成功`);
          }
        } catch (e) {
          fail += 1;
          errors.push(`${ap}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (fail === 0) {
        toast.success("一键热备已下发", { description: `共 ${ok} 个机场（debug_mode_open）` });
      } else {
        toast.warning("一键热备部分失败", {
          description: `成功 ${ok}，失败 ${fail}。${errors.slice(0, 3).join("；")}${errors.length > 3 ? "…" : ""}`,
        });
      }
    } finally {
      setHotbackBusy(false);
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

  const openSoftwareLink = (url: string) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("无法打开链接", { description: url });
    }
    setSoftOpen(false);
  };

  const softMenu =
    softOpen &&
    softAnchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={softMenuRef}
        role="menu"
        className="fixed z-[600] max-h-[min(320px,70vh)] overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{
          left: softAnchor.left,
          top: softAnchor.top,
          minWidth: softAnchor.width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {links.length === 0 ? (
          <li className="px-3 py-2 text-nexus-text-muted">未配置外链（app-config.json → softwareCompositionLinks）</li>
        ) : (
          links.map((item) => (
            <li key={`${item.label}-${item.url}`} role="none">
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
                onClick={() => openSoftwareLink(item.url)}
              >
                {item.label}
              </button>
            </li>
          ))
        )}
      </ul>,
      document.body,
    );

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
        disabled={returnBusy}
        title="对当前 WS 中全部机场依次下发返航（与 Qt uavctrlboard 单机场返航接口相同，逐台执行）"
        onClick={() => void onReturnAllDrones()}
      >
        <Home size={13} />
        <span className="hidden xl:inline">一键返航</span>
      </button>

      <button
        type="button"
        className={quickBtnClass(false)}
        disabled={hotbackBusy}
        title="对全部机场依次下发热备（debug_mode_open，与 Qt 热备按钮一致）"
        onClick={() => void onHotbackAll()}
      >
        <Zap size={13} />
        <span className="hidden xl:inline">一键热备</span>
      </button>

      <div className="relative flex items-center">
        <button
          ref={softBtnRef}
          type="button"
          className={quickBtnClass(softOpen)}
          title="打开各管理子系统页面（URL 见 app-config.json）"
          aria-expanded={softOpen}
          onClick={() => {
            if (softOpen) setSoftOpen(false);
            else {
              updateSoftAnchor();
              setSoftOpen(true);
            }
          }}
        >
          <Boxes size={13} />
          <span className="hidden xl:inline">软件组成</span>
          <ChevronDown className={cn("h-3 w-3 shrink-0 opacity-70", softOpen && "rotate-180")} />
        </button>
        {softMenu}
      </div>

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

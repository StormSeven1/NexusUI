"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Crosshair, Eye, Map, MessageSquare, Plane, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PanelId } from "@/stores/dock-store";
import { useDockStore } from "@/stores/dock-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import { useUavQuickContextStore } from "@/stores/uav-quick-context-store";
import { postUavControlAction } from "@/lib/eo-video/uavControlClient";
import { getAllFleetAirportSNs, primaryDroneSnForAirport } from "@/lib/uav-fleet-airports";
import { stopAllPtzCameraTasks } from "@/lib/stop-all-ptz-camera-tasks";
import type { SoftwareCompositionLinkItem } from "@/lib/map-app-config";
import {
  isDockPanelOpen,
  openDockPanelFromMenu,
} from "@/lib/dock/open-dock-panel-from-menu";
import { openElectroOpticalDockPopup } from "@/components/eo-video/EoVideoTopLauncher";
import { EoMotionParamsDialog } from "@/components/eo-video/EoMotionParamsDialog";
import { DroneSettingsDialog, type DroneSettingsPanelAnchor } from "@/components/layout/DroneSettingsDialog";
import { NetworkStatsDialog } from "@/components/layout/NetworkStatsDialog";
import { useDockLayoutSubmenu } from "@/components/layout/DockLayoutSubmenu";
import { openEvalReportPreview } from "@/lib/eval-report/open-eval-report-preview";

type DockMenuItem = {
  kind: "dock";
  panelId: PanelId;
  label: string;
};

type ActionMenuItem = {
  kind: "action";
  label: string;
  title?: string;
};

type SubmenuMenuItem = {
  kind: "submenu";
  id: "software" | "layout";
  label: string;
  title?: string;
};

type MenuItem = DockMenuItem | ActionMenuItem | SubmenuMenuItem;

type MenuCategory = {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  items: MenuItem[];
};

const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: "situation",
    label: "态势",
    icon: Map,
    description: "图层管理与显示控制",
    items: [
      { kind: "dock", panelId: "layers", label: "图层" },
      { kind: "dock", panelId: "track-display", label: "显示" },
    ],
  },
  {
    id: "target",
    label: "目标",
    icon: Crosshair,
    description: "目标列表与目标档案",
    items: [
      { kind: "dock", panelId: "tracks", label: "目标列表" },
      { kind: "dock", panelId: "target-profile", label: "目标档案" },
    ],
  },
  {
    id: "eo",
    label: "光电",
    icon: Eye,
    description: "光电视频窗口与相机任务",
    items: [
      { kind: "action", label: "新建光电窗口", title: "打开新的光电视频窗口" },
      { kind: "action", label: "运动参数", title: "光电运动参数 / 对准参数（ConfigMotion · aimConf）" },
      { kind: "action", label: "停止全部相机任务", title: "对所有 hasPtz 相机下发 CancelAllMetaTasks" },
    ],
  },
  {
    id: "uav",
    label: "无人机",
    icon: Plane,
    description: "飞行设置与一键控制",
    items: [
      { kind: "action", label: "无人机飞行设置", title: "无人机参数与飞行控制" },
      { kind: "action", label: "一键热备", title: "对全部机场依次下发热备" },
      { kind: "action", label: "一键取消热备", title: "对全部机场依次下发取消热备（debug_mode_close）" },
      { kind: "action", label: "一键返航", title: "对全部机场依次下发返航" },
    ],
  },
  {
    id: "ai",
    label: "智能",
    icon: MessageSquare,
    description: "智能助手（含知识库模式）",
    items: [
      { kind: "dock", panelId: "chat", label: "智能助手" },
    ],
  },
  {
    id: "system",
    label: "系统",
    icon: Settings2,
    description: "系统评估、资产与布局",
    items: [
      { kind: "dock", panelId: "alerts", label: "告警" },
      { kind: "dock", panelId: "system-evaluation", label: "系统评估" },
      {
        kind: "action",
        label: "生成评估报告",
        title: "执行系统/航迹/光电评估并生成报告预览",
      },
      { kind: "dock", panelId: "assets", label: "资产列表" },
      { kind: "action", label: "数据状态", title: "各数据源接收间隔" },
      { kind: "submenu", id: "layout", label: "布局", title: "保存或恢复窗口布局" },
      { kind: "submenu", id: "software", label: "软件组成", title: "打开各管理子系统页面" },
    ],
  },
];

const MENU_ROW_BTN =
  "flex w-full items-center gap-0 px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10";

/** 与旧版 TopNav「态势/资产/任务」Tab 一致的全高顶栏样式 */
function categoryTabClass(active?: boolean) {
  return cn(
    "group relative flex h-full shrink-0 items-center gap-2 px-4 text-sm font-medium transition-all duration-200",
    active
      ? "bg-nexus-accent-glow text-nexus-text-primary border-b-2 border-nexus-accent"
      : "text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary",
  );
}

/** 统一左侧占位：dock 打开 / 对话框打开时显示绿点 */
function MenuStatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
        active ? "bg-emerald-500" : "bg-transparent",
      )}
      aria-hidden
    />
  );
}

function MenuRowLabel(props: { label: string; chevron?: boolean }) {
  const { label, chevron } = props;
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chevron ? <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
    </>
  );
}

export function TopNavCategoryMenu() {
  const panels = useDockStore((s) => s.panels);
  const lastAirportSN = useUavQuickContextStore((s) => s.lastAirportSN);
  const lastDeviceSN = useUavQuickContextStore((s) => s.lastDeviceSN);

  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [softFlyout, setSoftFlyout] = useState(false);
  const [softFlyoutAnchor, setSoftFlyoutAnchor] = useState<DOMRect | null>(null);
  const [links, setLinks] = useState<SoftwareCompositionLinkItem[]>([]);

  const [droneSettingsOpen, setDroneSettingsOpen] = useState(false);
  const [dronePanelAnchor, setDronePanelAnchor] = useState<DroneSettingsPanelAnchor | null>(null);
  const [networkStatsOpen, setNetworkStatsOpen] = useState(false);
  const [motionParamsOpen, setMotionParamsOpen] = useState(false);

  const [returnBusy, setReturnBusy] = useState(false);
  const [hotbackBusy, setHotbackBusy] = useState(false);
  const [hotbackCloseBusy, setHotbackCloseBusy] = useState(false);
  const [stopCameraBusy, setStopCameraBusy] = useState(false);

  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLUListElement>(null);
  const softRowRef = useRef<HTMLButtonElement>(null);
  const softFlyoutRef = useRef<HTMLUListElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  const {
    layoutRowRef,
    layoutMenuRef,
    flyoutMenuRef,
    openLayoutFlyout,
    closeLayoutFlyouts,
    layoutFlyoutOpen,
    layoutPrimaryFlyout,
    saveFlyout,
    restoreFlyout,
    nameDialogEl,
  } = useDockLayoutSubmenu();

  useEffect(() => {
    void useAppConfigStore
      .getState()
      .ensureLoaded()
      .then((c) => setLinks(c.softwareCompositionLinks ?? []))
      .catch(() => setLinks([]));
  }, []);

  const closeAll = useCallback(() => {
    setOpenCategoryId(null);
    setSoftFlyout(false);
    setSoftFlyoutAnchor(null);
    closeLayoutFlyouts();
  }, [closeLayoutFlyouts]);

  const updateMenuAnchor = useCallback((categoryId: string) => {
    const el = btnRefs.current[categoryId];
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuAnchor({
      left: r.left,
      top: r.bottom + 4,
      minWidth: Math.max(168, r.width),
    });
  }, []);

  useEffect(() => {
    if (!openCategoryId) return;
    updateMenuAnchor(openCategoryId);
    const onScroll = () => closeAll();
    const onResize = () => updateMenuAnchor(openCategoryId);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [openCategoryId, closeAll, updateMenuAnchor]);

  useEffect(() => {
    if (!openCategoryId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (Object.values(btnRefs.current).some((el) => el?.contains(t))) return;
      if (menuRef.current?.contains(t)) return;
      if (softFlyoutRef.current?.contains(t)) return;
      if (layoutMenuRef.current?.contains(t)) return;
      if (flyoutMenuRef.current?.contains(t)) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openCategoryId, closeAll, layoutMenuRef, flyoutMenuRef]);

  const panelOpenMap = useCallback(
    (panelId: PanelId) => {
      void panels;
      return isDockPanelOpen(panelId);
    },
    [panels],
  );

  const onReturnAllDrones = async () => {
    const airports = getAllFleetAirportSNs(lastAirportSN).sort();
    setReturnBusy(true);
    try {
      for (const ap of airports) {
        const device =
          primaryDroneSnForAirport(ap) ??
          (lastAirportSN?.trim() === ap ? lastDeviceSN?.trim() || undefined : undefined);
        try {
          await postUavControlAction({ action: "back", airportSN: ap, deviceSN: device });
        } catch {
          /* 逐台执行，不中断 */
        }
      }
      toast.success("一键返航成功");
    } finally {
      setReturnBusy(false);
    }
  };

  const onHotbackAll = async () => {
    const airports = getAllFleetAirportSNs(lastAirportSN).sort();
    setHotbackBusy(true);
    try {
      for (const ap of airports) {
        const device =
          primaryDroneSnForAirport(ap) ??
          (lastAirportSN?.trim() === ap ? lastDeviceSN?.trim() || undefined : undefined);
        try {
          await postUavControlAction({ action: "hotback", airportSN: ap, deviceSN: device });
        } catch {
          /* 逐台执行，不中断 */
        }
      }
      toast.success("一键热备成功");
    } finally {
      setHotbackBusy(false);
    }
  };

  const onHotbackCloseAll = async () => {
    const airports = getAllFleetAirportSNs(lastAirportSN).sort();
    setHotbackCloseBusy(true);
    try {
      for (const ap of airports) {
        const device =
          primaryDroneSnForAirport(ap) ??
          (lastAirportSN?.trim() === ap ? lastDeviceSN?.trim() || undefined : undefined);
        try {
          await postUavControlAction({ action: "hotback_close", airportSN: ap, deviceSN: device });
        } catch {
          /* 逐台执行，不中断 */
        }
      }
      toast.success("一键取消热备成功");
    } finally {
      setHotbackCloseBusy(false);
    }
  };

  const onStopAllCameraTasks = async () => {
    if (stopCameraBusy) return;
    setStopCameraBusy(true);
    try {
      const cfg = await useAppConfigStore.getState().ensureLoaded();
      const cm = cfg.cameraManagement;
      if (!cm) {
        toast.error("停止相机任务失败", { description: "未配置 cameraManagement" });
        return;
      }
      const result = await stopAllPtzCameraTasks(cm, { refreshEntities: true });
      if (result.total === 0) {
        toast.message("停止全部相机任务", { description: "实体快照中未发现 hasPtz 相机" });
        return;
      }
      if (result.fail === 0) {
        toast.success("已停止全部相机任务", {
          description: `共 ${result.ok} 台 hasPtz 相机（CancelAllMetaTasks）`,
        });
        return;
      }
      if (result.ok > 0) {
        toast.warning("部分相机停止失败", {
          description: `成功 ${result.ok} / ${result.total} · ${result.errors.slice(0, 2).join("；")}`,
        });
      } else {
        toast.error("停止相机任务失败", {
          description: result.errors.slice(0, 2).join("；") || "全部下发失败",
        });
      }
    } catch (e) {
      toast.error("停止相机任务异常", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStopCameraBusy(false);
    }
  };

  const openDroneSettingsPanel = () => {
    const el = btnRefs.current.uav;
    if (el) {
      const r = el.getBoundingClientRect();
      setDronePanelAnchor({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    } else {
      setDronePanelAnchor({ top: 48, right: 12 });
    }
    setDroneSettingsOpen(true);
  };

  const handleAction = async (label: string) => {
    closeAll();
    switch (label) {
      case "新建光电窗口":
        openElectroOpticalDockPopup();
        break;
      case "运动参数":
        setMotionParamsOpen(true);
        break;
      case "停止全部相机任务":
        await onStopAllCameraTasks();
        break;
      case "无人机飞行设置":
        openDroneSettingsPanel();
        break;
      case "一键热备":
        await onHotbackAll();
        break;
      case "一键取消热备":
        await onHotbackCloseAll();
        break;
      case "一键返航":
        await onReturnAllDrones();
        break;
      case "数据状态":
        setNetworkStatsOpen(true);
        break;
      case "生成评估报告":
        openEvalReportPreview();
        break;
      default:
        break;
    }
  };

  const openSoftwareLink = (url: string) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("无法打开链接", { description: url });
    }
    closeAll();
  };

  const openCategory = openCategoryId ? MENU_CATEGORIES.find((c) => c.id === openCategoryId) : null;

  const dropdownMenu =
    openCategory &&
    menuAnchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={menuRef}
        role="menu"
        className="fixed z-[600] overflow-visible rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{
          left: menuAnchor.left,
          top: menuAnchor.top,
          minWidth: menuAnchor.minWidth,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {openCategory.items.map((item) => {
          if (item.kind === "dock") {
            const isOpen = panelOpenMap(item.panelId);
            return (
              <li key={item.panelId} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ROW_BTN}
                  onClick={() => {
                    closeAll();
                    openDockPanelFromMenu(item.panelId);
                  }}
                >
                  <MenuStatusDot active={isOpen} />
                  <MenuRowLabel label={item.label} />
                </button>
              </li>
            );
          }

          if (item.kind === "submenu") {
            const isLayout = item.id === "layout";
            const rowRef = isLayout ? layoutRowRef : softRowRef;
            const flyoutActive = isLayout ? layoutFlyoutOpen : softFlyout;

            return (
              <li key={item.id} role="none">
                <button
                  ref={rowRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  title={item.title}
                  className={cn(MENU_ROW_BTN, flyoutActive && "bg-white/5")}
                  onMouseEnter={() => {
                    if (isLayout) {
                      setSoftFlyout(false);
                      setSoftFlyoutAnchor(null);
                      openLayoutFlyout();
                    } else {
                      closeLayoutFlyouts();
                      const el = softRowRef.current;
                      if (el) {
                        setSoftFlyout(true);
                        setSoftFlyoutAnchor(el.getBoundingClientRect());
                      }
                    }
                  }}
                  onFocus={() => {
                    if (isLayout) {
                      openLayoutFlyout();
                    } else {
                      const el = softRowRef.current;
                      if (el) {
                        setSoftFlyout(true);
                        setSoftFlyoutAnchor(el.getBoundingClientRect());
                      }
                    }
                  }}
                >
                  <MenuStatusDot active={false} />
                  <MenuRowLabel label={item.label} chevron />
                </button>
              </li>
            );
          }

          const busy =
            (item.label === "一键返航" && returnBusy) ||
            (item.label === "一键热备" && hotbackBusy) ||
            (item.label === "一键取消热备" && hotbackCloseBusy) ||
            (item.label === "停止全部相机任务" && stopCameraBusy);

          let actionLabel = item.label;
          if (item.label === "一键返航" && returnBusy) actionLabel = "返航中…";
          if (item.label === "一键热备" && hotbackBusy) actionLabel = "热备中…";
          if (item.label === "一键取消热备" && hotbackCloseBusy) actionLabel = "取消热备中…";
          if (item.label === "停止全部相机任务" && stopCameraBusy) actionLabel = "停止中…";

          const dotActive =
            (item.label === "数据状态" && networkStatsOpen) ||
            (item.label === "生成评估报告" && panelOpenMap("eval-report"));

          return (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                title={item.title}
                className={cn(MENU_ROW_BTN, busy && "cursor-wait opacity-60")}
                onClick={() => void handleAction(item.label)}
              >
                <MenuStatusDot active={dotActive} />
                <MenuRowLabel label={actionLabel} />
              </button>
            </li>
          );
        })}
      </ul>,
      document.body,
    );

  const softFlyoutMenu =
    softFlyout &&
    softFlyoutAnchor &&
    openCategoryId === "system" &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={softFlyoutRef}
        role="menu"
        className="fixed z-[610] max-h-[min(320px,70vh)] overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{
          left: softFlyoutAnchor.right + 4,
          top: softFlyoutAnchor.top,
          minWidth: 200,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseLeave={() => setSoftFlyout(false)}
      >
        {links.length === 0 ? (
          <li className="px-3 py-2 text-nexus-text-muted">
            未配置外链（app-config.json → softwareCompositionLinks）
          </li>
        ) : (
          links.map((linkItem) => (
            <li key={`${linkItem.label}-${linkItem.url}`} role="none">
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
                onClick={() => openSoftwareLink(linkItem.url)}
              >
                {linkItem.label}
              </button>
            </li>
          ))
        )}
      </ul>,
      document.body,
    );

  return (
    <>
      <nav className="flex h-full min-w-0 flex-1 items-center gap-0.5 px-2" aria-label="主菜单">
        {MENU_CATEGORIES.map((cat) => {
          const isOpen = openCategoryId === cat.id;
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              ref={(el) => {
                btnRefs.current[cat.id] = el;
              }}
              type="button"
              aria-expanded={isOpen}
              aria-haspopup="menu"
              title={cat.description}
              className={categoryTabClass(isOpen)}
              onClick={() => {
                if (isOpen) closeAll();
                else {
                  setOpenCategoryId(cat.id);
                  updateMenuAnchor(cat.id);
                }
              }}
            >
              <Icon size={16} className="shrink-0" />
              <span>{cat.label}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 opacity-40 transition-transform duration-200",
                  "group-hover:opacity-70",
                  isOpen && "rotate-180 opacity-70",
                )}
              />
            </button>
          );
        })}
      </nav>

      {dropdownMenu}
      {softFlyoutMenu}
      {layoutPrimaryFlyout}
      {saveFlyout}
      {restoreFlyout}
      {nameDialogEl}

      <DroneSettingsDialog
        open={droneSettingsOpen}
        anchor={dronePanelAnchor}
        onClose={() => setDroneSettingsOpen(false)}
      />
      <NetworkStatsDialog open={networkStatsOpen} onClose={() => setNetworkStatsOpen(false)} />
      <EoMotionParamsDialog open={motionParamsOpen} onClose={() => setMotionParamsOpen(false)} />
    </>
  );
}

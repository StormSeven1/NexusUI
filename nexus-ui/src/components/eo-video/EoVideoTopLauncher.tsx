"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDockStore } from "@/stores/dock-store";
import type { PanelId } from "@/stores/dock-store";
import { DroneSettingsDialog, type DroneSettingsPanelAnchor } from "@/components/layout/DroneSettingsDialog";
import { stopAllPtzCameraTasks } from "@/lib/stop-all-ptz-camera-tasks";
import { useAppConfigStore } from "@/stores/app-config-store";
import { toast } from "sonner";

const EO_WINDOW_POOL: PanelId[] = [
  "electro-optical-1",
  "electro-optical-2",
  "electro-optical-3",
  "electro-optical-4",
];

export function openElectroOpticalDockPopup() {
  if (typeof window === "undefined") return;
  const dock = useDockStore.getState();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pw = Math.min(960, w - 48);
  const ph = Math.min(540, h - 100);
  const x = Math.max(16, (w - pw) / 2);
  const y = Math.max(56, (h - ph) / 2);

  const panelStates = dock.panels;
  const targetPanelId =
    EO_WINDOW_POOL.find((id) => panelStates.find((p) => p.id === id)?.mode === "hidden") ??
    EO_WINDOW_POOL[0];

  dock.updatePanelState(targetPanelId, {
    mode: "popup",
    location: null,
    position: { x, y },
    size: { width: pw, height: ph },
  });
  dock.bringToFront(targetPanelId);
}

function systemFnBtnClass(active?: boolean) {
  return cn(
    "flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
    active
      ? "border-nexus-accent/60 bg-nexus-accent/15 text-nexus-accent"
      : "border-nexus-border bg-nexus-bg-elevated text-nexus-text-secondary hover:border-nexus-accent/40 hover:text-nexus-text-primary",
  );
}

export type FloatingPanelAnchor = DroneSettingsPanelAnchor;

/**
 * 顶栏「系统功能」下拉：新建光电窗口、无人机设置、停止全部相机任务。
 */
export function SystemFunctionsMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [droneSettingsOpen, setDroneSettingsOpen] = useState(false);
  const [stopCameraBusy, setStopCameraBusy] = useState(false);
  const [dronePanelAnchor, setDronePanelAnchor] = useState<FloatingPanelAnchor | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);

  const updateAnchor = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({
      left: Math.max(8, r.right - 192),
      top: r.bottom + 4,
      width: Math.max(192, r.width),
    });
  };

  const openDroneSettingsPanel = () => {
    const el = btnRef.current;
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

  const onStopAllCameraTasks = async () => {
    setMenuOpen(false);
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
        toast.message("停止全部相机任务", {
          description: "实体快照中未发现 hasPtz 相机",
        });
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

  useEffect(() => {
    if (!menuOpen) return;
    updateAnchor();
    const onScroll = () => setMenuOpen(false);
    const onResize = () => updateAnchor();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const menu =
    menuOpen &&
    anchor &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={menuRef}
        role="menu"
        className="fixed z-[600] overflow-hidden rounded-md border border-nexus-border bg-nexus-bg-elevated py-1 text-xs shadow-xl"
        style={{ left: anchor.left, top: anchor.top, minWidth: anchor.width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <li role="none">
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
            onClick={() => {
              setMenuOpen(false);
              openElectroOpticalDockPopup();
            }}
          >
            新建光电窗口
          </button>
        </li>
        <li role="none">
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10"
            onClick={() => {
              setMenuOpen(false);
              openDroneSettingsPanel();
            }}
          >
            无人机设置
          </button>
        </li>
        <li role="none">
          <button
            type="button"
            role="menuitem"
            disabled={stopCameraBusy}
            className={cn(
              "flex w-full px-3 py-2 text-left text-nexus-text-primary hover:bg-white/10",
              stopCameraBusy && "cursor-wait opacity-60",
            )}
            onClick={() => void onStopAllCameraTasks()}
          >
            {stopCameraBusy ? "停止相机任务…" : "停止全部相机任务"}
          </button>
        </li>
      </ul>,
      document.body,
    );

  return (
    <>
      <div className="relative flex items-center">
        <button
          ref={btnRef}
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title="系统功能：光电窗口、无人机参数等"
          className={systemFnBtnClass(menuOpen)}
          onClick={() => {
            if (menuOpen) setMenuOpen(false);
            else {
              updateAnchor();
              setMenuOpen(true);
            }
          }}
        >
          <Settings2 size={13} />
          <span className="hidden xl:inline">系统功能</span>
          <ChevronDown className={cn("h-3 w-3 shrink-0 opacity-70", menuOpen && "rotate-180")} />
        </button>
        {menu}
      </div>
      <DroneSettingsDialog
        open={droneSettingsOpen}
        anchor={dronePanelAnchor}
        onClose={() => setDroneSettingsOpen(false)}
      />
    </>
  );
}

/** @deprecated 使用 SystemFunctionsMenu */
export const EoVideoTopLauncher = SystemFunctionsMenu;

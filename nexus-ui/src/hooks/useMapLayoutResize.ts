"use client";

import { useEffect } from "react";
import { getMapModules } from "@/lib/map-module-registry";
import { useDockStore } from "@/stores/dock-store";

/** 布局模式 / 侧栏宽度变化后通知 MapLibre 重算尺寸，避免地图空白或图层不刷新 */
export function useMapLayoutResize() {
  const layoutMode = useDockStore((s) => s.layoutMode);
  const rightSidebarWidth = useDockStore((s) => s.rightSidebarWidth);
  const leftSidebarOpen = useDockStore((s) => s.leftSidebarOpen);
  const leftSidebarWidth = useDockStore((s) => s.leftSidebarWidth);

  useEffect(() => {
    const run = () => {
      getMapModules()?.map.resize();
    };
    const id = requestAnimationFrame(run);
    const t = window.setTimeout(run, 320);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [layoutMode, rightSidebarWidth, leftSidebarOpen, leftSidebarWidth]);
}

"use client";

import { Button } from "@/components/ui/button";
import { useDockStore } from "@/stores/dock-store";
import type { PanelId } from "@/stores/dock-store";

const EO_WINDOW_POOL: PanelId[] = [
  "electro-optical-1",
  "electro-optical-2",
  "electro-optical-3",
  "electro-optical-4",
];

function openElectroOpticalDockPopup() {
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

/**
 * 顶栏「光电」：以 dock 浮窗打开（无边框对话壳，内容即视频），可拖拽吸附到左右侧栏分区。
 */
export function EoVideoTopLauncher() {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="h-7 border-nexus-border bg-nexus-glass px-2 text-[11px] text-nexus-text-secondary hover:border-nexus-accent hover:text-nexus-accent"
      onClick={openElectroOpticalDockPopup}
    >
      光电
    </Button>
  );
}

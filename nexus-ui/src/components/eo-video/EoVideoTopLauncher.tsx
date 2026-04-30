"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EoVideoPanel } from "./EoVideoPanel";

/**
 * 顶栏「光电」测试入口：打开全屏遮罩内的光电窗口（WebRTC + 右键切流 + WS 检测框）。
 */
export function EoVideoTopLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-7 border-nexus-border bg-nexus-glass px-2 text-[11px] text-nexus-text-secondary hover:border-nexus-accent hover:text-nexus-accent"
        onClick={() => setOpen(true)}
      >
        光电
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="光电测试窗口"
        >
          <div className="relative flex h-[min(76vh,720px)] w-[min(96vw,1100px)] max-w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-nexus-bg-surface shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2">
              <span className="text-xs font-semibold tracking-wide text-nexus-text-primary">
                光电测试窗 · camera_004
              </span>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => setOpen(false)} aria-label="关闭">
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <EoVideoPanel
                className="h-full min-h-[320px]"
                entityId="camera_004"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

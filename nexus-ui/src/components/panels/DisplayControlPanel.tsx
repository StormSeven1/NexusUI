"use client";

import { cn } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { TrackDisplayPanel } from "@/components/panels/TrackDisplayPanel";
import { DistanceRingDisplayTab } from "@/components/panels/DistanceRingDisplayTab";

type DisplayControlTab = "tracks" | "distance-rings";

const TABS: { id: DisplayControlTab; label: string }[] = [
  { id: "tracks", label: "航迹显示" },
  { id: "distance-rings", label: "态势显示" },
];

export function DisplayControlPanel() {
  const [tab, setTab] = useState<DisplayControlTab>("tracks");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-nexus-text-muted" />
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            显示控制
          </span>
        </div>
        <div className="mt-2 flex gap-1 rounded-md border border-nexus-border bg-nexus-bg-surface/60 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors",
                tab === t.id
                  ? "bg-nexus-accent-glow/20 text-nexus-text-primary"
                  : "text-nexus-text-muted hover:text-nexus-text-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === "tracks" ? (
          <>
            <p className="mb-3 text-[10px] leading-snug text-nexus-text-muted">
              选择航迹类型后分别调整颜色、矢量与尾迹；各类型配色相互独立。
            </p>
            <TrackDisplayPanel embedded />
          </>
        ) : (
          <DistanceRingDisplayTab />
        )}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { MAP_LAYERS } from "@/lib/mock-data";
import { useAppStore } from "@/stores/app-store";
import { Eye, EyeOff, Map, Database, Layers as LayersIcon } from "lucide-react";

const TYPE_ICONS = {
  base: Map,
  overlay: LayersIcon,
  data: Database,
} as const;

const TYPE_LABELS = {
  base: "底图",
  overlay: "叠加层",
  data: "数据图层",
};

export function LayerPanel() {
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useAppStore((s) => s.toggleLayerVisibility);

  const layers = MAP_LAYERS.map((l) => ({
    ...l,
    visible: layerVisibility[l.id] ?? l.visible,
  }));

  const grouped = {
    base: layers.filter((l) => l.type === "base"),
    data: layers.filter((l) => l.type === "data"),
    overlay: layers.filter((l) => l.type === "overlay"),
  };

  const enabledCount = layers.filter((l) => l.visible).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            图层管理
          </span>
          <span className="text-[10px] text-nexus-text-muted">
            {enabledCount} 已启用
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {(Object.keys(grouped) as Array<keyof typeof grouped>).map((type) => (
          <div key={type}>
            <div className="flex items-center gap-2 border-b border-white/[0.04] bg-nexus-bg-surface/95 px-3 py-2">
              {(() => {
                const Icon = TYPE_ICONS[type];
                return <Icon size={12} className="text-nexus-text-muted" />;
              })()}
              <span className="text-[10px] font-semibold tracking-widest text-nexus-text-muted">
                {TYPE_LABELS[type]}
              </span>
            </div>
            {grouped[type].map((layer) => (
              <button
                key={layer.id}
                onClick={() => toggleLayerVisibility(layer.id)}
                className="flex w-full items-center gap-3 border-b border-nexus-border px-3 py-2.5 text-left hover:bg-nexus-bg-elevated"
              >
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                    layer.visible
                      ? "border-nexus-border-accent bg-nexus-accent-glow/20 text-nexus-text-primary"
                      : "border-nexus-border bg-nexus-bg-sidebar text-nexus-text-muted"
                  )}
                >
                  {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                </div>
                <span
                  className={cn(
                    "text-xs",
                    layer.visible
                      ? "text-nexus-text-primary"
                      : "text-nexus-text-muted"
                  )}
                >
                  {layer.name}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

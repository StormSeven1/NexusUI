"use client";

import { useTrackStore } from "@/stores/track-store";
import { useAssetStore } from "@/stores/asset-store";
import { cn } from "@/lib/utils";
import {
  Video,
  Radio,
  Signal,
  Eye,
  RotateCw,
  Maximize2,
  Camera,
  Crosshair,
} from "lucide-react";

interface SensorPanelProps {
  trackId: string;
}

export function SensorPanel({ trackId }: SensorPanelProps) {
  const track = useTrackStore((s) => s.tracks.find((t) => t.id === trackId));
  if (!track) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-nexus-text-muted">
        未找到航迹
      </div>
    );
  }

  const allAssets = useAssetStore.getState().assets;
  const relatedAssets = allAssets.filter(
    (a) => a.name.includes(track.sensor.split(" ")[0]) || a.status === "online"
  ).slice(0, 4);

  return (
    <div className="flex flex-col">
      {/* 主画面 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          主传感器画面
        </h4>
        <div className="relative aspect-video overflow-hidden rounded-md border border-white/[0.06] bg-black/60">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Video size={28} className="text-nexus-text-muted/50" />
            <span className="text-[10px] text-nexus-text-muted">
              {track.sensor} — EO/IR
            </span>
            <span className="text-[9px] text-nexus-text-muted/60">
              实时视频流
            </span>
          </div>

          {/* 扫描线效果 */}
          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.01)_2px,rgba(255,255,255,0.01)_4px)]" />

          {/* 角框 */}
          <div className="absolute left-2 top-2 h-5 w-5 border-l-2 border-t-2 border-white/20" />
          <div className="absolute right-2 top-2 h-5 w-5 border-r-2 border-t-2 border-white/20" />
          <div className="absolute bottom-2 left-2 h-5 w-5 border-b-2 border-l-2 border-white/20" />
          <div className="absolute bottom-2 right-2 h-5 w-5 border-b-2 border-r-2 border-white/20" />

          {/* 目标框 */}
          <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 border border-white/30">
            <div className="absolute -left-0.5 top-1/2 h-px w-1.5 -translate-y-1/2 bg-white/40" />
            <div className="absolute -right-0.5 top-1/2 h-px w-1.5 -translate-y-1/2 bg-white/40" />
            <div className="absolute left-1/2 -top-0.5 h-1.5 w-px -translate-x-1/2 bg-white/40" />
            <div className="absolute bottom-[-2px] left-1/2 h-1.5 w-px -translate-x-1/2 bg-white/40" />
          </div>

          {/* HUD 信息 */}
          <div className="absolute bottom-3 left-3 font-mono text-[9px] leading-relaxed text-white/40">
            <div>自动追踪 · {track.sensor}</div>
            <div>
              {track.lat.toFixed(4)}, {track.lng.toFixed(4)}
            </div>
            <div>方位 {track.heading}° · 距离 —</div>
          </div>

          {/* 右上角状态 */}
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-blink" />
            <span className="font-mono text-[9px] text-emerald-400/80">REC</span>
          </div>
        </div>

        {/* 画面控制栏 */}
        <div className="mt-2 flex items-center gap-1">
          <SensorBtn icon={Eye} label="EO" active />
          <SensorBtn icon={Camera} label="IR" />
          <SensorBtn icon={Crosshair} label="锁定" />
          <div className="flex-1" />
          <SensorBtn icon={RotateCw} label="复位" />
          <SensorBtn icon={Maximize2} label="全屏" />
        </div>
      </div>

      {/* 传感器信息 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          传感器参数
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <ParamRow label="传感器" value={track.sensor} />
          <ParamRow label="模式" value="主动追踪" />
          <ParamRow label="信号强度" value="良好" />
          <ParamRow label="更新频率" value="1 Hz" />
          <ParamRow label="精度" value="±5 m" />
          <ParamRow label="最后更新" value={track.lastUpdate} />
        </div>
      </div>

      {/* 关联传感器 */}
      <div className="p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          可用传感器
        </h4>
        <div className="space-y-1.5">
          {relatedAssets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center justify-between rounded border border-white/[0.04] bg-white/[0.02] px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <Radio size={12} className="text-nexus-text-muted" />
                <span className="text-[11px] text-nexus-text-secondary">
                  {asset.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    asset.status === "online" && "bg-emerald-400",
                    asset.status === "degraded" && "bg-amber-400",
                    asset.status === "offline" && "bg-red-400"
                  )}
                />
                <Signal size={10} className="text-nexus-text-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SensorBtn({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Eye;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-medium transition-colors",
        active
          ? "border-white/[0.12] bg-white/[0.08] text-nexus-text-primary"
          : "border-white/[0.06] bg-white/[0.02] text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary"
      )}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[10px] text-nexus-text-muted">{label}</div>
      <div className="font-mono text-[11px] text-nexus-text-primary">{value}</div>
    </div>
  );
}

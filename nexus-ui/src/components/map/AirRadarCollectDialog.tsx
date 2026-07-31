"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  postAirRadarCollectControl,
  postAirRadarCollectParams,
} from "@/lib/air-radar-collect-api";
import {
  AIR_RADAR_TARGET_TYPE_OPTIONS,
  AIR_RADAR_TRACK_TYPE_OPTIONS,
  useAirRadarCollectStore,
} from "@/stores/air-radar-collect-store";

const fieldCls =
  "h-8 w-full rounded border border-white/15 bg-black/30 px-2 text-xs text-nexus-text-primary outline-none focus:border-sky-500/50";
const labelCls = "text-[11px] text-nexus-text-muted";

export function AirRadarCollectDialog() {
  const open = useAirRadarCollectStore((s) => s.open);
  const mode = useAirRadarCollectStore((s) => s.mode);
  const collecting = useAirRadarCollectStore((s) => s.collecting);
  const pickMode = useAirRadarCollectStore((s) => s.pickMode);
  const trackId = useAirRadarCollectStore((s) => s.trackId);
  const targetType = useAirRadarCollectStore((s) => s.targetType);
  const trackType = useAirRadarCollectStore((s) => s.trackType);
  const aziCenter = useAirRadarCollectStore((s) => s.aziCenter);
  const disCenter = useAirRadarCollectStore((s) => s.disCenter);
  const aziRange = useAirRadarCollectStore((s) => s.aziRange);
  const disRange = useAirRadarCollectStore((s) => s.disRange);
  const close = useAirRadarCollectStore((s) => s.close);
  const setField = useAirRadarCollectStore((s) => s.setField);
  const enablePickMode = useAirRadarCollectStore((s) => s.enablePickMode);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (useAirRadarCollectStore.getState().pickMode) {
          setField("pickMode", false);
          return;
        }
        void postAirRadarCollectControl(1);
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, setField]);

  if (!open || typeof document === "undefined") return null;

  const title = mode === "auto" ? "自动采集对空雷达数据" : "手动采集对空雷达数据";

  const onStart = async () => {
    const ret = await postAirRadarCollectParams({
      collect_type: mode === "auto" ? 1 : 0,
      azi_center: Number(aziCenter) || 0,
      azi_range: Number(aziRange) || 0,
      dis_center: Number(disCenter) || 0,
      dis_range: Number(disRange) || 0,
      target_type: targetType,
      track_type: trackType,
      track_id: trackId,
      start: true,
    });
    if (!ret.ok) {
      toast.error("采集下发失败", { description: ret.message });
      return;
    }
    setField("collecting", true);
    toast.success("已开始采集", {
      description: ret.host ? `${ret.host}:${ret.port}` : undefined,
    });
  };

  const onStop = async () => {
    const ret = await postAirRadarCollectControl(1);
    if (!ret.ok) {
      toast.error("停止失败", { description: ret.message });
      return;
    }
    setField("collecting", false);
    toast.message("已停止采集");
  };

  const onCancel = async () => {
    await postAirRadarCollectControl(1);
    close();
  };

  /* 点选地图时隐藏遮罩，避免挡住 MapLibre 点击 */
  if (pickMode) {
    return createPortal(
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[460] -translate-x-1/2 rounded-md border border-amber-400/40 bg-black/70 px-3 py-2 text-xs text-amber-200 shadow-lg">
        请在地图上左键点击，设置采集方位/距离中心（Esc 取消点选）
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[460] flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-sm rounded-lg border border-white/10 bg-nexus-bg-overlay shadow-2xl backdrop-blur-md"
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2">
          <h2 className="text-sm font-medium text-nexus-text-primary">{title}</h2>
          <button
            type="button"
            className="rounded p-1 text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary"
            onClick={() => void onCancel()}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-2 px-3 py-3">
          <span className={labelCls}>目标 id</span>
          <input
            className={fieldCls}
            value={trackId}
            onChange={(e) => setField("trackId", Number(e.target.value) || 0)}
          />

          <span className={labelCls}>目标类型</span>
          <select
            className={fieldCls}
            value={targetType}
            onChange={(e) => setField("targetType", Number(e.target.value))}
          >
            {AIR_RADAR_TARGET_TYPE_OPTIONS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>

          <span className={labelCls}>航迹类型</span>
          <select
            className={fieldCls}
            value={trackType}
            onChange={(e) => setField("trackType", Number(e.target.value))}
          >
            {AIR_RADAR_TRACK_TYPE_OPTIONS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>

          <span className={labelCls}>方位中心</span>
          <input
            className={fieldCls}
            value={Number.isFinite(aziCenter) ? Number(aziCenter.toFixed(2)) : 0}
            onChange={(e) => setField("aziCenter", Number(e.target.value) || 0)}
          />

          <span className={labelCls}>距离中心</span>
          <input
            className={fieldCls}
            value={Number.isFinite(disCenter) ? Number(disCenter.toFixed(1)) : 0}
            onChange={(e) => setField("disCenter", Number(e.target.value) || 0)}
          />

          <span className={labelCls}>方位范围</span>
          <input
            className={fieldCls}
            value={aziRange}
            onChange={(e) => setField("aziRange", Number(e.target.value) || 0)}
          />

          <span className={labelCls}>距离范围</span>
          <input
            className={fieldCls}
            value={disRange}
            onChange={(e) => setField("disRange", Number(e.target.value) || 0)}
          />
        </div>

        <div className="flex flex-wrap gap-2 border-t border-white/[0.08] px-3 py-2.5">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={collecting}
            onClick={() => void onStart()}
          >
            {collecting ? "采集中" : "开始"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn("h-8 text-xs", mode === "auto" ? "opacity-60" : "")}
            disabled={mode === "auto"}
            onClick={() => {
              enablePickMode();
              toast.message("请在地图上点击采集中心");
            }}
          >
            设置手动采集方位距离
          </Button>
          <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" onClick={() => void onStop()}>
            停止
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => void onCancel()}>
            取消
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

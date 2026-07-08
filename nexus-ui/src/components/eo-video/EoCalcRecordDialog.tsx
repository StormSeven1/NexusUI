"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalcRecordLocationPoint } from "@/hooks/useEoCalcRecordController";

export type EoCalcRecordDialogProps = {
  open: boolean;
  onClose: () => void;
  cameraName: string;
  baselineTargetId: string;
  canRecord: boolean;
  recordBlockReason: string | null;
  sessionActive: boolean;
  canStartSession: boolean;
  recording: boolean;
  recordSessionLabel: string;
  rowCount: number;
  pendingSyncCount: number;
  nfsSynced: boolean;
  syncBusy: boolean;
  locationPoints: CalcRecordLocationPoint[];
  aimSeaBusy: boolean;
  aimSkyBusy: boolean;
  onToggleRecording: (start: boolean) => void;
  onSyncSession: () => void;
  onDeleteSession: () => void;
  onSeaAim: () => void;
  onSkyAim: () => void;
  onResetDefault: () => void;
  showLocation: () => void;
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-[10px] rounded-full border border-white/20",
        ok ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-red-500/80",
      )}
      aria-hidden
    />
  );
}

/** 对齐 Qt `CalcRecord`：相机跟踪标定数据手动记录 */
export function EoCalcRecordDialog({
  open,
  onClose,
  cameraName,
  baselineTargetId,
  canRecord,
  recordBlockReason,
  sessionActive,
  canStartSession,
  recording,
  recordSessionLabel,
  rowCount,
  pendingSyncCount,
  nfsSynced,
  syncBusy,
  locationPoints,
  aimSeaBusy,
  aimSkyBusy,
  onToggleRecording,
  onSyncSession,
  onDeleteSession,
  onSeaAim,
  onSkyAim,
  onResetDefault,
  showLocation,
}: EoCalcRecordDialogProps) {
  const locationSummary = useMemo(() => {
    if (locationPoints.length === 0) return "暂无采样点";
    const last = locationPoints[locationPoints.length - 1]!;
    return `已采 ${locationPoints.length} 点 · 最近 P=${last.p.toFixed(2)}° DIS=${last.distance.toFixed(0)}m`;
  }, [locationPoints]);

  if (!open || typeof document === "undefined") return null;

  const panel = (
    <div
      className="pointer-events-auto fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eo-calc-record-title"
    >
      <div className="w-full max-w-[640px] rounded-lg border border-white/10 bg-[#1a1f26] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 id="eo-calc-record-title" className="text-sm font-medium">
            相机跟踪采集
          </h2>
          <button
            type="button"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-sm">
          <div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2">
            <span className="text-white/65">相机名称</span>
            <input
              readOnly
              value={cameraName}
              className="h-8 rounded border border-white/15 bg-black/30 px-2 text-white/90"
            />
            <span className="text-white/65">基准目标 ID</span>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={baselineTargetId}
                className="h-8 min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 font-mono text-white/90"
              />
              <StatusDot ok={canRecord} />
              <span className="text-xs text-white/70">{canRecord ? "具备记录条件" : "未具备记录条件"}</span>
            </div>
          </div>

          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <Button
              type="button"
              variant={recording ? "default" : "secondary"}
              disabled={!recording && !canStartSession}
              onClick={() => onToggleRecording(!recording)}
            >
              {recording ? "采集中" : "开始采集"}
            </Button>
            <input
              readOnly
              value={recordSessionLabel}
              placeholder="记录会话时间"
              className="h-9 rounded border border-white/15 bg-black/30 px-2 text-sm text-white/85"
            />
            <Button
              type="button"
              variant="outline"
              disabled={rowCount === 0}
              onClick={onDeleteSession}
            >
              删除本次记录
            </Button>
          </div>

          {sessionActive ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2">
              <Button
                type="button"
                variant="default"
                disabled={pendingSyncCount === 0 || syncBusy}
                onClick={onSyncSession}
              >
                {syncBusy ? "更新中…" : `更新数据${pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ""}`}
              </Button>
              <span className="text-xs text-white/70">
                {pendingSyncCount > 0
                  ? `${pendingSyncCount} 条待写入 200T`
                  : nfsSynced
                    ? "本次数据已写入 200T"
                    : canRecord
                      ? "航迹变化时自动采样，采到数据后点此写入 200T"
                      : `等待采样：${recordBlockReason ?? "未具备记录条件"}`}
              </span>
            </div>
          ) : null}

          <p className="text-xs text-white/55">
            {recording
              ? `采集中… 本段已采 ${rowCount} 条（航迹变化时自动采样，需手动点「更新数据」写入 200T）`
              : sessionActive
                ? `本段共采 ${rowCount} 条${nfsSynced ? "，已写入 200T" : "，尚未写入 200T"}`
                : canRecord
                  ? "已具备记录条件，可点「开始采集」。"
                  : recordBlockReason
                    ? `未具备记录条件：${recordBlockReason}`
                    : "请先绑定目标（地图双击航迹等），待 DDS 出现 target_id 且单目标跟踪稳定后再采集。"}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={showLocation}>
              采集数据分布
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={aimSeaBusy} onClick={onSeaAim}>
              {aimSeaBusy ? "对海对准生成中" : "对海对准生成"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={aimSkyBusy} onClick={onSkyAim}>
              {aimSkyBusy ? "对空对准生成中" : "对空对准生成"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-white/50">{locationSummary}</p>
            <Button type="button" variant="ghost" size="sm" onClick={onResetDefault}>
              恢复默认参数
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

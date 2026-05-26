"use client";

import { cn } from "@/lib/utils";
import {
  TRACK_EVAL_SENSOR_OPTIONS,
  useTrackEvaluationStore,
} from "@/stores/track-evaluation-store";

function sensorLabel(id: number): string {
  return TRACK_EVAL_SENSOR_OPTIONS.find((o) => o.id === id)?.label ?? `传感器 ${id}`;
}

export function TrackFilterSection() {
  const startTime = useTrackEvaluationStore((s) => s.startTime);
  const endTime = useTrackEvaluationStore((s) => s.endTime);
  const sensorIdsForQuery = useTrackEvaluationStore((s) => s.sensorIdsForQuery);
  const directDownload = useTrackEvaluationStore((s) => s.directDownload);
  const realtimeTracking = useTrackEvaluationStore((s) => s.realtimeTracking);
  const queryStatus = useTrackEvaluationStore((s) => s.queryStatus);
  const queryStats = useTrackEvaluationStore((s) => s.queryStats);
  const connectionState = useTrackEvaluationStore((s) => s.connectionState);
  const regionType = useTrackEvaluationStore((s) => s.regionType);
  const regionInfo = useTrackEvaluationStore((s) => s.regionInfo);
  const regionDrawing = useTrackEvaluationStore((s) => s.regionDrawing);
  const metricsComputing = useTrackEvaluationStore((s) => s.metricsComputing);

  const setStartTime = useTrackEvaluationStore((s) => s.setStartTime);
  const setEndTime = useTrackEvaluationStore((s) => s.setEndTime);
  const toggleSensorForQuery = useTrackEvaluationStore((s) => s.toggleSensorForQuery);
  const setDirectDownload = useTrackEvaluationStore((s) => s.setDirectDownload);
  const sendQuery = useTrackEvaluationStore((s) => s.sendQuery);
  const cancelQuery = useTrackEvaluationStore((s) => s.cancelQuery);
  const toggleRealtime = useTrackEvaluationStore((s) => s.toggleRealtime);
  const requestReevaluate = useTrackEvaluationStore((s) => s.requestReevaluate);
  const selectRegionType = useTrackEvaluationStore((s) => s.selectRegionType);
  const clearRegion = useTrackEvaluationStore((s) => s.clearRegion);

  const wsConnected = connectionState === "open";
  const isLoading = queryStatus.type === "loading" || metricsComputing;
  const canQuery = wsConnected && startTime && endTime && !realtimeTracking;

  return (
    <div className="space-y-3 overflow-y-auto pr-1">
      <section>
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-nexus-text-muted">
          数据库筛选
        </h4>
        <div className="space-y-2">
          <label className="block text-[10px] text-nexus-text-muted">开始时间</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 text-xs text-nexus-text-primary focus:border-nexus-border-accent focus:outline-none focus:ring-1 focus:ring-nexus-accent"
          />
          <label className="block text-[10px] text-nexus-text-muted">结束时间</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-base px-2 text-xs text-nexus-text-primary focus:border-nexus-border-accent focus:outline-none focus:ring-1 focus:ring-nexus-accent"
          />
        </div>

        <div className="mt-3">
          <span className="mb-1.5 block text-[10px] text-nexus-text-muted">区域框选（在 GIS 上绘制）</span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => selectRegionType("rect")}
              className={cn(
                "rounded border px-2 py-1 text-[10px] transition-colors",
                regionDrawing === "rect" || regionType === "rect"
                  ? "border-nexus-accent bg-nexus-accent-glow/20 text-nexus-text-primary"
                  : "border-nexus-border text-nexus-text-muted hover:bg-nexus-bg-elevated",
              )}
            >
              {regionDrawing === "rect" ? "绘制中…" : "矩形框选"}
            </button>
            <button
              type="button"
              onClick={() => selectRegionType("polygon")}
              className={cn(
                "rounded border px-2 py-1 text-[10px] transition-colors",
                regionDrawing === "polygon" || regionType === "polygon"
                  ? "border-nexus-accent bg-nexus-accent-glow/20 text-nexus-text-primary"
                  : "border-nexus-border text-nexus-text-muted hover:bg-nexus-bg-elevated",
              )}
            >
              {regionDrawing === "polygon" ? "绘制中…" : "多边形框选"}
            </button>
            <button
              type="button"
              onClick={() => clearRegion()}
              className="rounded border border-nexus-border px-2 py-1 text-[10px] text-nexus-text-muted hover:bg-nexus-bg-elevated"
            >
              清除区域
            </button>
          </div>
          {regionInfo ? (
            <p className="mt-1.5 rounded bg-nexus-bg-elevated/50 px-2 py-1 font-mono text-[9px] leading-snug text-nexus-text-muted">
              {regionInfo}
            </p>
          ) : (
            <p className="mt-1 text-[9px] text-nexus-text-muted/80">
              未框选时按时间+传感器查询全区域；绘制时地图为十字光标。
            </p>
          )}
        </div>

        <div className="mt-3">
          <span className="mb-1.5 block text-[10px] text-nexus-text-muted">传感器 ID</span>
          <div className="grid grid-cols-1 gap-1">
            {TRACK_EVAL_SENSOR_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] text-nexus-text-secondary hover:bg-nexus-bg-elevated/50"
              >
                <input
                  type="checkbox"
                  checked={sensorIdsForQuery.includes(opt.id)}
                  onChange={() => toggleSensorForQuery(opt.id)}
                  className="accent-nexus-accent"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-nexus-text-secondary">
          <input
            type="checkbox"
            checked={directDownload}
            onChange={(e) => setDirectDownload(e.target.checked)}
            className="accent-nexus-accent"
          />
          直接下载
        </label>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {isLoading && queryStatus.type === "loading" ? (
            <button
              type="button"
              onClick={() => cancelQuery()}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300 hover:bg-amber-500/20"
            >
              取消查询
            </button>
          ) : (
            <button
              type="button"
              onClick={() => sendQuery()}
              disabled={!canQuery}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[11px] font-medium",
                canQuery
                  ? "bg-nexus-accent text-nexus-text-inverse hover:opacity-90"
                  : "cursor-not-allowed border border-nexus-border bg-nexus-bg-elevated text-nexus-text-muted",
              )}
            >
              {directDownload ? "发送下载" : "发送查询"}
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleRealtime()}
            disabled={queryStatus.type === "loading"}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-[11px]",
              realtimeTracking
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                : "border-nexus-border bg-nexus-bg-elevated text-nexus-text-secondary hover:bg-nexus-bg-surface",
            )}
          >
            {realtimeTracking ? "停止实时" : "实时航迹"}
          </button>
          <button
            type="button"
            onClick={() => requestReevaluate()}
            disabled={isLoading || queryStats.total === 0}
            className="rounded-md border border-nexus-border bg-nexus-bg-elevated px-2.5 py-1.5 text-[11px] text-nexus-text-secondary hover:bg-nexus-bg-surface disabled:opacity-50"
          >
            重新评估
          </button>
        </div>

        {queryStatus.message ? (
          <div
            className={cn(
              "mt-3 rounded-md border px-2.5 py-2 text-[11px]",
              queryStatus.type === "loading" && "border-amber-500/30 bg-amber-500/10 text-amber-200",
              queryStatus.type === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
              queryStatus.type === "error" && "border-red-500/30 bg-red-500/10 text-red-300",
              queryStatus.type === "info" && "border-nexus-border bg-nexus-bg-elevated/50 text-nexus-text-secondary",
            )}
          >
            <div>{queryStatus.message}</div>
            {queryStatus.details ? (
              <div className="mt-1 whitespace-pre-line font-mono text-[10px] opacity-80">
                {queryStatus.details}
              </div>
            ) : null}
          </div>
        ) : null}

        {queryStats.total > 0 ? (
          <div className="mt-3 rounded-md border border-nexus-border bg-nexus-bg-surface/40 p-2">
            <div className="text-[10px] font-semibold text-nexus-text-muted">查询结果统计</div>
            <div className="mt-1 font-mono text-xs text-nexus-text-primary">
              总计: {queryStats.total} 条（仅用于指标，不绘制地图）
            </div>
            <div className="mt-1.5 space-y-0.5">
              {Object.keys(queryStats.bySensor)
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                .map((sid) => (
                  <div
                    key={sid}
                    className="flex justify-between font-mono text-[10px] text-nexus-text-muted"
                  >
                    <span>{sensorLabel(parseInt(sid, 10))}</span>
                    <span>{queryStats.bySensor[sid]} 条</span>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

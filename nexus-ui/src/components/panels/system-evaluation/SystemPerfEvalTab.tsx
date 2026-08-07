"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Play, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchSystemPerfStats,
  PERF_STAGE_LABELS,
  SYSTEM_PERF_REFRESH_MS,
  type SystemResponseTimeStats,
} from "@/lib/system-eval-perf-api";
import {
  fetchTrackLinkResult,
  TRACK_LINK_POLL_MS,
  TRACK_LINK_SEGMENT_LABELS,
  triggerTrackLinkEval,
  type TrackLinkEvalData,
  type TrackLinkTypeResult,
} from "@/lib/system-eval-track-link-api";
import { openEvalReportPreview } from "@/lib/eval-report/open-eval-report-preview";
import { toast } from "sonner";

function formatMs(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "暂无数据";
  return `${Math.round(v)} ms`;
}

function formatHz(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "暂无数据";
  return `${v.toFixed(3)} Hz`;
}

function formatSegMs(seg: { count?: number; avg_ms?: number | null; median_ms?: number | null } | undefined, which: "median" | "avg" | "min" | "max"): string {
  if (!seg || !(seg.count && seg.count > 0)) return "暂无数据";
  const v =
    which === "median"
      ? (seg.median_ms ?? seg.avg_ms)
      : which === "avg"
        ? seg.avg_ms
        : which === "min"
          ? (seg as { min_ms?: number | null }).min_ms
          : (seg as { max_ms?: number | null }).max_ms;
  return formatMs(v);
}

function PerfBarChart({ stats }: { stats: SystemResponseTimeStats }) {
  const rows = PERF_STAGE_LABELS.map((s) => ({
    label: s.label,
    ms: Number(stats[s.key] ?? 0),
    count: Number(stats[s.countKey] ?? 0),
  })).filter((r) => r.ms > 0 || r.count > 0);

  const maxMs = Math.max(1, ...rows.map((r) => r.ms));

  return (
    <div className="space-y-2.5">
      {rows.length === 0 ? (
        <p className="text-[11px] text-nexus-text-muted">暂无有效阶段样本</p>
      ) : (
        rows.map((r) => (
          <div key={r.label}>
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px]">
              <span className="text-nexus-text-secondary">{r.label}</span>
              <span className="shrink-0 font-mono text-nexus-text-primary">{formatMs(r.ms)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-nexus-bg-elevated">
              <div
                className="h-full rounded-full bg-nexus-accent/80 transition-all duration-500"
                style={{ width: `${Math.min(100, (r.ms / maxMs) * 100)}%` }}
              />
            </div>
            <p className="mt-0.5 text-[9px] text-nexus-text-muted">样本数 {r.count}</p>
          </div>
        ))
      )}
    </div>
  );
}

function TrackLinkTypeCard({ row }: { row: TrackLinkTypeResult }) {
  const noData = row.has_data === false;
  return (
    <div className="rounded-md border border-nexus-border/70 bg-nexus-bg-base/50 px-2 py-2">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-nexus-text-primary">{row.label}</p>
        <p className="font-mono text-[10px] text-nexus-text-muted">{row.track_layer_key}</p>
      </div>
      {noData && row.message ? (
        <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
          {row.message}
        </p>
      ) : null}
      {row.single_frame_dropped != null && row.single_frame_dropped > 0 ? (
        <p className="mb-1 text-[9px] text-nexus-text-muted">
          已丢弃仅 1 帧航迹 {row.single_frame_dropped} 条（候选 {row.candidate_track_count ?? "—"}）
        </p>
      ) : null}
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <div className="rounded border border-nexus-border/40 bg-nexus-bg-elevated/30 px-1.5 py-1">
          <p className="text-[9px] text-nexus-text-muted">有效航迹(≥2帧)</p>
          <p className="font-mono text-[11px] text-nexus-text-primary">{row.sampled_track_count}</p>
        </div>
        <div className="rounded border border-nexus-border/40 bg-nexus-bg-elevated/30 px-1.5 py-1">
          <p className="text-[9px] text-nexus-text-muted">有效更新</p>
          <p className="font-mono text-[11px] text-nexus-text-primary">
            {row.effective_updates ?? Math.max(0, row.total_updates - row.sampled_track_count)}
          </p>
        </div>
        <div className="rounded border border-nexus-border/40 bg-nexus-bg-elevated/30 px-1.5 py-1">
          <p className="text-[9px] text-nexus-text-muted">更新频率</p>
          <p className="font-mono text-[11px] text-nexus-accent">{formatHz(row.update_frequency_hz)}</p>
        </div>
      </div>
      {noData ? null : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[10px]">
          <thead>
            <tr className="text-left text-nexus-text-muted">
              <th className="pb-1 pr-2 font-normal">链路段</th>
              <th className="pb-1 pr-2 font-normal">中位</th>
              <th className="pb-1 pr-2 font-normal">avg</th>
              <th className="pb-1 pr-2 font-normal">min</th>
              <th className="pb-1 pr-2 font-normal">max</th>
              <th className="pb-1 font-normal">n</th>
            </tr>
          </thead>
          <tbody>
            {TRACK_LINK_SEGMENT_LABELS.map((s) => {
              const seg = row.segments[s.key];
              return (
                <tr key={s.key} className="border-t border-nexus-border/30" title={s.hint}>
                  <td className="py-0.5 pr-2 text-nexus-text-secondary">{s.label}</td>
                  <td className="py-0.5 pr-2 font-mono text-nexus-accent">
                    {formatSegMs(seg, "median")}
                  </td>
                  <td className="py-0.5 pr-2 font-mono text-nexus-text-primary">{formatSegMs(seg, "avg")}</td>
                  <td className="py-0.5 pr-2 font-mono text-nexus-text-primary">{formatSegMs(seg, "min")}</td>
                  <td className="py-0.5 pr-2 font-mono text-nexus-text-primary">{formatSegMs(seg, "max")}</td>
                  <td className="py-0.5 font-mono text-nexus-text-muted">{seg?.count ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function TrackLinkEvalSection({
  onSnapshot,
}: {
  onSnapshot?: (snap: {
    results: TrackLinkTypeResult[] | null;
    error: string | null;
    durationSec: number | null;
  }) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "collecting" | "done">("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TrackLinkEvalData | null>(null);
  const [results, setResults] = useState<TrackLinkTypeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const durationRef = useRef<number | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const emitSnapshot = useCallback(
    (
      nextResults: TrackLinkTypeResult[] | null,
      nextError: string | null,
      nextDuration: number | null,
    ) => {
      onSnapshot?.({
        results: nextResults,
        error: nextError,
        durationSec: nextDuration,
      });
    },
    [onSnapshot],
  );

  const pollOnce = useCallback(
    async (tid: string) => {
      const r = await fetchTrackLinkResult(tid);
      if (r.error) {
        setError(r.error);
        emitSnapshot(null, r.error, durationRef.current);
        return;
      }
      const data = r.data;
      if (!data) return;
      setProgress(data);
      if (data.status === "done" || data.status === "cancelled") {
        stopPoll();
        setPhase("done");
        const nextResults = data.results ?? [];
        setResults(nextResults);
        const nextError = data.error ?? null;
        if (nextError) setError(nextError);
        const dur = Number(data.duration_sec ?? durationRef.current ?? 30);
        durationRef.current = dur;
        emitSnapshot(nextResults, nextError, dur);
      }
    },
    [emitSnapshot, stopPoll],
  );

  const startEval = useCallback(async () => {
    if (starting || phase === "collecting") return;
    setStarting(true);
    setError(null);
    try {
      const r = await triggerTrackLinkEval({ durationSec: 30, maxTracksPerType: 10 });
      if (r.error && !r.conflict) {
        setError(r.error);
        emitSnapshot(null, r.error, null);
        toast.error(r.error);
        return;
      }
      const tid = r.taskId;
      if (!tid) {
        setError("未返回 task_id");
        return;
      }
      if (r.conflict) {
        toast.message("已有评估在进行，继续跟踪该任务");
      } else {
        toast.success("航迹链路评估已开始（约 30 秒）");
      }
      setTaskId(tid);
      setPhase("collecting");
      setResults(null);
      emitSnapshot(null, null, r.durationSec);
      durationRef.current = r.durationSec;
      setProgress({
        task_id: tid,
        status: "collecting",
        duration_sec: r.durationSec,
        remaining_sec: r.durationSec,
        elapsed_sec: 0,
      });
      stopPoll();
      void pollOnce(tid);
      pollRef.current = window.setInterval(() => void pollOnce(tid), TRACK_LINK_POLL_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      emitSnapshot(null, msg, null);
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  }, [emitSnapshot, phase, pollOnce, starting, stopPoll]);

  const remaining = Math.ceil(Number(progress?.remaining_sec ?? 0));
  const typeCountEntries = Object.entries(progress?.type_counts ?? {});

  return (
    <div className="mt-4 border-t border-nexus-border/80 pt-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-nexus-text-secondary">航迹链路评估</p>
          <p className="text-[9px] text-nexus-text-muted">
            Custombackend 旁路采样进站航迹（gRPC/融合等）· 仅统计≥2
            帧 · 每类最多 10 条 · 采集 30s
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startEval()}
          disabled={starting || phase === "collecting"}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md border border-nexus-accent/50 bg-nexus-accent/15 px-2 py-1 text-[10px]",
            "text-nexus-text-primary hover:bg-nexus-accent/25 disabled:opacity-50",
          )}
          title="触发后端航迹链路评估"
        >
          {phase === "collecting" ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          {phase === "collecting" ? `采集中 ${remaining}s` : "开始评估"}
        </button>
      </div>

      {error ? (
        <p className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
          {error}
        </p>
      ) : null}

      {phase === "collecting" ? (
        <div className="mb-2 rounded border border-nexus-border/50 bg-nexus-bg-elevated/30 px-2 py-1.5">
          <p className="text-[10px] text-nexus-text-secondary">
            剩余约 {remaining}s
            {taskId ? (
              <span className="ml-2 font-mono text-[9px] text-nexus-text-muted">
                task={taskId.slice(0, 8)}…
              </span>
            ) : null}
          </p>
          {typeCountEntries.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-[9px] text-nexus-text-muted">
              {typeCountEntries.map(([k, v]) => {
                const seen = Number((v as { seen?: number; sampled?: number }).seen ?? v.sampled ?? 0);
                const updated = Number((v as { updated?: number }).updated ?? 0);
                const frames = Number(v.updates ?? 0);
                return (
                  <li key={k}>
                    {k}: 见到 {seen} · 已更新(≥2帧) {updated} · 帧 {frames}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-[9px] text-nexus-text-muted">等待航迹样本…</p>
          )}
        </div>
      ) : null}

      {phase === "done" && results ? (
        results.length === 0 ? (
          <p className="text-[11px] text-nexus-text-muted">
            {progress?.message?.trim() ||
              "暂无数据：采集完成，但未收到带链路时间戳的航迹（请确认 gRPC 航迹源已启用）"}
          </p>
        ) : (
          <div className="space-y-2">
            {progress?.message?.trim() ? (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
                {progress.message}
              </p>
            ) : (
              <p className="text-[9px] text-nexus-text-muted">
                「创建→接收」含观测时戳滞后时以中位数为准；超过可信上限（创建→接收
                3min / 近端段更短）的样本已丢弃，不输出离谱均值。
              </p>
            )}
            {results.map((row) => (
              <TrackLinkTypeCard key={row.track_layer_key} row={row} />
            ))}
          </div>
        )
      ) : null}

      {phase === "idle" && !error ? (
        <p className="text-[11px] text-nexus-text-muted">点击「开始评估」采集约 30 秒后查看各段链路延迟与更新频率</p>
      ) : null}
    </div>
  );
}

export function SystemPerfEvalTab() {
  const [stats, setStats] = useState<SystemResponseTimeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [trackLinkSnap, setTrackLinkSnap] = useState<{
    results: TrackLinkTypeResult[] | null;
    error: string | null;
    durationSec: number | null;
  }>({ results: null, error: null, durationSec: null });

  const onTrackLinkSnapshot = useCallback(
    (snap: {
      results: TrackLinkTypeResult[] | null;
      error: string | null;
      durationSec: number | null;
    }) => {
      setTrackLinkSnap(snap);
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchSystemPerfStats(10);
      setStats(r.stats);
      setError(r.error);
      setLastFetched(r.fetchedAt);
    } catch (e) {
      setStats(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), SYSTEM_PERF_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const totalMs =
    stats == null
      ? 0
      : PERF_STAGE_LABELS.reduce((sum, s) => sum + Number(stats[s.key] ?? 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nexus-border px-2 py-1.5">
        <div>
          <p className="text-[11px] font-medium text-nexus-text-secondary">端到端响应耗时</p>
          <p className="text-[9px] text-nexus-text-muted">
            最近 10 条告警链路统计 · 每 1 小时自动刷新
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (!stats && !error && !(trackLinkSnap.results?.length)) {
                toast.message("请先等待系统评估数据加载，或完成航迹链路评估");
                return;
              }
              openEvalReportPreview({
                reuseExistingResults: true,
                selectedKinds: ["system"],
                cachedSystem: {
                  stats,
                  error,
                  fetchedAt: lastFetched ?? new Date().toISOString(),
                  trackLinkResults: trackLinkSnap.results,
                  trackLinkError: trackLinkSnap.error,
                  trackLinkDurationSec: trackLinkSnap.durationSec,
                },
              });
            }}
            disabled={!stats && !error && !(trackLinkSnap.results?.length)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-nexus-accent/50 bg-nexus-accent/15 px-2 py-1 text-[10px]",
              "text-nexus-text-primary hover:bg-nexus-accent/25 disabled:opacity-50",
            )}
            title="用当前系统评估与航迹链路结果生成报告（无链路结果时生成阶段会自动采集约30秒）"
          >
            <FileText size={12} />
            生成评估报告
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-nexus-border px-2 py-1 text-[10px]",
              "text-nexus-text-secondary hover:bg-nexus-bg-elevated disabled:opacity-50",
            )}
            title="立即刷新"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <p className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
            {error}
          </p>
        ) : null}

        {loading && !stats ? (
          <p className="text-[11px] text-nexus-text-muted">加载中…</p>
        ) : null}

        {stats ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-nexus-border/70 bg-nexus-bg-base/50 px-2 py-1.5">
                <p className="text-[9px] text-nexus-text-muted">读取记录数</p>
                <p className="font-mono text-sm font-semibold text-nexus-text-primary">
                  {stats.fetched_record_count ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-nexus-border/70 bg-nexus-bg-base/50 px-2 py-1.5">
                <p className="text-[9px] text-nexus-text-muted">五段耗时合计（均值）</p>
                <p className="font-mono text-sm font-semibold text-nexus-accent">
                  {formatMs(totalMs)}
                </p>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-1.5">
              {PERF_STAGE_LABELS.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between rounded border border-nexus-border/50 bg-nexus-bg-elevated/40 px-2 py-1"
                >
                  <span className="text-[10px] text-nexus-text-muted">{s.label}</span>
                  <span className="font-mono text-[11px] text-nexus-text-primary">
                    {formatMs(Number(stats[s.key]))}
                  </span>
                </div>
              ))}
            </div>

            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-nexus-text-muted">
              阶段耗时对比
            </h4>
            <PerfBarChart stats={stats} />
          </>
        ) : !loading && !error ? (
          <p className="text-[11px] text-nexus-text-muted">暂无数据</p>
        ) : null}

        {lastFetched ? (
          <p className="mt-3 text-[9px] text-nexus-text-muted">
            上次更新：{new Date(lastFetched).toLocaleString()}
          </p>
        ) : null}

        <TrackLinkEvalSection onSnapshot={onTrackLinkSnapshot} />
      </div>
    </div>
  );
}

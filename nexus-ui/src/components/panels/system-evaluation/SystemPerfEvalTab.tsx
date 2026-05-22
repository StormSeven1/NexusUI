"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchSystemPerfStats,
  PERF_STAGE_LABELS,
  SYSTEM_PERF_REFRESH_MS,
  type SystemResponseTimeStats,
} from "@/lib/system-eval-perf-api";

function formatMs(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)} ms`;
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

export function SystemPerfEvalTab() {
  const [stats, setStats] = useState<SystemResponseTimeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

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
      </div>
    </div>
  );
}

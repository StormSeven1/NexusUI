"use client";

/**
 * NetworkStatsDialog — 数据状态弹窗
 *
 * 【触发】顶栏「数据状态」按钮
 *
 * 【Tab】
 *   - 接收间隔：各数据源最后接收间隔（态势 WS、HTTP 轮询、独立 WS/SSE/MQTT 等）
 *   - 链路延迟：8090 `/api/v1/ping` 客户端与各实体 ICMP 延迟/丢包
 */

import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNetworkStats, type NetworkStatDisplay } from "@/stores/network-stats-store";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

type DialogTab = "interval" | "latency";

const CATEGORY_ORDER = [
  "连接",
  "航迹",
  "实体状态",
  "实体",
  "资产",
  "告警",
  "区域",
  "库表",
  "光电",
  "光电检测",
  "第三方相机",
  "机场",
  "无人机",
  "高频",
  "航线",
  "MQTT",
  "评估",
  "任务状态",
];

const ENTITY_TYPE_LABELS: Record<string, string> = {
  camera: "相机/光电",
  radar: "雷达",
  dock: "机场",
  uav: "无人机",
  drone: "无人机",
};

interface PingEndpoint {
  avg_ms: number;
  ip: string;
  loss_rate: number;
  max_ms: number;
  min_ms: number;
  received: number;
  sent: number;
  entity_id?: string;
  entity_name?: string;
  entity_type?: string;
}

interface PingPayload {
  ok?: boolean;
  error?: string;
  fetchedAt?: string;
  code?: number;
  message?: string;
  data?: {
    client?: PingEndpoint;
    devices?: PingEndpoint[];
  };
}

function groupByCategory(stats: NetworkStatDisplay[]): [string, NetworkStatDisplay[]][] {
  const groups = new Map<string, NetworkStatDisplay[]>();
  for (const s of stats) {
    const list = groups.get(s.category) ?? [];
    list.push(s);
    groups.set(s.category, list);
  }
  const result: [string, NetworkStatDisplay[]][] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = groups.get(cat);
    if (items) result.push([cat, items]);
  }
  for (const [cat, items] of groups) {
    if (!CATEGORY_ORDER.includes(cat)) result.push([cat, items]);
  }
  return result;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

function formatLoss(rate: number): string {
  if (!Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.01 ? 1 : 0)}%`;
}

function latencyTone(ep: PingEndpoint): "ok" | "warn" | "bad" {
  if (ep.loss_rate >= 1 || ep.received <= 0) return "bad";
  if (ep.loss_rate > 0 || ep.avg_ms >= 50) return "warn";
  return "ok";
}

const TONE_CLASS = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
} as const;

const TONE_DOT = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
} as const;

function groupDevices(devices: PingEndpoint[]): [string, PingEndpoint[]][] {
  const groups = new Map<string, PingEndpoint[]>();
  for (const d of devices) {
    const key = (d.entity_type || "other").toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  const preferred = ["camera", "radar", "dock", "uav", "drone"];
  const result: [string, PingEndpoint[]][] = [];
  for (const k of preferred) {
    const items = groups.get(k);
    if (items) {
      result.push([k, items]);
      groups.delete(k);
    }
  }
  for (const [k, items] of groups) result.push([k, items]);
  return result;
}

function PingEndpointRow({ ep, title }: { ep: PingEndpoint; title: string }) {
  const tone = latencyTone(ep);
  const subtitle = [ep.entity_id, ep.ip].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-white/[0.04]">
      <span className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone])} />
      <div className="min-w-0 flex-1">
        <div className="break-words text-xs leading-snug text-nexus-text-secondary" title={subtitle}>
          {title}
        </div>
        {ep.ip ? (
          <div className="mt-0.5 text-[10px] leading-snug text-nexus-text-muted tabular-nums">{ep.ip}</div>
        ) : null}
      </div>
      <span className="w-12 shrink-0 pt-0.5 text-right text-[10px] text-nexus-text-muted tabular-nums">
        {formatLoss(ep.loss_rate)}
      </span>
      <span
        className={cn(
          "w-16 shrink-0 pt-0.5 text-right text-xs font-uav-hud font-semibold tabular-nums",
          TONE_CLASS[tone],
        )}
      >
        {formatMs(ep.avg_ms)}
      </span>
    </div>
  );
}

function LinkLatencyPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<PingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!active) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/nexus-entities/ping", { cache: "no-store", signal: ac.signal });
        const json = (await res.json()) as PingPayload;
        if (ac.signal.aborted) return;
        if (!res.ok || json.ok === false) {
          setError(json.error || `HTTP ${res.status}`);
          setData(null);
          return;
        }
        setData(json);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setData(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    const timer = setInterval(() => setReloadToken((n) => n + 1), 30_000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  }, [active, reloadToken]);

  const client = data?.data?.client;
  const devices = data?.data?.devices ?? [];
  const groups = groupDevices(devices);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs text-nexus-text-muted">
          {data?.fetchedAt
            ? `更新于 ${new Date(data.fetchedAt).toLocaleTimeString()}`
            : "拉取 8090 实测 ping（约数秒）"}
        </div>
        <button
          type="button"
          onClick={() => setReloadToken((n) => n + 1)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1 text-xs text-nexus-text-secondary hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex h-40 items-center justify-center text-sm text-nexus-text-muted">
          正在测量链路延迟…
        </div>
      )}

      {!loading && !error && !client && devices.length === 0 && (
        <div className="flex h-40 items-center justify-center text-sm text-nexus-text-muted">暂无延迟数据</div>
      )}

      {(client || groups.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {client && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-nexus-text-primary">客户端</span>
                <span className="text-[10px] text-nexus-text-muted">本机→服务</span>
              </div>
              <div className="mb-1 flex items-center justify-between gap-2 px-2 text-[10px] text-nexus-text-muted">
                <span className="min-w-0 flex-1">名称</span>
                <span className="w-12 shrink-0 text-right">丢包</span>
                <span className="w-16 shrink-0 text-right">平均</span>
              </div>
              <PingEndpointRow ep={client} title="请求端" />
              <div className="mt-2 space-y-0.5 px-2 text-[10px] text-nexus-text-muted tabular-nums">
                <div className="flex justify-between">
                  <span>min / max</span>
                  <span>
                    {formatMs(client.min_ms)} / {formatMs(client.max_ms)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>收/发</span>
                  <span>
                    {client.received}/{client.sent}
                  </span>
                </div>
              </div>
            </div>
          )}

          {groups.map(([type, items]) => (
            <div key={type} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-nexus-text-primary">
                  {ENTITY_TYPE_LABELS[type] ?? type}
                </span>
                <span className="text-[10px] text-nexus-text-muted">{items.length} 项</span>
              </div>
              <div className="mb-1 flex items-center justify-between gap-2 px-2 text-[10px] text-nexus-text-muted">
                <span className="min-w-0 flex-1">实体名称</span>
                <span className="w-12 shrink-0 text-right">丢包</span>
                <span className="w-16 shrink-0 text-right">平均</span>
              </div>
              <div className="max-h-[380px] space-y-0.5 overflow-y-auto">
                {items.map((ep) => (
                  <PingEndpointRow
                    key={ep.entity_id ?? `${ep.ip}-${ep.entity_name ?? ""}`}
                    ep={ep}
                    title={(ep.entity_name ?? "").trim() || ep.entity_id || ep.ip}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IntervalStatsPanel() {
  const stats = useNetworkStats();
  const groups = groupByCategory(stats);

  return (
    <>
      {groups.length === 0 && (
        <div className="flex h-40 items-center justify-center text-sm text-nexus-text-muted">
          暂无数据，等待 WebSocket 连接…
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        {groups.map(([category, items]) => (
          <div key={category} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-nexus-text-primary">{category}</span>
              <span className="text-[10px] text-nexus-text-muted">{items.length} 项</span>
            </div>
            <div className="space-y-1">
              {items.map((item) => (
                <div key={`${category}-${item.label}`} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/[0.04]">
                  <span className="flex-1 truncate text-xs text-nexus-text-secondary" title={item.label}>
                    {item.label}
                  </span>
                  <span className="text-[10px] text-nexus-text-muted tabular-nums">{item.count}条</span>
                  <span
                    className={`text-xs font-uav-hud font-semibold tabular-nums ${
                      item.isTimeout ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {item.displayText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function NetworkStatsDialog({ open, onClose }: Props) {
  const [tab, setTab] = useState<DialogTab>("interval");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-[980px] max-h-[700px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#1a1a2e]/95 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <span>
            <span className="block text-xl font-semibold text-nexus-text-primary">数据状态</span>
            <span className="mt-1 block text-sm text-nexus-text-muted">
              {tab === "interval"
                ? "各数据源接收间隔（超时 8s；含态势 WS、库表轮询、光电检测/MQTT 等）"
                : "各链路 ICMP 延迟与丢包（8090 /api/v1/ping）"}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-white/[0.06] px-6 pt-2">
          {(
            [
              { id: "interval" as const, label: "接收间隔" },
              { id: "latency" as const, label: "链路延迟" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "relative px-3 pb-2 text-sm transition-colors",
                tab === t.id
                  ? "text-nexus-text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-emerald-400"
                  : "text-nexus-text-muted hover:text-nexus-text-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "interval" ? <IntervalStatsPanel /> : <LinkLatencyPanel active={open && tab === "latency"} />}
        </div>

        <div className="flex items-center gap-4 border-t border-white/[0.06] px-6 py-3 text-xs text-nexus-text-muted">
          {tab === "interval" ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                正常 (&le;8s)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />
                超时 (&gt;8s)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="font-uav-hud">-</span>
                超过60s未收到
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                正常
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                有丢包或偏高
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />
                全丢 / 不可达
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

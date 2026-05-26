"use client";

/**
 * NetworkStatsDialog — 数据状态弹窗
 *
 * 【触发】顶栏「数据状态」按钮
 *
 * 【展示内容】各数据源最后接收间隔（态势 WS、HTTP 轮询、独立 WS/SSE/MQTT 等）
 */

import { X } from "lucide-react";
import { useNetworkStats, type NetworkStatDisplay } from "@/stores/network-stats-store";

interface Props {
  open: boolean;
  onClose: () => void;
}

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

export function NetworkStatsDialog({ open, onClose }: Props) {
  const stats = useNetworkStats();
  if (!open) return null;

  const groups = groupByCategory(stats);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[880px] max-h-[620px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#1a1a2e]/95 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <span>
            <span className="block text-xl font-semibold text-nexus-text-primary">数据状态</span>
            <span className="mt-1 block text-sm text-nexus-text-muted">
              各数据源接收间隔（超时 8s；含态势 WS、库表轮询、光电检测/MQTT 等）
            </span>
          </span>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
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
        </div>

        <div className="flex items-center gap-4 border-t border-white/[0.06] px-6 py-3 text-xs text-nexus-text-muted">
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
        </div>
      </div>
    </div>
  );
}

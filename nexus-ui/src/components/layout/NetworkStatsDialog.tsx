"use client";

/**
 * NetworkStatsDialog — 网络数据接收统计弹窗
 *
 * 【触发】WorkspaceDetails 分析工作区「查询」按钮
 *
 * 【展示内容】
 *   按分类以卡片形式展示各数据源的接收间隔：
 *   - 航迹（对空 / 对海）
 *   - 无人机（按 SN）
 *   - 实体（按 entity ID + specificType）
 *   - 告警 / 区域 / 光电 / 机场 / 航线
 *
 * 【颜色规则】
 *   - 间隔 ≤ 8s：绿色
 *   - 间隔 > 8s：红色
 *   - 超过 60s 未收到：显示 "-"
 */

import { X } from "lucide-react";
import { useNetworkStats, type NetworkStatDisplay } from "@/stores/network-stats-store";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 分类显示名映射 */
const CATEGORY_LABELS: Record<string, string> = {
  "航迹": "航迹",
  "无人机": "无人机",
  "实体": "实体",
  "告警": "告警",
  "区域": "区域",
  "光电": "光电",
  "机场": "机场",
  "航线": "航线",
};

/** 分类排序顺序 */
const CATEGORY_ORDER = ["航迹", "无人机", "实体", "告警", "区域", "光电", "机场", "航线"];

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
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-nexus-text-primary">网络数据接收统计</h2>
            <p className="mt-1 text-sm text-nexus-text-muted">实时监控各数据源接收间隔（超时阈值 8s）</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* 卡片网格 */}
        <div className="flex-1 overflow-y-auto p-5">
          {groups.length === 0 && (
            <div className="flex items-center justify-center h-40 text-sm text-nexus-text-muted">
              暂无数据，等待 WebSocket 连接...
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {groups.map(([category, items]) => (
              <div
                key={category}
                className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3"
              >
                {/* 卡片标题 */}
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-nexus-text-primary">
                    {CATEGORY_LABELS[category] ?? category}
                  </span>
                  <span className="text-[10px] text-nexus-text-muted">{items.length} 项</span>
                </div>
                {/* 卡片内容 */}
                <div className="space-y-1">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/[0.04]">
                      <span className="text-xs text-nexus-text-secondary flex-1 truncate" title={item.label}>
                        {item.label}
                      </span>
                      <span className="text-[10px] text-nexus-text-muted tabular-nums">
                        {item.count}条
                      </span>
                      <span className={`text-xs font-mono font-semibold tabular-nums ${
                        item.isTimeout ? "text-red-400" : "text-emerald-400"
                      }`}>
                        {item.displayText}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 底部说明 */}
        <div className="border-t border-white/[0.06] px-6 py-3 flex items-center gap-4 text-xs text-nexus-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />
            正常 (&le;8s)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
            超时 (&gt;8s)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono">-</span>
            超过60s未收到
          </span>
        </div>
      </div>
    </div>
  );
}

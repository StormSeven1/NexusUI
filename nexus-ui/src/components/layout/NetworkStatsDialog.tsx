"use client";

/**
 * NetworkStatsDialog — 网络数据接收统计弹窗
 *
 * 【触发】TopNav「更多」→「网络统计」，或分析工作区「查询」按钮
 *
 * 【展示内容】按分类卡片展示各数据源接收间隔：
 *   航迹 / 无人机 / 实体 / 告警 / 区域 / 光电 / 机场 / 航线
 *
 * 【颜色规则】间隔 ≤ 8s 绿色；> 8s 红色；超 60s 未收到显示 "-"
 */

import { useNetworkStats, type NetworkStatDisplay } from "@/stores/network-stats-store";
import { DraggableModal } from "@/components/ui/DraggableModal";
import { Network } from "lucide-react";
import { MODAL_STYLES } from "@/lib/modal-styles";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  航迹: "航迹",
  无人机: "无人机",
  实体: "实体",
  告警: "告警",
  区域: "区域",
  光电: "光电",
  机场: "机场",
  航线: "航线",
};

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

const LEGEND = (
  <div className="flex items-center gap-4 text-xs text-nexus-text-muted">
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
);

export function NetworkStatsDialog({ open, onClose }: Props) {
  const stats = useNetworkStats();
  const groups = groupByCategory(stats);

  return (
    <DraggableModal
      open={open}
      onClose={onClose}
      title="网络数据接收统计"
      icon={Network}
      size="auto"
      minWidth={600}
      minHeight={400}
      footer={LEGEND}
    >
      <div className={MODAL_STYLES.spacing.main}>
        <div className={MODAL_STYLES.text.body}>
          实时监控各数据源接收间隔（超时阈值 8s）
        </div>

        {groups.length === 0 && (
          <div className="flex items-center justify-center h-40 text-sm text-nexus-text-muted">
            暂无数据，等待 WebSocket 连接...
          </div>
        )}

        <div className={MODAL_STYLES.grid.autoFit}>
          {groups.map(([category, items]) => (
            <div
              key={category}
              className={MODAL_STYLES.card.container}
              style={MODAL_STYLES.card.containerStyle}
            >
              <div className={MODAL_STYLES.card.header}>
                <span className={MODAL_STYLES.card.title}>
                  {CATEGORY_LABELS[category] ?? category}
                </span>
                <span className={MODAL_STYLES.card.count}>{items.length} 项</span>
              </div>
              <div className={MODAL_STYLES.card.content}>
                {items.map((item, idx) => (
                  <div key={idx} className={MODAL_STYLES.card.item}>
                    <span className={MODAL_STYLES.card.itemLabel} title={item.label}>
                      {item.label}
                    </span>
                    <span className={MODAL_STYLES.card.itemValue}>{item.count}条</span>
                    <span
                      className={
                        item.isTimeout
                          ? MODAL_STYLES.card.itemTimeTimeout
                          : MODAL_STYLES.card.itemTimeNormal
                      }
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
    </DraggableModal>
  );
}

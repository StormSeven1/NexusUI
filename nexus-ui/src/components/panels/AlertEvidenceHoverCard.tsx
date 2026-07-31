"use client";

/**
 * 告警行 hover：从 content JSON 展示威胁分项 + 查证图 + 采集时间。
 * 分值条按「各满分相对最大满分」比例画槽宽；满分最大的一项顶格。
 */

import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  buildEvidenceScoreRows,
  parseAlarmEvidenceContent,
  resolveEvidenceImageUrl,
  type AlarmEvidenceContent,
  type EvidenceScoreRow,
} from "@/lib/alarm-evidence-content";

/** 数字与正文统一黑体栈，不用等宽字体 */
const NUM_FONT =
  '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "SimHei", sans-serif';

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(1);
}

function formatMax(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(0);
}

/**
 * 标签 | 当前分 | 进度条 | 满分
 * scaleMax：本组最大满分（通常为类型 42），该项槽宽 = max/scaleMax
 */
function ScoreRow({
  label,
  value,
  max,
  scaleMax,
}: {
  label: string;
  value: number;
  max: number;
  scaleMax: number;
}) {
  const trackPct =
    scaleMax > 0 ? Math.min(100, Math.max(0, (max / scaleMax) * 100)) : 100;
  const fillPct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const active = value > 0.05;
  return (
    <div className="flex h-5 items-center gap-1.5 text-[11px] leading-none">
      <span className="w-[52px] shrink-0 truncate text-nexus-text-secondary">{label}</span>
      <span
        className="w-8 shrink-0 text-right tabular-nums text-nexus-text-primary"
        style={{ fontFamily: NUM_FONT }}
      >
        {formatScore(value)}
      </span>
      {/* 外层占满可用宽；内层槽按满分比例缩短，右侧留空 */}
      <div className="relative h-[6px] min-w-0 flex-1">
        <div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-[1px] bg-white/[0.08]"
          style={{ width: `${trackPct}%` }}
        >
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-[1px]",
              active ? "bg-[#2dd4bf]" : "bg-transparent",
            )}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>
      <span
        className="w-6 shrink-0 text-right tabular-nums text-nexus-text-muted"
        style={{ fontFamily: NUM_FONT }}
      >
        {formatMax(max)}
      </span>
    </div>
  );
}

function EvidenceHoverCard({
  evidence,
  imageUrl,
  anchorRect,
}: {
  evidence: AlarmEvidenceContent;
  imageUrl: string | null;
  anchorRect: DOMRect;
}) {
  const rows: EvidenceScoreRow[] = buildEvidenceScoreRows(evidence);
  const scaleMax = Math.max(1, ...rows.map((r) => r.max), 42);
  const total = evidence.threat_total;
  const camera = evidence.image_camera_index?.trim() || "可见光";
  const uploaded = evidence.image_uploaded_at?.trim() ?? "";

  const cardW = 280;
  const left = Math.min(anchorRect.right + 10, window.innerWidth - cardW - 8);
  const top = Math.min(Math.max(8, anchorRect.top), window.innerHeight - 440);

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10040] rounded-sm border border-nexus-border-strong bg-nexus-bg-sidebar p-3 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
      style={{ left, top, width: cardW, fontFamily: NUM_FONT }}
      role="tooltip"
    >
      <div className="overflow-hidden rounded-[2px]">
        {/* 标题：威胁度 …… 21.6/100 */}
        <div className="flex items-baseline justify-between gap-2 border-b border-nexus-border pb-2">
          <span className="text-[12px] font-medium text-nexus-text-primary">威胁度</span>
          {total != null ? (
            <span
              className="text-[13px] font-semibold tabular-nums tracking-tight text-[#2dd4bf]"
              style={{ fontFamily: NUM_FONT }}
            >
              {formatScore(total)}
              <span className="text-[11px] font-normal text-nexus-text-muted">/100</span>
            </span>
          ) : (
            <span className="text-[12px] text-nexus-text-muted">—</span>
          )}
        </div>

        {/* 分项 */}
        {rows.length > 0 ? (
          <div className="space-y-1.5 py-2.5">
            {rows.map((r) => (
              <ScoreRow
                key={r.key}
                label={r.label}
                value={r.value}
                max={r.max}
                scaleMax={scaleMax}
              />
            ))}
          </div>
        ) : (
          <p className="py-2 text-[11px] text-nexus-text-muted">暂无威胁度分项</p>
        )}

        {/* 查证图 */}
        {imageUrl ? (
          <div className="relative overflow-hidden rounded-[2px] border border-nexus-border bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="查证图"
              className="block h-[128px] w-full object-cover"
              draggable={false}
            />
            <div
              className="pointer-events-none absolute bottom-1.5 right-1.5 max-w-[92%] text-right text-[10px] leading-[1.25] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              style={{ fontFamily: NUM_FONT }}
            >
              <div className="truncate">{camera}</div>
              {uploaded ? <div className="tabular-nums opacity-95">{uploaded}</div> : null}
            </div>
          </div>
        ) : (
          <div className="flex h-[72px] items-center justify-center rounded-[2px] border border-dashed border-nexus-border text-[11px] text-nexus-text-muted">
            暂无查证图片
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

type Props = {
  content: string | null | undefined;
  className?: string;
  children: ReactNode;
};

/** 包裹告警行：hover 时若 content 可解析则在右侧弹出分值/图片 */
export function AlertEvidenceHoverHost({ content, className, children }: Props) {
  const evidence = useMemo(() => parseAlarmEvidenceContent(content), [content]);
  const imageUrl = useMemo(
    () => (evidence ? resolveEvidenceImageUrl(evidence) : null),
    [evidence],
  );
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const showCard =
    Boolean(anchorRect) &&
    Boolean(evidence) &&
    !evidence?.rawText &&
    (evidence!.threat_total != null ||
      evidence!.score_type != null ||
      imageUrl != null);

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchorRect(null)}
    >
      {children}
      {showCard && evidence && anchorRect && typeof document !== "undefined" ? (
        <EvidenceHoverCard evidence={evidence} imageUrl={imageUrl} anchorRect={anchorRect} />
      ) : null}
    </div>
  );
}

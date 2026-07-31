/**
 * 将评估报告中的 chart 块渲染为 JPEG（浏览器 Canvas）。
 * Word 服务支持 JPEG/PNG/WebP，按需求使用 image/jpeg。
 */

import type { ReportBlock } from "@/lib/eval-report/types";
import {
  formatTrackChartValue,
  trackChartBarRatio,
  type TrackChartItem,
} from "@/lib/eval-report/track-chart-items";

export type ChartBlock = Extract<ReportBlock, { type: "chart" }>;

export interface ChartJpegResult {
  blob: Blob;
  fileName: string;
  caption: string;
}

function isRenderableChart(block: ChartBlock): boolean {
  if (block.chartType === "placeholder") return false;
  const data = block.data as {
    stages?: unknown[];
    items?: Array<{ value: number | null }>;
  } | null;
  if (block.chartType === "perf-stage-bars") {
    return (data?.stages?.length ?? 0) > 0;
  }
  if (block.chartType === "track-metric-summary") {
    return (data?.items ?? []).some((x) => x.value != null);
  }
  return false;
}

export function collectRenderableChartBlocks(doc: {
  sections: Array<{ blocks: ReportBlock[] }>;
}): ChartBlock[] {
  const out: ChartBlock[] = [];
  for (const sec of doc.sections) {
    for (const b of sec.blocks) {
      if (b.type === "chart" && isRenderableChart(b)) out.push(b);
    }
  }
  return out;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let line = "";
  for (const ch of chars) {
    const trial = line + ch;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob 失败"));
      },
      "image/jpeg",
      quality,
    );
  });
}

function drawBarChartJpeg(input: {
  title: string;
  rows: Array<{ label: string; ratio: number; valueText: string }>;
  barColor: string;
}): HTMLCanvasElement {
  const width = 860;
  const leftLabelW = 210;
  const rightValueW = 130;
  const padX = 28;
  const padTop = 52;
  const padBottom = 28;
  const rowH = 38;
  const barAreaW = width - padX * 2 - leftLabelW - rightValueW;
  const height = padTop + input.rows.length * rowH + padBottom;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(height, 120);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2D canvas");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(input.title, padX, 32);

  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(padX, 40);
  ctx.lineTo(width - padX, 40);
  ctx.stroke();

  input.rows.forEach((row, i) => {
    const y = padTop + i * rowH;
    const barY = y + 8;
    const barH = 16;
    const ratio = Math.max(0, Math.min(1, row.ratio));

    ctx.fillStyle = "#334155";
    ctx.font = "13px sans-serif";
    const labelLines = wrapText(ctx, row.label, leftLabelW - 8);
    ctx.fillText(labelLines[0] ?? row.label, padX, barY + 13);

    const barX = padX + leftLabelW;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(barX, barY, barAreaW, barH);
    ctx.fillStyle = input.barColor;
    ctx.fillRect(barX, barY, Math.max(2, barAreaW * ratio), barH);

    ctx.fillStyle = "#0f172a";
    ctx.font = "12px monospace";
    ctx.textAlign = "right";
    ctx.fillText(row.valueText, width - padX, barY + 13);
    ctx.textAlign = "left";
  });

  return canvas;
}

function trackSummaryBarColor(blockId: string): string {
  if (blockId.includes("continuity")) return "#f59e0b";
  if (blockId.includes("error")) return "#ef4444";
  return "#10b981";
}

/** 将单个 chart 块画成 JPEG Blob；无法渲染时返回 null */
export async function renderChartBlockToJpeg(
  block: ChartBlock,
): Promise<ChartJpegResult | null> {
  if (typeof document === "undefined") return null;
  if (!isRenderableChart(block)) return null;

  const data = block.data as {
    stages?: Array<{ label: string; ms: number; count: number }>;
    totalMs?: number;
    items?: TrackChartItem[];
  } | null;

  let canvas: HTMLCanvasElement | null = null;

  if (block.chartType === "perf-stage-bars" && data?.stages?.length) {
    const maxMs = Math.max(1, ...data.stages.map((s) => s.ms));
    const rows = data.stages.map((s) => ({
      label: s.label,
      ratio: s.ms / maxMs,
      valueText: `${Math.round(s.ms)} ms`,
    }));
    if (data.totalMs != null) {
      rows.push({
        label: "合计均值",
        ratio: Math.min(1, data.totalMs / Math.max(maxMs, data.totalMs)),
        valueText: `${Math.round(data.totalMs)} ms`,
      });
    }
    canvas = drawBarChartJpeg({
      title: block.title,
      rows,
      barColor: "#0ea5e9",
    });
  } else if (block.chartType === "track-metric-summary" && data?.items?.length) {
    const items = data.items.filter(
      (x): x is TrackChartItem & { value: number } => x.value != null && !Number.isNaN(x.value),
    );
    if (items.length === 0) return null;
    const maxAbs = Math.max(
      1e-9,
      ...items
        .filter((x) => (x.format ?? "percent") !== "percent")
        .map((x) => Math.abs(x.value)),
    );
    canvas = drawBarChartJpeg({
      title: block.title,
      rows: items.map((it) => ({
        label: it.label,
        ratio: trackChartBarRatio(it, maxAbs),
        valueText: formatTrackChartValue(it),
      })),
      barColor: trackSummaryBarColor(block.id),
    });
  }

  if (!canvas) return null;
  const blob = await canvasToJpegBlob(canvas, 0.9);
  return {
    blob,
    fileName: `${block.id || "chart"}.jpg`,
    caption: block.title.slice(0, 500),
  };
}

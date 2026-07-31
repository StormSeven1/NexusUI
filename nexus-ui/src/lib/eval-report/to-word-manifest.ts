import type { ReportBlock, ReportDocument, ReportSection } from "@/lib/eval-report/types";
import {
  EVAL_REPORT_AUTHOR,
  EVAL_REPORT_TITLE,
  chineseSectionOrdinal,
  stripReportHeadingPrefix,
} from "@/lib/eval-report/types";

/** 与 Word 报告生成接口 manifest 对齐 */
export type WordTextRole = "heading1" | "heading2" | "body";

export type WordManifestBlock =
  | { type: "text"; role: WordTextRole; text: string }
  | {
      type: "image";
      source: { type: "url"; url: string } | { type: "upload"; image_index: number };
      caption?: string;
    };

export interface WordReportManifest {
  cover: {
    title: string;
    reporter: string;
    report_date: string;
  };
  blocks: WordManifestBlock[];
}

export interface ReportDocumentToWordOptions {
  reporter?: string;
  reportDate?: string;
  /**
   * chart 块 id → multipart images 中的下标。
   * 有映射时写入 image/upload；否则退回文字摘要。
   */
  chartImageIndexById?: Map<string, number>;
}

function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pushBody(blocks: WordManifestBlock[], text: string) {
  const t = text.trim();
  if (!t) return;
  blocks.push({ type: "text", role: "body", text: t });
}

function tableToPlainText(headers: string[], rows: string[][]): string {
  const lines: string[] = [];
  if (headers.length > 0) {
    lines.push(headers.join(" | "));
    lines.push(headers.map(() => "---").join(" | "));
  }
  for (const row of rows) {
    lines.push(row.join(" | "));
  }
  return lines.join("\n");
}

function chartToPlainText(block: Extract<ReportBlock, { type: "chart" }>): string {
  const data = block.data as {
    stages?: Array<{ label: string; ms: number; count: number }>;
    totalMs?: number;
    items?: Array<{ label: string; value: number | null }>;
  } | null;

  if (block.chartType === "perf-stage-bars" && data?.stages?.length) {
    const lines = data.stages.map(
      (s) => `${s.label}：${Math.round(s.ms)} ms（样本 ${s.count}）`,
    );
    if (data.totalMs != null) {
      lines.push(`合计均值：${Math.round(data.totalMs)} ms`);
    }
    return `${block.title}\n${lines.join("\n")}`;
  }

  if (block.chartType === "track-metric-summary" && data?.items?.length) {
    const lines = data.items
      .filter((x) => x.value != null)
      .map((x) => {
        const format = (x as { format?: string }).format ?? "percent";
        const unit = (x as { unit?: string }).unit ?? "";
        const digits = (x as { digits?: number }).digits;
        const v = x.value as number;
        if (format === "percent") {
          return `${x.label}：${(v * 100).toFixed(digits ?? 1)}%`;
        }
        return `${x.label}：${v.toFixed(digits ?? 2)}${unit || (format === "count" ? " 次" : "")}`;
      });
    return `${block.title}\n${lines.join("\n")}`;
  }

  return `${block.title}（暂无图表数据）`;
}

function blockToWord(
  block: ReportBlock,
  out: WordManifestBlock[],
  options?: ReportDocumentToWordOptions,
) {
  switch (block.type) {
    case "heading": {
      // 一级：heading1（一、）；二级：heading2（1、）
      const role: WordTextRole =
        block.level === 1 ? "heading1" : block.level === 2 ? "heading2" : "body";
      out.push({ type: "text", role, text: block.text });
      break;
    }
    case "paragraph":
    case "note":
    case "placeholder":
      pushBody(out, block.text);
      break;
    case "kv":
      pushBody(
        out,
        block.items.map((it) => `${it.label}：${it.value}`).join("\n"),
      );
      break;
    case "table":
      pushBody(out, tableToPlainText(block.headers, block.rows));
      break;
    case "chart": {
      const idx = options?.chartImageIndexById?.get(block.id);
      if (idx != null && Number.isFinite(idx) && idx >= 0) {
        out.push({
          type: "image",
          source: { type: "upload", image_index: idx },
          caption: block.title.slice(0, 500),
        });
      } else {
        pushBody(out, chartToPlainText(block));
      }
      break;
    }
    case "image":
      if (block.src && /^https?:\/\//i.test(block.src)) {
        out.push({
          type: "image",
          source: { type: "url", url: block.src },
          caption: block.caption,
        });
      } else if (block.caption) {
        pushBody(out, `[图片] ${block.caption}`);
      }
      break;
    default:
      break;
  }
}

function sectionToWord(
  sec: ReportSection,
  out: WordManifestBlock[],
  options?: ReportDocumentToWordOptions,
) {
  out.push({ type: "text", role: "heading1", text: sec.title });
  const baseTitle = stripReportHeadingPrefix(sec.title);
  let skippedFirstDupHeading = false;
  for (const b of sec.blocks) {
    if (
      !skippedFirstDupHeading &&
      b.type === "heading" &&
      (b.level === 1 || b.level === 2) &&
      stripReportHeadingPrefix(b.text) === baseTitle
    ) {
      skippedFirstDupHeading = true;
      continue;
    }
    blockToWord(b, out, options);
  }
}

/**
 * 将内部 ReportDocument 转为 Word 服务 manifest。
 * 传入 chartImageIndexById 时，对应 chart 以 JPEG 上传块写入。
 */
export function reportDocumentToWordManifest(
  doc: ReportDocument,
  options?: ReportDocumentToWordOptions,
): WordReportManifest {
  const blocks: WordManifestBlock[] = [];

  if (doc.meta.timeRange) {
    pushBody(
      blocks,
      `评估时间范围：${doc.meta.timeRange.start} ~ ${doc.meta.timeRange.end}`,
    );
  }
  if (doc.meta.trackSensorLabels && doc.meta.trackSensorLabels.length > 0) {
    pushBody(blocks, `航迹传感器：${doc.meta.trackSensorLabels.join("、")}`);
  }

  for (const sec of doc.sections) {
    sectionToWord(sec, blocks, options);
  }

  if (doc.meta.notes && doc.meta.notes.length > 0) {
    const noteOrd = chineseSectionOrdinal(doc.sections.length);
    blocks.push({ type: "text", role: "heading1", text: `${noteOrd}、备注` });
    pushBody(blocks, doc.meta.notes.map((n) => `· ${n}`).join("\n"));
  }

  return {
    cover: {
      title: (doc.title || EVAL_REPORT_TITLE).slice(0, 200),
      reporter: (
        options?.reporter ??
        doc.meta.author ??
        EVAL_REPORT_AUTHOR
      ).slice(0, 100),
      report_date: options?.reportDate ?? todayYmd(),
    },
    blocks,
  };
}

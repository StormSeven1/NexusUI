/**
 * 评估报告结构化文档：预览与 Word 服务共用同一模型。
 */

export type ReportHeadingLevel = 1 | 2 | 3;

export type ReportChartType =
  | "perf-stage-bars"
  | "track-metric-summary"
  | "placeholder";

export type ReportBlock =
  | { type: "heading"; level: ReportHeadingLevel; text: string }
  | { type: "paragraph"; text: string }
  | { type: "note"; text: string }
  | { type: "kv"; items: Array<{ label: string; value: string }> }
  | { type: "table"; headers: string[]; rows: string[][] }
  | {
      type: "chart";
      id: string;
      title: string;
      chartType: ReportChartType;
      /** 图表原始数据；后续可导出为 PNG 后填 imageId */
      data: unknown;
      imageId?: string;
      /** 预览用：chart 导出的 JPEG/PNG data URL 或可访问地址 */
      src?: string;
    }
  | { type: "placeholder"; text: string }
  | { type: "image"; id: string; caption?: string; src?: string };

export interface ReportSection {
  id: string;
  title: string;
  status: "ok" | "error" | "placeholder" | "skipped";
  errorMessage?: string;
  blocks: ReportBlock[];
}

export interface ReportDocument {
  id: string;
  title: string;
  generatedAt: string;
  meta: {
    timeRange?: { start: string; end: string };
    trackSensorIds?: number[];
    trackSensorLabels?: string[];
    notes?: string[];
    /** 本次勾选的报告章节 */
    selectedKinds?: EvalReportSectionKind[];
    /** 封面作者 / Word reporter */
    author?: string;
  };
  sections: ReportSection[];
}

/** 报告封面标题 */
export const EVAL_REPORT_TITLE = "融控系统评估报告";

/** 报告封面作者 */
export const EVAL_REPORT_AUTHOR = "刘沛";

/** 报告可勾选的评估类型 */
export type EvalReportSectionKind = "system" | "track" | "camera";

export const EVAL_REPORT_SECTION_OPTIONS: Array<{
  id: EvalReportSectionKind;
  label: string;
}> = [
  { id: "system", label: "系统评估" },
  { id: "track", label: "航迹评估" },
  { id: "camera", label: "光电评估" },
];

export const DEFAULT_EVAL_REPORT_SECTION_KINDS: EvalReportSectionKind[] = [
  "system",
  "track",
  "camera",
];

export type EvalReportPhase =
  | "idle"
  | "system"
  | "track"
  | "camera"
  | "assembling"
  | "word"
  | "done"
  | "error";

/** Word 服务返回的下载信息 */
export interface WordReportDownloadInfo {
  requestId: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes?: number;
}

const CN_ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"] as const;

/** 去掉已有「一、」或「1、」前缀，便于重编号 */
export function stripReportHeadingPrefix(text: string): string {
  return text
    .replace(/^[一二三四五六七八九十百]+、\s*/, "")
    .replace(/^\d+、\s*/, "")
    .trim();
}

export function chineseSectionOrdinal(index0: number): string {
  return CN_ORDINALS[index0] ?? String(index0 + 1);
}

/**
 * 一级标题：一、二、三…
 * 二级标题：1、2、3…（每章内重新从 1 起）
 */
export function applyReportOutlineNumbering(sections: ReportSection[]): ReportSection[] {
  return sections.map((sec, secIdx) => {
    const baseTitle = stripReportHeadingPrefix(sec.title);
    const numberedTitle = `${chineseSectionOrdinal(secIdx)}、${baseTitle}`;
    let subIdx = 0;
    const blocks = sec.blocks.map((b) => {
      if (b.type !== "heading") return b;
      const raw = stripReportHeadingPrefix(b.text);
      if ((b.level === 1 || b.level === 2) && raw === baseTitle) {
        return { ...b, level: 1 as const, text: numberedTitle };
      }
      if (b.level === 2 || b.level === 3) {
        subIdx += 1;
        return { ...b, level: 2 as const, text: `${subIdx}、${raw}` };
      }
      if (b.level === 1) {
        return { ...b, text: `${chineseSectionOrdinal(secIdx)}、${raw}` };
      }
      return b;
    });
    return { ...sec, title: numberedTitle, blocks };
  });
}

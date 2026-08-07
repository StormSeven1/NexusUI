"use client";

import { create } from "zustand";
import { toast } from "sonner";
import { runEvalReportGeneration } from "@/lib/eval-report/run-eval-report";
import {
  attachChartPreviewsToDocument,
  generateWordReportFromDocument,
  triggerWordFileDownload,
} from "@/lib/eval-report/word-report-api";
import { stopAllEvalTasks } from "@/lib/system-eval-stop-api";
import type {
  EvalReportPhase,
  EvalReportSectionKind,
  ReportDocument,
  WordReportDownloadInfo,
} from "@/lib/eval-report/types";
import { DEFAULT_EVAL_REPORT_SECTION_KINDS } from "@/lib/eval-report/types";
import type { SystemResponseTimeStats } from "@/lib/system-eval-perf-api";

/** 当前报告生成的取消令牌（不进 zustand 持久化） */
let reportAbort: AbortController | null = null;

export type CachedSystemPerfSnapshot = {
  stats: SystemResponseTimeStats | null;
  error: string | null;
  fetchedAt: string;
  /** 系统评估页已完成的航迹链路评估（有则报告直接复用） */
  trackLinkResults?: import("@/lib/system-eval-track-link-api").TrackLinkTypeResult[] | null;
  trackLinkError?: string | null;
  trackLinkDurationSec?: number | null;
};

interface EvalReportState {
  phase: EvalReportPhase;
  progressMessage: string;
  document: ReportDocument | null;
  error: string | null;
  generating: boolean;
  /** 勾选的评估类型（多选） */
  selectedKinds: EvalReportSectionKind[];
  /**
   * 为 true 时：航迹章节复用质量评估页当前 metrics；
   * 若提供 cachedSystem 则系统章节也复用，不重新拉取。
   */
  reuseExistingResults: boolean;
  cachedSystem: CachedSystemPerfSnapshot | null;
  wordDownload: WordReportDownloadInfo | null;
  wordError: string | null;
  /** 用户点击「下载 Word」后才生成/拉取 Word */
  wordDownloading: boolean;
  /** 停止全部任务进行中 */
  stopping: boolean;
  toggleKind: (kind: EvalReportSectionKind) => void;
  setSelectedKinds: (kinds: EvalReportSectionKind[]) => void;
  prepareOpen: (opts?: {
    reuseExistingResults?: boolean;
    selectedKinds?: EvalReportSectionKind[];
    cachedSystem?: CachedSystemPerfSnapshot | null;
  }) => void;
  generate: () => Promise<void>;
  /** 停止报告生成 + 后端评估任务 */
  stopAllTasks: () => Promise<void>;
  /** 仅在用户点击下载时调用：生成 Word 并触发浏览器下载 */
  downloadWord: () => Promise<void>;
  reset: () => void;
}

export const useEvalReportStore = create<EvalReportState>((set, get) => ({
  phase: "idle",
  progressMessage: "",
  document: null,
  error: null,
  generating: false,
  selectedKinds: [...DEFAULT_EVAL_REPORT_SECTION_KINDS],
  reuseExistingResults: false,
  cachedSystem: null,
  wordDownload: null,
  wordError: null,
  wordDownloading: false,
  stopping: false,

  toggleKind: (kind) => {
    const cur = get().selectedKinds;
    const has = cur.includes(kind);
    if (has && cur.length === 1) {
      toast.message("请至少保留一种评估类型");
      return;
    }
    set({
      selectedKinds: has
        ? cur.filter((k) => k !== kind)
        : [...cur, kind],
    });
  },

  setSelectedKinds: (kinds) => {
    if (kinds.length === 0) {
      toast.message("请至少勾选一种评估类型");
      return;
    }
    set({ selectedKinds: [...kinds] });
  },

  prepareOpen: (opts) => {
    const next: Partial<EvalReportState> = {
      reuseExistingResults: opts?.reuseExistingResults === true,
      cachedSystem: opts?.cachedSystem ?? null,
    };
    if (opts?.selectedKinds && opts.selectedKinds.length > 0) {
      next.selectedKinds = [...opts.selectedKinds];
    } else if (!opts?.reuseExistingResults) {
      next.selectedKinds = [...DEFAULT_EVAL_REPORT_SECTION_KINDS];
    }
    set(next);
  },

  reset: () =>
    set({
      phase: "idle",
      progressMessage: "",
      document: null,
      error: null,
      generating: false,
      stopping: false,
      wordDownload: null,
      wordError: null,
      wordDownloading: false,
      reuseExistingResults: false,
      cachedSystem: null,
    }),

  generate: async () => {
    if (get().generating || get().wordDownloading || get().stopping) return;
    const kinds = get().selectedKinds;
    if (kinds.length === 0) {
      toast.message("请至少勾选一种评估类型");
      return;
    }

    const reuse = get().reuseExistingResults;
    reportAbort?.abort();
    const abort = new AbortController();
    reportAbort = abort;
    set({
      generating: true,
      phase: kinds[0] ?? "system",
      progressMessage: reuse
        ? "开始根据当前结果生成评估报告…"
        : "开始生成评估报告…",
      error: null,
      wordDownload: null,
      wordError: null,
      document: null,
    });

    try {
      const doc = await runEvalReportGeneration(
        (info) => {
          if (abort.signal.aborted) return;
          set({
            phase: info.phase,
            progressMessage: info.message,
          });
        },
        {
          kinds,
          reuseExistingResults: reuse,
          cachedSystem: get().cachedSystem,
          signal: abort.signal,
        },
      );

      if (abort.signal.aborted) {
        set({
          phase: "idle",
          progressMessage: "已停止生成",
          generating: false,
        });
        return;
      }

      set({
        document: doc,
        phase: "done",
        progressMessage: "正在渲染预览图表…",
      });

      const previewDoc = await attachChartPreviewsToDocument(doc);
      if (abort.signal.aborted) {
        set({
          phase: "idle",
          progressMessage: "已停止生成",
          generating: false,
          document: null,
        });
        return;
      }
      set({
        document: previewDoc,
        phase: "done",
        progressMessage: "报告预览已就绪，请点击「下载 Word」",
        generating: false,
      });
      toast.success("评估报告已生成", {
        description: "可预览；需要文件时请点击「下载 Word」",
      });
    } catch (e) {
      if (abort.signal.aborted) {
        set({
          phase: "idle",
          progressMessage: "已停止生成",
          generating: false,
          error: null,
        });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      set({
        phase: "error",
        error: msg,
        progressMessage: "生成失败",
        generating: false,
        wordDownload: null,
      });
      toast.error("评估报告生成失败", { description: msg });
    } finally {
      if (reportAbort === abort) reportAbort = null;
    }
  },

  stopAllTasks: async () => {
    if (get().stopping) return;
    set({ stopping: true, progressMessage: "正在停止全部评估任务…" });

    reportAbort?.abort();
    reportAbort = null;

    try {
      const r = await stopAllEvalTasks();
      set({
        generating: false,
        stopping: false,
        phase: get().document ? "done" : "idle",
        progressMessage: r.message || "已请求停止全部任务",
        error: null,
      });
      if (r.ok) {
        toast.success("已停止全部任务", { description: r.message });
      } else {
        toast.message("已中断前端生成", { description: r.message || "后端停止可能未完全成功" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({
        generating: false,
        stopping: false,
        progressMessage: "停止请求失败",
      });
      toast.error("停止任务失败", { description: msg });
    }
  },

  downloadWord: async () => {
    const doc = get().document;
    if (!doc) {
      toast.message("请先生成报告预览");
      return;
    }
    if (get().generating || get().wordDownloading) return;

    const existing = get().wordDownload;
    if (existing?.downloadUrl) {
      triggerWordFileDownload(existing);
      return;
    }

    set({
      wordDownloading: true,
      wordError: null,
      progressMessage: "正在生成 Word 文档…",
    });

    try {
      const wordResult = await generateWordReportFromDocument(doc);
      if (wordResult.ok && wordResult.download) {
        set({
          document: wordResult.previewDocument ?? doc,
          wordDownload: wordResult.download,
          wordError: null,
          progressMessage: "Word 已生成",
          wordDownloading: false,
        });
        triggerWordFileDownload(wordResult.download);
        toast.success("Word 已开始下载", {
          description: wordResult.download.fileName,
        });
      } else {
        const werr = wordResult.error || "Word 生成失败";
        set({
          document: wordResult.previewDocument ?? doc,
          wordDownload: null,
          wordError: werr,
          progressMessage: "Word 生成失败",
          wordDownloading: false,
        });
        toast.error("Word 下载失败", { description: werr });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({
        wordError: msg,
        wordDownloading: false,
        progressMessage: "Word 生成失败",
      });
      toast.error("Word 下载失败", { description: msg });
    }
  },
}));

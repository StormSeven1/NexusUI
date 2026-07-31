"use client";

import { Download, FileText, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvalReportStore } from "@/stores/eval-report-store";
import {
  EVAL_REPORT_AUTHOR,
  EVAL_REPORT_SECTION_OPTIONS,
  chineseSectionOrdinal,
  stripReportHeadingPrefix,
  type ReportBlock,
  type ReportDocument,
  type ReportSection,
} from "@/lib/eval-report/types";

function PerfStageBarsChart({ data }: { data: unknown }) {
  const parsed = data as {
    stages?: Array<{ label: string; ms: number; count: number }>;
    totalMs?: number;
  } | null;
  const stages = parsed?.stages ?? [];
  if (stages.length === 0) {
    return <p className="text-[11px] text-nexus-text-muted">暂无阶段数据</p>;
  }
  const maxMs = Math.max(1, ...stages.map((s) => s.ms));
  return (
    <div className="space-y-2 rounded-md border border-nexus-border/60 bg-white p-3 text-slate-800">
      {stages.map((r) => (
        <div key={r.label}>
          <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
            <span>{r.label}</span>
            <span className="shrink-0 font-mono">{Math.round(r.ms)} ms</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-sky-500"
              style={{ width: `${Math.min(100, (r.ms / maxMs) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      {parsed?.totalMs != null ? (
        <p className="pt-1 text-[10px] text-slate-500">
          合计均值 {Math.round(parsed.totalMs)} ms
        </p>
      ) : null}
    </div>
  );
}

function TrackMetricSummaryChart({ data }: { data: unknown }) {
  const parsed = data as {
    items?: Array<{
      label: string;
      value: number | null;
      format?: "percent" | "count" | "number";
      unit?: string;
      digits?: number;
    }>;
  } | null;
  const items = (parsed?.items ?? []).filter(
    (x): x is { label: string; value: number; format?: "percent" | "count" | "number"; unit?: string; digits?: number } =>
      x.value != null && !Number.isNaN(x.value),
  );
  if (items.length === 0) {
    return <p className="text-[11px] text-nexus-text-muted">暂无摘要数据</p>;
  }
  const maxAbs = Math.max(
    1e-9,
    ...items.filter((x) => (x.format ?? "percent") !== "percent").map((x) => Math.abs(x.value)),
  );
  return (
    <div className="space-y-2 rounded-md border border-nexus-border/60 bg-white p-3 text-slate-800">
      {items.map((it) => {
        const format = it.format ?? "percent";
        const ratio =
          format === "percent"
            ? Math.max(0, Math.min(1, it.value))
            : Math.max(0, Math.min(1, Math.abs(it.value) / maxAbs));
        const valueText =
          format === "percent"
            ? `${(it.value * 100).toFixed(it.digits ?? 1)}%`
            : `${it.value.toFixed(it.digits ?? 2)}${it.unit ?? (format === "count" ? " 次" : "")}`;
        return (
          <div key={it.label}>
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
              <span>{it.label}</span>
              <span className="shrink-0 font-mono">{valueText}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReportChartBlock({ block }: { block: Extract<ReportBlock, { type: "chart" }> }) {
  return (
    <figure className="my-3">
      <figcaption className="mb-1.5 text-[11px] font-medium text-nexus-text-secondary">
        {block.title}
      </figcaption>
      {block.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.src}
          alt={block.title}
          className="max-w-full rounded border border-nexus-border/70 bg-white"
        />
      ) : block.chartType === "perf-stage-bars" ? (
        <PerfStageBarsChart data={block.data} />
      ) : block.chartType === "track-metric-summary" ? (
        <TrackMetricSummaryChart data={block.data} />
      ) : (
        <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-6 text-center text-[11px] text-amber-200/90">
          图表占位（光电评估算法接入后生成）
        </div>
      )}
    </figure>
  );
}

function ReportBlockView({ block }: { block: ReportBlock }) {
  switch (block.type) {
    case "heading": {
      if (block.level === 1) {
        return (
          <h3 className="mt-3 border-b border-nexus-border/80 pb-1.5 text-[15px] font-bold tracking-wide text-nexus-text-primary first:mt-0">
            {block.text}
          </h3>
        );
      }
      if (block.level === 2) {
        return (
          <h4 className="mt-2 text-[13px] font-semibold text-nexus-text-primary">
            {block.text}
          </h4>
        );
      }
      return (
        <h5 className="text-xs font-semibold text-nexus-text-secondary">{block.text}</h5>
      );
    }
    case "paragraph":
      return <p className="text-[12px] leading-relaxed text-nexus-text-secondary">{block.text}</p>;
    case "note":
      return (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          {block.text}
        </p>
      );
    case "placeholder":
      return (
        <p className="rounded border border-dashed border-nexus-border px-2 py-3 text-[11px] text-nexus-text-muted">
          {block.text}
        </p>
      );
    case "kv":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {block.items.map((it) => (
            <div key={it.label} className="contents">
              <dt className="text-nexus-text-muted">{it.label}</dt>
              <dd className="font-mono text-nexus-text-primary">{it.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded border border-nexus-border/70">
          <table className="w-full min-w-[280px] border-collapse text-[11px]">
            <thead>
              <tr className="bg-nexus-bg-elevated/80">
                {block.headers.map((h) => (
                  <th
                    key={h}
                    className="border-b border-nexus-border px-2 py-1.5 text-left font-medium text-nexus-text-secondary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="odd:bg-nexus-bg-base/30">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="border-b border-nexus-border/40 px-2 py-1 font-mono text-nexus-text-primary"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "chart":
      return <ReportChartBlock block={block} />;
    case "image":
      return block.src ? (
        <figure className="my-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.src} alt={block.caption ?? block.id} className="max-w-full rounded border border-nexus-border" />
          {block.caption ? (
            <figcaption className="mt-1 text-[10px] text-nexus-text-muted">{block.caption}</figcaption>
          ) : null}
        </figure>
      ) : (
        <p className="text-[11px] text-nexus-text-muted">图片 {block.id}（待导出）</p>
      );
    default:
      return null;
  }
}

function SectionStatusBadge({ status }: { status: ReportSection["status"] }) {
  const map = {
    ok: "bg-emerald-500/15 text-emerald-300",
    error: "bg-red-500/15 text-red-300",
    placeholder: "bg-amber-500/15 text-amber-200",
    skipped: "bg-nexus-bg-elevated text-nexus-text-muted",
  } as const;
  const label = {
    ok: "完成",
    error: "失败",
    placeholder: "占位",
    skipped: "跳过",
  } as const;
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium", map[status])}>
      {label[status]}
    </span>
  );
}

function DocumentPreview({ doc }: { doc: ReportDocument }) {
  const author = doc.meta.author?.trim() || EVAL_REPORT_AUTHOR;
  return (
    <article className="space-y-5">
      <header className="border-b border-nexus-border pb-3 text-center">
        <h2 className="text-lg font-bold tracking-wide text-nexus-text-primary">{doc.title}</h2>
        <p className="mt-2 text-[11px] text-nexus-text-secondary">作者：{author}</p>
        <p className="mt-1 text-[10px] text-nexus-text-muted">
          生成时间：{new Date(doc.generatedAt).toLocaleString()}
        </p>
        {doc.meta.trackSensorLabels && doc.meta.trackSensorLabels.length > 0 ? (
          <p className="mt-0.5 text-[10px] text-nexus-text-muted">
            航迹传感器：{doc.meta.trackSensorLabels.join("、")}
          </p>
        ) : null}
        {doc.meta.timeRange ? (
          <p className="mt-0.5 text-[10px] text-nexus-text-muted">
            时间范围：{doc.meta.timeRange.start} ~ {doc.meta.timeRange.end}
          </p>
        ) : null}
      </header>

      {doc.sections.map((sec) => {
        const baseTitle = stripReportHeadingPrefix(sec.title);
        let skippedDup = false;
        const visibleBlocks = sec.blocks.filter((b) => {
          if (
            !skippedDup &&
            b.type === "heading" &&
            (b.level === 1 || b.level === 2) &&
            stripReportHeadingPrefix(b.text) === baseTitle
          ) {
            skippedDup = true;
            return false;
          }
          return true;
        });
        return (
          <section
            key={sec.id}
            className="space-y-2.5 rounded-lg border border-nexus-border/70 bg-nexus-bg-base/30 p-3"
          >
            <div className="flex items-center justify-between gap-2 border-b border-nexus-border/60 pb-1.5">
              <h3 className="text-[15px] font-bold tracking-wide text-nexus-text-primary">
                {sec.title}
              </h3>
              <SectionStatusBadge status={sec.status} />
            </div>
            <div className="space-y-2.5">
              {visibleBlocks.map((b, i) => (
                <ReportBlockView key={`${sec.id}-${i}`} block={b} />
              ))}
            </div>
          </section>
        );
      })}

      {doc.meta.notes && doc.meta.notes.length > 0 ? (
        <footer className="rounded border border-nexus-border/50 px-2 py-2 text-[10px] text-nexus-text-muted">
          <p className="mb-1 text-[15px] font-bold text-nexus-text-primary">
            {chineseSectionOrdinal(doc.sections.length)}、备注
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {doc.meta.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  );
}

export function EvalReportPanel() {
  const progressMessage = useEvalReportStore((s) => s.progressMessage);
  const document = useEvalReportStore((s) => s.document);
  const error = useEvalReportStore((s) => s.error);
  const generating = useEvalReportStore((s) => s.generating);
  const selectedKinds = useEvalReportStore((s) => s.selectedKinds);
  const reuseExistingResults = useEvalReportStore((s) => s.reuseExistingResults);
  const wordDownload = useEvalReportStore((s) => s.wordDownload);
  const wordError = useEvalReportStore((s) => s.wordError);
  const wordDownloading = useEvalReportStore((s) => s.wordDownloading);
  const toggleKind = useEvalReportStore((s) => s.toggleKind);
  const generate = useEvalReportStore((s) => s.generate);
  const downloadWord = useEvalReportStore((s) => s.downloadWord);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-nexus-border px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={14} className="shrink-0 text-nexus-accent" />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-nexus-text-secondary">
                评估报告
              </p>
              <p className="truncate text-[9px] text-nexus-text-muted">
                {generating || wordDownloading
                  ? progressMessage
                  : document
                    ? "可预览；点击「下载 Word」才会生成并下载文件"
                    : reuseExistingResults
                      ? "将使用当前评估结果生成报告（不重新评估）"
                      : "勾选类型后点击「开始生成」"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {document ? (
              <button
                type="button"
                onClick={() => void downloadWord()}
                disabled={generating || wordDownloading}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px]",
                  "text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50",
                )}
                title={
                  wordDownload?.fileName
                    ? `再次下载：${wordDownload.fileName}`
                    : "生成 Word 并下载（需手动点击）"
                }
              >
                {wordDownloading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
                {wordDownloading ? "下载中…" : "下载 Word"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating || wordDownloading || selectedKinds.length === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-nexus-accent/50 bg-nexus-accent/15 px-2 py-1 text-[10px]",
                "text-nexus-text-primary hover:bg-nexus-accent/25 disabled:opacity-50",
              )}
              title={
                reuseExistingResults
                  ? "根据当前评估结果组装报告预览（不自动下载）"
                  : "按勾选类型执行评估并生成预览（不自动下载）"
              }
            >
              {generating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              {generating ? "生成中…" : document ? "重新生成" : "开始生成"}
            </button>
          </div>
        </div>

        {reuseExistingResults ? (
          <p className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100/90">
            已从质量评估页打开：航迹/系统将优先使用当前结果，无需重新评估。可继续勾选其他章节。
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] text-nexus-text-muted">报告内容：</span>
          {EVAL_REPORT_SECTION_OPTIONS.map((opt) => {
            const checked = selectedKinds.includes(opt.id);
            return (
              <label
                key={opt.id}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 text-[11px]",
                  generating ? "pointer-events-none opacity-60" : "text-nexus-text-secondary",
                )}
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-nexus-border"
                  checked={checked}
                  disabled={generating}
                  onChange={() => toggleKind(opt.id)}
                />
                {opt.label}
              </label>
            );
          })}
        </div>

        {wordError ? (
          <p className="text-[10px] text-amber-200/90">Word：{wordError}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!generating && !document && !error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <FileText className="h-8 w-8 text-nexus-text-muted/60" />
            <p className="text-[12px] text-nexus-text-secondary">尚未生成报告</p>
            <p className="max-w-xs text-[10px] text-nexus-text-muted">
              {reuseExistingResults
                ? "勾选需要写入报告的评估类型，点击「开始生成」。将使用当前页面结果，不会重新跑评估。"
                : "勾选系统评估 / 航迹评估 / 光电评估，点击「开始生成」预览；再点「下载 Word」才会下载文件。"}
            </p>
          </div>
        ) : null}

        {generating && !document ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-nexus-accent" />
            <p className="text-[12px] text-nexus-text-secondary">{progressMessage}</p>
            <p className="text-[10px] text-nexus-text-muted">
              {selectedKinds
                .map((k) => EVAL_REPORT_SECTION_OPTIONS.find((o) => o.id === k)?.label ?? k)
                .join(" → ")}
              {" → Word"}
            </p>
          </div>
        ) : null}

        {error && !document ? (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-300">
            {error}
          </p>
        ) : null}

        {document ? <DocumentPreview doc={document} /> : null}
      </div>
    </div>
  );
}

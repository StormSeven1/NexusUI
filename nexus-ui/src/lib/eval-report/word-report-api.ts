import type { ReportDocument } from "@/lib/eval-report/types";
import type { WordReportDownloadInfo } from "@/lib/eval-report/types";
import { reportDocumentToWordManifest } from "@/lib/eval-report/to-word-manifest";
import {
  collectRenderableChartBlocks,
  renderChartBlockToJpeg,
} from "@/lib/eval-report/render-report-chart-jpeg";

export interface GenerateWordReportResult {
  ok: boolean;
  download?: WordReportDownloadInfo;
  error?: string;
  status?: number;
  requestId?: string;
  code?: string;
  /** 写入了 chart.src（data URL）的文档，供面板预览图片 */
  previewDocument?: ReportDocument;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** 仅渲染图表 JPEG 并写入 chart.src，供预览；不调用 Word 服务 */
export async function attachChartPreviewsToDocument(
  doc: ReportDocument,
): Promise<ReportDocument> {
  const chartBlocks = collectRenderableChartBlocks(doc);
  const previewSrcById = new Map<string, string>();

  for (const block of chartBlocks) {
    try {
      const jpeg = await renderChartBlockToJpeg(block);
      if (!jpeg) continue;
      previewSrcById.set(block.id, await blobToDataUrl(jpeg.blob));
    } catch (e) {
      console.warn("[eval-report] chart JPEG 预览渲染失败", block.id, e);
    }
  }

  if (previewSrcById.size === 0) return doc;

  return {
    ...doc,
    sections: doc.sections.map((sec) => ({
      ...sec,
      blocks: sec.blocks.map((b) => {
        if (b.type !== "chart") return b;
        const src = previewSrcById.get(b.id);
        return src ? { ...b, src } : b;
      }),
    })),
  };
}

/** 用户点击下载后触发浏览器保存 */
export function triggerWordFileDownload(info: WordReportDownloadInfo): void {
  const a = document.createElement("a");
  a.href = info.downloadUrl;
  a.download = info.fileName || "评估报告.docx";
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatWordError(data: Record<string, unknown> | null, status: number): string {
  if (!data) return `Word 生成失败（HTTP ${status}）`;
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.title === "string" && data.title.trim()) return data.title;
  if (Array.isArray(data.detail)) {
    const parts = data.detail.map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const msg = typeof o.msg === "string" ? o.msg : "";
        const loc = Array.isArray(o.loc) ? o.loc.join(".") : "";
        return [loc, msg].filter(Boolean).join(": ");
      }
      return String(x);
    });
    if (parts.some((p) => p.trim())) return parts.filter(Boolean).join("; ");
  }
  return `Word 生成失败（HTTP ${status}）`;
}

/**
 * 图表 → JPEG，multipart 上传到本机 Next 代理 → Word 报告服务。
 * 注意：manifest 必须是普通表单字符串字段，不能作为带文件名的 file part。
 */
export async function generateWordReportFromDocument(
  doc: ReportDocument,
): Promise<GenerateWordReportResult> {
  const requestId = `nexus-eval-${doc.id}-${Date.now()}`;

  try {
    const chartBlocks = collectRenderableChartBlocks(doc);
    const chartImageIndexById = new Map<string, number>();
    const imageFiles: Array<{ blob: Blob; fileName: string }> = [];
    const previewSrcById = new Map<string, string>();

    for (const block of chartBlocks) {
      try {
        const jpeg = await renderChartBlockToJpeg(block);
        if (!jpeg) continue;
        const index = imageFiles.length;
        chartImageIndexById.set(block.id, index);
        imageFiles.push({ blob: jpeg.blob, fileName: jpeg.fileName });
        previewSrcById.set(block.id, await blobToDataUrl(jpeg.blob));
      } catch (e) {
        console.warn("[eval-report] chart JPEG 渲染失败", block.id, e);
      }
    }

    const previewDocument: ReportDocument = {
      ...doc,
      sections: doc.sections.map((sec) => ({
        ...sec,
        blocks: sec.blocks.map((b) => {
          if (b.type !== "chart") return b;
          const src = previewSrcById.get(b.id);
          return src ? { ...b, src } : b;
        }),
      })),
    };

    const manifest = reportDocumentToWordManifest(previewDocument, { chartImageIndexById });

    const form = new FormData();
    // Word/FastAPI：manifest 必须是 Form 字符串，不能是带 filename 的文件
    form.append("manifest", JSON.stringify(manifest));
    for (const img of imageFiles) {
      form.append(
        "images",
        new File([img.blob], img.fileName, { type: "image/jpeg" }),
      );
    }

    const res = await fetch("/api/eval-report/word", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Request-ID": requestId,
      },
      body: form,
      cache: "no-store",
    });

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        ok: false,
        error: formatWordError(data, res.status),
        status: res.status,
        requestId: typeof data?.request_id === "string" ? data.request_id : requestId,
        code: typeof data?.code === "string" ? data.code : undefined,
        previewDocument,
      };
    }

    const downloadUrl = typeof data?.download_url === "string" ? data.download_url : "";
    if (!downloadUrl) {
      return {
        ok: false,
        error: "Word 服务未返回 download_url",
        status: res.status,
        requestId: typeof data?.request_id === "string" ? data.request_id : requestId,
        previewDocument,
      };
    }

    return {
      ok: true,
      download: {
        requestId: typeof data?.request_id === "string" ? data.request_id : requestId,
        fileName:
          typeof data?.file_name === "string" && data.file_name
            ? data.file_name
            : `${doc.title}.docx`,
        downloadUrl,
        sizeBytes: typeof data?.size_bytes === "number" ? data.size_bytes : undefined,
      },
      previewDocument,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      requestId,
    };
  }
}

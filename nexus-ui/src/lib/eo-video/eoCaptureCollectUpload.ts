import type { EoCollectDataType, EoCollectUploadType } from "./eoCaptureCollectUpload.server";

export type { EoCollectDataType, EoCollectUploadType };

export const EO_COLLECT_CAMERA_UPLOAD_TYPES: EoCollectUploadType[] = [
  "红外地对海",
  "红外地对空",
  "可见光地对海",
  "可见光地对空",
];

export const EO_COLLECT_UAV_UPLOAD_TYPES: EoCollectUploadType[] = [
  "可见光空对海",
  "红外空对海",
  "可见光空对空",
  "红外空对空",
];

export function eoCollectUploadTypesForStream(isUav: boolean): EoCollectUploadType[] {
  return isUav ? EO_COLLECT_UAV_UPLOAD_TYPES : EO_COLLECT_CAMERA_UPLOAD_TYPES;
}

export function eoCollectDataTypeForPreviewKind(kind: "snapshot" | "record"): EoCollectDataType {
  return kind === "snapshot" ? "预处理数据" : "原始数据";
}

export type EoCollectUploadResponse =
  | { ok: true; repoPath: string; steps?: Array<{ status: string }> }
  | { ok: false; error: string; detail?: string; steps?: Array<{ status: string }> };

/** 通过 BFF 上传截图/录像至采集仓库（对齐 Qt FileUploadClient 流程） */
export async function uploadEoCaptureCollect(opts: {
  blob: Blob;
  fileName: string;
  uploadType: EoCollectUploadType;
  dataType: EoCollectDataType;
  onStatus?: (status: string) => void;
}): Promise<EoCollectUploadResponse> {
  opts.onStatus?.("正在连接采集服务…");
  const form = new FormData();
  form.append("file", opts.blob, opts.fileName);
  form.append("uploadType", opts.uploadType);
  form.append("dataType", opts.dataType);

  let res: Response;
  try {
    res = await fetch("/api/eo-capture/collect-upload", { method: "POST", body: form });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    repoPath?: string;
    steps?: Array<{ status: string }>;
  };

  if (Array.isArray(data.steps)) {
    for (const s of data.steps) {
      if (s?.status) opts.onStatus?.(s.status);
    }
  }

  if (!res.ok || !data.ok) {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : res.statusText || "上传失败",
      detail: "detail" in data && typeof data.detail === "string" ? data.detail : undefined,
      steps: data.steps,
    };
  }

  return { ok: true, repoPath: data.repoPath ?? "", steps: data.steps };
}

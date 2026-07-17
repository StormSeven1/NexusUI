import { getHttpConfig } from "@/lib/map-app-config";

function backendBase(): string {
  return getHttpConfig().backendUrl.replace(/\/$/, "");
}

export type BirdRadarUploadStep = { status: string };

export type BirdRadarUploadResponse =
  | { ok: true; repoPath: string; steps?: BirdRadarUploadStep[] }
  | { ok: false; error: string; detail?: string; steps?: BirdRadarUploadStep[] };

export async function uploadBirdRadarCaptureCsv(opts: {
  fileName: string;
  blob?: Blob | null;
  onStatus?: (line: string) => void;
}): Promise<BirdRadarUploadResponse> {
  opts.onStatus?.("正在上传到数据管理…");

  // 优先：stop 后仅传文件名，由 CustomBackend 读本地 CSV 上传 DataLink
  let res: Response;
  try {
    res = await fetch(`${backendBase()}/api/bird-radar-capture/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: opts.fileName }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 若后端无此文件且提供了 blob，fallback multipart
  if (!res.ok && opts.blob && opts.blob.size > 0) {
    opts.onStatus?.("本地文件不可用，改用 multipart 上传…");
    const form = new FormData();
    form.append("file", opts.blob, opts.fileName);
    form.append("fileName", opts.fileName);
    try {
      res = await fetch(`${backendBase()}/api/bird-radar-capture/upload`, { method: "POST", body: form });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    repoPath?: string;
    repo_path?: string;
    steps?: BirdRadarUploadStep[];
  };

  if (Array.isArray(data.steps)) {
    for (const s of data.steps) {
      if (s?.status) opts.onStatus?.(s.status);
    }
  }

  const repoPath = data.repoPath ?? data.repo_path ?? "";
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : res.statusText || "上传失败",
      detail: typeof data.detail === "string" ? data.detail : undefined,
      steps: data.steps,
    };
  }

  return { ok: true, repoPath, steps: data.steps };
}

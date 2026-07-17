/**
 * 与 Qt `FileUploadClient::uploadFileToBranchAndMerge` 对齐的服务端上传流程。
 */

export type EoCollectUploadType =
  | "红外地对海"
  | "红外地对空"
  | "可见光地对海"
  | "可见光地对空"
  | "可见光空对海"
  | "红外空对海"
  | "可见光空对空"
  | "红外空对空";

export type EoCollectDataType = "原始数据" | "预处理数据";

export type EoCollectUploadStep = { status: string };

export type EoCollectUploadResult =
  | { ok: true; repoPath: string; steps: EoCollectUploadStep[] }
  | { ok: false; error: string; steps: EoCollectUploadStep[] };

const PROJECT_IDS: Record<EoCollectUploadType, string> = {
  红外地对海: "e99f0866-fc80-4cc7-9aaf-911227123343",
  红外地对空: "a7d48509-82e9-4959-a0b4-b8df9527c91d",
  可见光地对海: "0b53c7cf-b9c1-498b-99d0-39f2b73fe37d",
  可见光地对空: "fcf78da2-ecf6-464a-9996-8b9a3ae6ca9b",
  可见光空对海: "071dcb01-b8a8-4034-bddc-a4c97277d3b2",
  红外空对海: "071dcb01-b8a8-4034-bddc-a4c97277d3b2",
  可见光空对空: "fcf78da2-ecf6-464a-9996-8b9a3ae6ca9b",
  红外空对空: "a7d48509-82e9-4959-a0b4-b8df9527c91d",
};

function loadUploadConfig() {
  const baseUrl = (process.env.EO_CAPTURE_UPLOAD_BASE_URL ?? "http://192.168.18.103:21918").replace(/\/$/, "");
  const username = process.env.EO_CAPTURE_UPLOAD_USERNAME ?? "lp";
  const password = process.env.EO_CAPTURE_UPLOAD_PASSWORD ?? "casia123";
  return { baseUrl, username, password };
}

function extFromFileName(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : "";
}

function contentTypeForFileName(fileName: string): string {
  const ext = extFromFileName(fileName);
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "avi") return "video/x-msvideo";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatRepoTimestamp(d: Date): string {
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

/** 与 Qt `FileUploadClient::generateRepoPath` 一致 */
export function generateEoCollectRepoPath(
  fileName: string,
  uploadType: EoCollectUploadType,
  dataType: EoCollectDataType,
  now = new Date(),
): string {
  const ext = extFromFileName(fileName);
  const newFileName = ext ? `${formatRepoTimestamp(now)}.${ext}` : formatRepoTimestamp(now);
  const day = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const folderName = uploadType.includes("空对") ? `显控采集_无人机${day}` : `显控采集${day}`;
  return `${dataType}/${folderName}/${newFileName}`;
}

async function httpJson(
  url: string,
  init: RequestInit & { token?: string },
): Promise<{ status: number; body: string }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  return { status: res.status, body: await res.text() };
}

export async function uploadEoCaptureCollectFile(opts: {
  fileBytes: Buffer;
  fileName: string;
  uploadType: EoCollectUploadType;
  dataType: EoCollectDataType;
}): Promise<EoCollectUploadResult> {
  const steps: EoCollectUploadStep[] = [];
  const push = (status: string) => steps.push({ status });

  const { baseUrl, username, password } = loadUploadConfig();
  const projectId = PROJECT_IDS[opts.uploadType];
  if (!projectId) {
    return { ok: false, error: `未知上传类型：${opts.uploadType}`, steps };
  }

  push("开始上传流程…");

  let loginRes: { status: number; body: string };
  try {
    loginRes = await httpJson(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    return { ok: false, error: `登录请求失败：${e instanceof Error ? e.message : String(e)}`, steps };
  }

  if (loginRes.status !== 200) {
    return { ok: false, error: `登录失败 HTTP ${loginRes.status}${loginRes.body ? `：${loginRes.body.slice(0, 200)}` : ""}`, steps };
  }

  let token = "";
  try {
    token = (JSON.parse(loginRes.body) as { access_token?: string }).access_token ?? "";
  } catch {
    return { ok: false, error: "登录响应解析失败", steps };
  }
  if (!token) return { ok: false, error: "登录未返回 access_token", steps };
  push("登录成功");

  const branchName = "lp";
  const repoPath = generateEoCollectRepoPath(opts.fileName, opts.uploadType, opts.dataType);
  const contentType = contentTypeForFileName(opts.fileName);

  push("初始化上传…");
  let initRes: { status: number; body: string };
  try {
    initRes = await httpJson(`${baseUrl}/api/v1/projects/${projectId}/files/batch-init-upload`, {
      method: "POST",
      token,
      body: JSON.stringify({
        files: [{ path: repoPath, file_size: opts.fileBytes.length, content_type: contentType }],
        branch: branchName,
      }),
    });
  } catch (e) {
    return { ok: false, error: `初始化上传失败：${e instanceof Error ? e.message : String(e)}`, steps };
  }

  if (initRes.status !== 200) {
    return {
      ok: false,
      error: `初始化上传失败 HTTP ${initRes.status}${initRes.body ? `：${initRes.body.slice(0, 200)}` : ""}`,
      steps,
    };
  }

  let presignedUrl = "";
  try {
    const parsed = JSON.parse(initRes.body) as { uploads?: Array<{ presigned_url?: string }> };
    presignedUrl = parsed.uploads?.[0]?.presigned_url ?? "";
  } catch {
    return { ok: false, error: "初始化上传响应解析失败", steps };
  }
  if (!presignedUrl) return { ok: false, error: "未获取 presigned_url", steps };
  push("初始化上传成功");

  push("上传文件内容…");
  let putRes: Response;
  try {
    putRes = await fetch(presignedUrl, {
      method: "PUT",
      body: new Uint8Array(opts.fileBytes),
      headers: { "Content-Type": contentType },
    });
  } catch (e) {
    return { ok: false, error: `PUT 上传失败：${e instanceof Error ? e.message : String(e)}`, steps };
  }
  if (!putRes.ok) {
    return { ok: false, error: `PUT 上传失败 HTTP ${putRes.status}`, steps };
  }
  push("文件上传成功");

  push("完成上传通知…");
  let completeRes: { status: number; body: string };
  try {
    completeRes = await httpJson(`${baseUrl}/api/v1/projects/${projectId}/files/batch-complete-upload`, {
      method: "POST",
      token,
      body: JSON.stringify({ file_paths: [repoPath], branch: branchName }),
    });
  } catch (e) {
    return { ok: false, error: `完成上传通知失败：${e instanceof Error ? e.message : String(e)}`, steps };
  }
  if (completeRes.status !== 200) {
    return {
      ok: false,
      error: `完成上传失败 HTTP ${completeRes.status}${completeRes.body ? `：${completeRes.body.slice(0, 200)}` : ""}`,
      steps,
    };
  }
  push("完成上传通知成功");

  const commitMessage = `上传视频文件: ${opts.fileName}, 类型: ${opts.uploadType}`;
  push("提交变更…");
  let commitRes: Response;
  try {
    commitRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/branches/${encodeURIComponent(branchName)}/commit?message=${encodeURIComponent(commitMessage)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e) {
    return { ok: false, error: `提交变更失败：${e instanceof Error ? e.message : String(e)}`, steps };
  }
  if (commitRes.status !== 200 && commitRes.status !== 201) {
    return { ok: false, error: `提交变更失败 HTTP ${commitRes.status}`, steps };
  }
  push(`提交变更成功: ${commitMessage}`);

  const mergeMessage = `合并上传: ${opts.fileName}`;
  push("合并分支到 main…");
  let mergeRes: { status: number; body: string };
  try {
    mergeRes = await httpJson(
      `${baseUrl}/api/v1/projects/${projectId}/branches/${encodeURIComponent(branchName)}/merge`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ target_branch: "main", message: mergeMessage }),
      },
    );
  } catch (e) {
    return { ok: false, error: `合并分支失败：${e instanceof Error ? e.message : String(e)}`, steps };
  }
  if (mergeRes.status !== 200 && mergeRes.status !== 201) {
    return {
      ok: false,
      error: `合并分支失败 HTTP ${mergeRes.status}${mergeRes.body ? `：${mergeRes.body.slice(0, 200)}` : ""}`,
      steps,
    };
  }
  push("上传完成！");

  return { ok: true, repoPath, steps };
}

export function isEoCollectUploadType(v: string): v is EoCollectUploadType {
  return v in PROJECT_IDS;
}

/**
 * DataLink 探鸟雷达 CSV 上传。
 * 项目默认 e887a1df…；仓库路径：原始数据/{YYYYMMDD}/{filename}.csv
 * （batch-init-upload；专用 bird-radar-csv 接口会写死到 原始数据/探鸟雷达/）
 */

export type BirdRadarUploadStep = { status: string };

export type BirdRadarUploadResult =
  | { ok: true; repoPath: string; steps: BirdRadarUploadStep[] }
  | { ok: false; error: string; detail?: string; steps: BirdRadarUploadStep[] };

const DEFAULT_PROJECT_ID = "e887a1df-6891-4ac5-af74-b8f271bc1312";

function loadConfig() {
  return {
    baseUrl: (
      process.env.BIRD_RADAR_DATALINK_BASE_URL ??
      process.env.EO_CAPTURE_UPLOAD_BASE_URL ??
      "http://192.168.18.103:21918"
    ).replace(/\/$/, ""),
    username:
      process.env.BIRD_RADAR_DATALINK_USERNAME ??
      process.env.EO_CAPTURE_UPLOAD_USERNAME ??
      "lp",
    password:
      process.env.BIRD_RADAR_DATALINK_PASSWORD ?? process.env.EO_CAPTURE_UPLOAD_PASSWORD ?? "",
    projectId: process.env.BIRD_RADAR_DATALINK_PROJECT_ID ?? DEFAULT_PROJECT_ID,
    branch: process.env.BIRD_RADAR_DATALINK_BRANCH ?? "main",
  };
}

function safeCsvName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
  const base = cleaned || "radar_upload.csv";
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}

/** 原始数据/{YYYYMMDD}/{filename}.csv */
export function buildBirdRadarRepoPath(fileName: string, now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `原始数据/${y}${m}${d}/${safeCsvName(fileName)}`;
}

async function httpJson(url: string, init: RequestInit & { token?: string }) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  return { status: res.status, body: await res.text() };
}

export async function uploadBirdRadarCsvFile(opts: {
  fileBytes: Buffer;
  fileName: string;
}): Promise<BirdRadarUploadResult> {
  const steps: BirdRadarUploadStep[] = [];
  const push = (status: string) => steps.push({ status });
  const { baseUrl, username, password, projectId, branch } = loadConfig();

  if (!password) {
    return {
      ok: false,
      error: "未配置密码（EO_CAPTURE_UPLOAD_PASSWORD 或 BIRD_RADAR_DATALINK_PASSWORD）",
      steps,
    };
  }

  const uploadName = safeCsvName(opts.fileName);
  const repoPath = buildBirdRadarRepoPath(uploadName);

  push("登录 DataLink…");
  const login = await httpJson(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (login.status !== 200) {
    return { ok: false, error: `登录失败 HTTP ${login.status}`, detail: login.body.slice(0, 200), steps };
  }
  let token = "";
  try {
    token = (JSON.parse(login.body) as { access_token?: string }).access_token ?? "";
  } catch {
    return { ok: false, error: "登录响应解析失败", steps };
  }
  if (!token) return { ok: false, error: "登录未返回 access_token", steps };
  push("登录成功");

  push(`初始化上传… → ${repoPath}`);
  const init = await httpJson(`${baseUrl}/api/v1/projects/${projectId}/files/batch-init-upload`, {
    method: "POST",
    token,
    body: JSON.stringify({
      files: [
        {
          path: repoPath,
          file_size: opts.fileBytes.length,
          content_type: "text/csv",
        },
      ],
      branch,
    }),
  });
  if (init.status !== 200) {
    return { ok: false, error: `初始化失败 HTTP ${init.status}`, detail: init.body.slice(0, 200), steps };
  }

  let presignedUrl = "";
  let uploadId = "";
  let branchName = branch;
  try {
    const parsed = JSON.parse(init.body) as {
      uploads?: Array<{
        presigned_url?: string;
        upload_id?: string;
        branch_name?: string;
      }>;
      branch_name?: string;
    };
    const first = parsed.uploads?.[0] ?? {};
    presignedUrl = first.presigned_url ?? "";
    uploadId = first.upload_id ?? "";
    branchName = parsed.branch_name ?? first.branch_name ?? branch;
  } catch {
    return { ok: false, error: "初始化响应解析失败", steps };
  }
  if (!presignedUrl) {
    return { ok: false, error: "初始化响应缺少 presigned_url", steps };
  }
  push("初始化成功");

  push("PUT CSV 内容…");
  const put = await fetch(presignedUrl, {
    method: "PUT",
    body: new Uint8Array(opts.fileBytes),
    headers: {
      "Content-Type": "text/csv",
      "Content-Length": String(opts.fileBytes.length),
    },
  });
  if (!put.ok) {
    return { ok: false, error: `PUT 失败 HTTP ${put.status}`, steps };
  }
  push("PUT 成功");

  push("通知上传完成…");
  let complete = await httpJson(`${baseUrl}/api/v1/projects/${projectId}/files/batch-complete-upload`, {
    method: "POST",
    token,
    body: JSON.stringify({ file_paths: [repoPath], branch: branchName }),
  });
  if (complete.status !== 200 && uploadId) {
    complete = await httpJson(`${baseUrl}/api/v1/projects/${projectId}/files/complete-upload`, {
      method: "POST",
      token,
      body: JSON.stringify({ upload_id: uploadId, file_path: repoPath, branch: branchName }),
    });
  }
  if (complete.status !== 200) {
    return {
      ok: false,
      error: `complete-upload 失败 HTTP ${complete.status}`,
      detail: complete.body.slice(0, 200),
      steps,
    };
  }
  push("complete-upload 成功");

  const commitMessage = `上传探鸟雷达 CSV: ${repoPath}`;
  push("提交版本…");
  const commit = await fetch(
    `${baseUrl}/api/v1/projects/${projectId}/branches/${encodeURIComponent(branchName)}/commit?message=${encodeURIComponent(commitMessage)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!commit.ok) {
    return { ok: false, error: `commit 失败 HTTP ${commit.status}`, steps };
  }
  push("上传完成");

  return { ok: true, repoPath, steps };
}

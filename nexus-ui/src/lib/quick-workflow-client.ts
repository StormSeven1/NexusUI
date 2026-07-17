/**
 * 由 `quickWorkflowUrl`（…/quick-workflow）推导终止 URL，与 Qt
 * `http://{ip}:{port}/api/v1/chat/workflows/{threadId}/terminate` 一致。
 */
export function deriveQuickWorkflowTerminateUrl(quickWorkflowUrl: string, threadId: string): string {
  const base = quickWorkflowUrl.trim();
  if (!base) return "";
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return "";
  }
  const path = u.pathname.replace(/\/?$/, "");
  const termPath = path.endsWith("/quick-workflow")
    ? `${path.slice(0, -"/quick-workflow".length)}/workflows/${encodeURIComponent(threadId)}/terminate`
    : `${path}/workflows/${encodeURIComponent(threadId)}/terminate`;
  return `${u.origin}${termPath}`;
}

/** HTTPS 页面向 HTTP 任务管理 POST 时走 Next 同源 BFF，避免 Mixed Content */
export function shouldProxyQuickWorkflowHttp(upstreamUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  try {
    return new URL(upstreamUrl).protocol === "http:";
  } catch {
    return false;
  }
}

function sameOriginQuickWorkflowBase(): string {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${bp}/api/quick-workflow`;
}

/** 停止日常查证 BFF（查工作流 history + terminate，不依赖本地 threadId） */
export function resolveQuickWorkflowStopDailyUrl(): string {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${bp}/api/quick-workflow/stop-daily`;
}

/** 查询 auto_duty_workflow 是否在运行（不含助手区域航迹/搜索查证） */
export function resolveQuickWorkflowDailyActiveUrl(): string {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${bp}/api/quick-workflow/daily-active`;
}

/** 启动快捷/日常查证工作流 POST URL */
export function resolveQuickWorkflowPostUrl(upstreamUrl: string): string {
  const base = upstreamUrl.trim();
  if (!base) return "";
  if (shouldProxyQuickWorkflowHttp(base)) return sameOriginQuickWorkflowBase();
  return base;
}

/** 终止工作流 POST URL 与 body */
export function resolveQuickWorkflowTerminateRequest(
  upstreamUrl: string,
  threadId: string,
): { url: string; body: string } {
  const tid = threadId.trim();
  if (shouldProxyQuickWorkflowHttp(upstreamUrl)) {
    return {
      url: `${sameOriginQuickWorkflowBase()}/terminate`,
      body: JSON.stringify({ threadId: tid }),
    };
  }
  return {
    url: deriveQuickWorkflowTerminateUrl(upstreamUrl, tid),
    body: "{}",
  };
}

/** 助手工作流会话：经 BFF 终止业务工作流 */
export function resolveWorkflowTerminateBffUrl(): string {
  return `${sameOriginQuickWorkflowBase()}/terminate`;
}

/** 助手工作流会话：经 BFF 停止探鸟采集（工作流仍会走到上传确认） */
export function resolveWorkflowStopCaptureBffUrl(): string {
  return `${sameOriginQuickWorkflowBase()}/stop-capture`;
}

export async function postWorkflowTerminate(threadId: string): Promise<{
  ok: boolean;
  error?: string;
  detail?: string;
}> {
  const tid = threadId.trim();
  if (!tid) return { ok: false, error: "缺少业务工作流 ID" };
  try {
    const res = await fetch(resolveWorkflowTerminateBffUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: tid }),
      cache: "no-store",
    });
    const raw = await res.text().catch(() => "");
    let json: { error?: string; detail?: string } = {};
    try {
      json = raw ? (JSON.parse(raw) as typeof json) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      return {
        ok: false,
        error: json.error || `HTTP ${res.status}`,
        detail: json.detail || raw.slice(0, 400),
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postWorkflowStopCapture(threadId: string): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
  detail?: string;
}> {
  const tid = threadId.trim();
  if (!tid) return { ok: false, error: "缺少业务工作流 ID" };
  try {
    const res = await fetch(resolveWorkflowStopCaptureBffUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: tid }),
      cache: "no-store",
    });
    const raw = await res.text().catch(() => "");
    let json: { error?: string; detail?: string; message?: string; ok?: boolean } = {};
    try {
      json = raw ? (JSON.parse(raw) as typeof json) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      return {
        ok: false,
        error: json.error || `HTTP ${res.status}`,
        detail: json.detail || raw.slice(0, 400),
      };
    }
    return {
      ok: true,
      message: typeof json.message === "string" ? json.message : "已发送停止采集信号",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

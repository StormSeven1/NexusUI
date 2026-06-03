/** 与 Qt Config.ini Basic/LangGraphIp + LangGraphPort 默认一致 */
export const DEFAULT_TASK_MANAGEMENT_ORIGIN = "http://192.168.18.103:8000";

function readTaskManagementUrlRaw(): string {
  return (
    process.env.NEXT_PUBLIC_NEXUS_TASK_MANAGEMENT_URL?.trim() ||
    process.env.NEXUS_TASK_MANAGEMENT_URL?.trim() ||
    ""
  );
}

/** 是否通过环境变量显式配置了任务管理根地址 */
export function isTaskManagementUrlConfigured(): boolean {
  return readTaskManagementUrlRaw().length > 0;
}

/**
 * 任务管理 HTTP 根地址（无尾斜杠），形如 `http://192.168.18.103:8000`。
 * 优先 `NEXT_PUBLIC_NEXUS_TASK_MANAGEMENT_URL` / `NEXUS_TASK_MANAGEMENT_URL`；
 * 否则回退 `LangGraphIp`+`LangGraphPort`（或 `LANGGRAPH_*`）；再否则代码默认。
 */
export function resolveTaskManagementOrigin(): string {
  const raw = readTaskManagementUrlRaw();
  if (raw) {
    try {
      const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      const u = new URL(withProto);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through to legacy keys */
    }
  }

  const ip =
    process.env.LangGraphIp?.trim() ||
    process.env.LANGGRAPH_IP?.trim() ||
    "";
  if (ip) {
    const portRaw =
      process.env.LangGraphPort?.trim() ||
      process.env.LANGGRAPH_PORT?.trim() ||
      "8000";
    const port = /^\d+$/.test(portRaw) ? portRaw : "8000";
    return `http://${ip}:${port}`;
  }

  return DEFAULT_TASK_MANAGEMENT_ORIGIN;
}

function httpOriginToWsOrigin(httpOrigin: string): string {
  if (httpOrigin.startsWith("https://")) return `wss://${httpOrigin.slice(8)}`;
  if (httpOrigin.startsWith("http://")) return `ws://${httpOrigin.slice(7)}`;
  return `ws://${httpOrigin}`;
}

export type TaskManagementHttpChatUrls = {
  disposalPlanWsUrl: string;
  disposalManualGeneratePlanUrl: string;
  disposalExecuteUrl: string;
  quickWorkflowUrl: string;
};

/** 由任务管理根地址推导 `http.chat` 中走 8000 同源的全部 URL 字段 */
export function buildHttpChatUrlsFromTaskManagementOrigin(
  origin?: string,
): TaskManagementHttpChatUrls {
  const base = (origin ?? resolveTaskManagementOrigin()).replace(/\/$/, "");
  const ws = httpOriginToWsOrigin(base);
  return {
    disposalPlanWsUrl: `${ws}/api/v1/ws/workflow-stream`,
    disposalManualGeneratePlanUrl: `${base}/api/v1/tasks/target-engagement/manual-generate-plan`,
    disposalExecuteUrl: `${base}/api/v1/tasks/grpc-disposal/execute`,
    quickWorkflowUrl: `${base}/api/v1/chat/quick-workflow`,
  };
}

/** 环境变量配置了任务管理地址时，覆盖 `app-config.json` 中同源 URL */
export function overlayHttpChatFromTaskManagementEnv<T extends TaskManagementHttpChatUrls>(chat: T): T {
  if (!isTaskManagementUrlConfigured()) return chat;
  return { ...chat, ...buildHttpChatUrlsFromTaskManagementOrigin() };
}

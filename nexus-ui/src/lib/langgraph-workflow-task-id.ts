/**
 * 从 LangGraph SSE 事件 JSON 中递归提取 taskID / task_id 字段，用于工作流会话与查证 SSE 路由。
 */

function collectTaskIdsFromValue(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    const t = value.trim();
    if (t.length >= 4) out.add(t);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTaskIdsFromValue(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    const key = k.toLowerCase();
    if (key === "taskid" || key === "task_id" || key === "parenttaskid" || key === "parent_task_id") {
      if (typeof v === "string" && v.trim()) out.add(v.trim());
      else if (typeof v === "number" && Number.isFinite(v)) out.add(String(v));
    }
    collectTaskIdsFromValue(v, out, depth + 1);
  }
}

/** 从单条 LangGraph SSE 解析结果中提取可能的业务 taskId 列表 */
export function extractLangGraphTaskIds(parsed: Record<string, unknown>): string[] {
  const out = new Set<string>();
  collectTaskIdsFromValue(parsed, out, 0);
  return [...out];
}

/** 是否为 tool_call 响应（含 data.matched_command，与 Qt finished 信号对齐） */
export function isLangGraphToolCallEvent(parsed: Record<string, unknown>): boolean {
  const ev = String(parsed.event ?? "").toLowerCase();
  if (ev === "tool_call") return true;
  const data = parsed.data;
  if (data && typeof data === "object") {
    const cmd = (data as Record<string, unknown>).matched_command;
    if (typeof cmd === "string" && cmd.trim()) return true;
  }
  return false;
}

/** 是否为工作流类事件（非 tool_call 的任务流） */
export function isLangGraphWorkflowEvent(parsed: Record<string, unknown>): boolean {
  if (isLangGraphToolCallEvent(parsed)) return false;
  const ev = String(parsed.event ?? "").toLowerCase();
  if (ev === "workflow_update" || ev === "interrupt") return true;
  if (ev === "workflow_start" || ev === "workflow_started") return true;
  if (ev === "chat_notification") return true;
  const data = parsed.data;
  if (data && typeof data === "object") {
    const st = String((data as Record<string, unknown>).status ?? "").toLowerCase();
    if (
      st === "workflow_started" ||
      st === "workflow_running" ||
      st === "workflow_completed" ||
      st.startsWith("workflow_")
    ) {
      return true;
    }
  }
  return false;
}

function readChatNotificationDetails(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const ev = String(parsed.event ?? "").toLowerCase();
  if (ev !== "chat_notification") return null;
  const data = parsed.data;
  if (!data || typeof data !== "object") return null;
  const details = (data as Record<string, unknown>).details;
  if (!details || typeof details !== "object") return null;
  return details as Record<string, unknown>;
}

/**
 * chat_notification 事件：data.details.thread_id 与相机管理上报 parentTaskId 一致，
 * 用于查证 SSE 路由到对应工作流会话。
 */
export function extractChatNotificationThreadId(parsed: Record<string, unknown>): string | null {
  const details = readChatNotificationDetails(parsed);
  if (!details) return null;
  const tid = details.thread_id;
  if (typeof tid === "string" && tid.trim()) return tid.trim();
  return null;
}

/**
 * chat_notification 事件：data.details.alert_area 为区域中文名，与 `area_table.area_name` 对齐。
 */
export function extractChatNotificationAlertArea(parsed: Record<string, unknown>): string | null {
  const details = readChatNotificationDetails(parsed);
  if (!details) return null;
  const area = details.alert_area;
  if (typeof area === "string" && area.trim()) return area.trim();
  return null;
}

function pickWorkflowNameField(
  o: Record<string, unknown>,
  opts?: { allowGenericName?: boolean },
): string | null {
  for (const key of [
    "workflow_name",
    "workflowName",
    "business_workflow_name",
    "display_name",
  ]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (opts?.allowGenericName) {
    const v = o.name;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * 从 workflow / chat_notification 事件提取工作流名称（含「探鸟雷达」等中文名或 tanniao_radar_*）。
 */
export function extractLangGraphWorkflowName(parsed: Record<string, unknown>): string | null {
  const details = readChatNotificationDetails(parsed);
  if (details) {
    const fromDetails = pickWorkflowNameField(details, { allowGenericName: true });
    if (fromDetails) return fromDetails;
  }
  const data = parsed.data;
  if (data && typeof data === "object") {
    const fromData = pickWorkflowNameField(data as Record<string, unknown>);
    if (fromData) return fromData;
  }
  return pickWorkflowNameField(parsed);
}

/** 是否探鸟雷达采集工作流（按名称「探鸟雷达」匹配，兼兼容 thread/内部名） */
export function isBirdRadarAcquisitionWorkflow(meta: {
  workflowName?: string | null;
  businessWorkflowThreadId?: string | null;
  title?: string | null;
  hintText?: string | null;
}): boolean {
  const parts = [
    meta.workflowName,
    meta.businessWorkflowThreadId,
    meta.title,
    meta.hintText,
  ]
    .map((x) => (typeof x === "string" ? x : ""))
    .join("\n");
  if (parts.includes("探鸟雷达")) return true;
  if (/tanniao_radar/i.test(parts)) return true;
  return false;
}

/**
 * 是否应新建工作流「会话N」Tab。
 * 注意：普通流式文本 / thread_id 不算工作流；toolcall 可能在 workflow_update 之后才到。
 */
export function shouldRouteToWorkflowSessionTab(parsed: Record<string, unknown>): boolean {
  return isLangGraphWorkflowEvent(parsed);
}

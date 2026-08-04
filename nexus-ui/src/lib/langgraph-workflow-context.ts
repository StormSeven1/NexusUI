/**
 * 工作流会话上下文：名称（message_chunk.extracted_topic）与设备 ID（chat_notification）。
 * 见仓库根目录 `获取工作流名称和设备ID.md`。
 */

export type WorkflowDeviceKind = "camera" | "uav";

export type WorkflowDeviceCard = {
  id: string;
  kind: WorkflowDeviceKind;
  /** 卡片副文案，如「任务执行中」「准备起飞」 */
  statusLabel: string;
};

/** message_chunk → data.output.extracted_topic */
export function extractWorkflowTopicFromMessageChunk(
  parsed: Record<string, unknown>,
): string | null {
  if (String(parsed.event ?? "") !== "message_chunk") return null;
  const data = parsed.data;
  if (!data || typeof data !== "object") return null;
  const output = (data as Record<string, unknown>).output;
  if (!output || typeof output !== "object") return null;
  const topic = (output as Record<string, unknown>).extracted_topic;
  if (typeof topic !== "string" || !topic.trim()) return null;
  return topic.trim();
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : x != null ? String(x).trim() : ""))
    .filter(Boolean);
}

/**
 * chat_notification：
 * - node_name=dispatch_camera_task → metadata.camera_list
 * - node_name=select_uav → metadata.uav_entity_id_list
 */
export function extractWorkflowDevicesFromChatNotification(
  parsed: Record<string, unknown>,
): WorkflowDeviceCard[] {
  if (String(parsed.event ?? "") !== "chat_notification") return [];
  const data = parsed.data;
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const nodeName = typeof d.node_name === "string" ? d.node_name.trim() : "";

  const cn =
    d.chat_notification && typeof d.chat_notification === "object"
      ? (d.chat_notification as Record<string, unknown>)
      : null;
  const meta =
    cn?.metadata && typeof cn.metadata === "object"
      ? (cn.metadata as Record<string, unknown>)
      : null;
  const details =
    d.details && typeof d.details === "object" && !Array.isArray(d.details)
      ? (d.details as Record<string, unknown>)
      : null;

  const out: WorkflowDeviceCard[] = [];

  if (nodeName === "dispatch_camera_task") {
    let list = asStringList(meta?.camera_list);
    if (list.length === 0) list = asStringList(details?.camera_list);
    if (
      list.length === 0 &&
      meta?.camera_assignments &&
      typeof meta.camera_assignments === "object" &&
      !Array.isArray(meta.camera_assignments)
    ) {
      list = Object.keys(meta.camera_assignments as Record<string, unknown>);
    }
    for (const id of list) {
      out.push({ id, kind: "camera", statusLabel: "任务执行中" });
    }
  }

  if (nodeName === "select_uav") {
    let list = asStringList(meta?.uav_entity_id_list);
    if (list.length === 0) list = asStringList(details?.uav_entity_id_list);
    for (const id of list) {
      out.push({ id, kind: "uav", statusLabel: "准备起飞" });
    }
  }

  return out;
}

/** 会话标题：extracted_topic → 「区域航迹查证任务」 */
export function formatWorkflowSessionTitle(topic: string): string {
  const t = topic.trim();
  if (!t) return t;
  if (/任务$/.test(t)) return t;
  return `${t}任务`;
}

/**
 * 从中断文案中的参数 JSON 提取中文工作流名（如 `"工作流": "区域航迹查证"`）。
 * 知识库启动确认常把参数嵌在 message 里，未必再发 extracted_topic。
 */
export function extractWorkflowTopicFromInterruptText(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const tryObj = (o: Record<string, unknown>): string | null => {
    for (const key of ["工作流", "workflow", "display_name", "displayName", "workflow_display_name"]) {
      const v = o[key];
      if (typeof v !== "string" || !v.trim()) continue;
      const s = v.trim();
      // 优先中文显示名；跳过纯 snake_case 内部名
      if (/[\u4e00-\u9fff]/.test(s)) return s;
    }
    return null;
  };

  // 整段即 JSON
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        const hit = tryObj(o as Record<string, unknown>);
        if (hit) return hit;
      }
    } catch {
      /* fall through */
    }
  }

  // 文案中夹带 JSON 块
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        const hit = tryObj(o as Record<string, unknown>);
        if (hit) return hit;
      }
    } catch {
      /* fall through */
    }
  }

  const m = raw.match(/["']?工作流["']?\s*[:：]\s*["']?([^\n"',}]+)/);
  if (m?.[1]?.trim()) return m[1].trim();
  return null;
}

/** 业务 thread_id 前缀 → 中文话题（无 extracted_topic 时的兜底） */
export function inferWorkflowTopicFromBusinessThreadId(threadId: string): string | null {
  const t = threadId.trim();
  if (!t) return null;
  if (/area_track_vertification/i.test(t)) return "区域航迹查证";
  if (/search_area|area_search/i.test(t)) return "区域搜索查证";
  if (/tanniao_radar/i.test(t)) return "探鸟雷达";
  if (/auto_duty/i.test(t)) return "日常查证";
  return null;
}

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

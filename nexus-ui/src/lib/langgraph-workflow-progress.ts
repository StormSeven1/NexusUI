/**
 * 工作流进度树：主节点用中文标题（chat_notification / workflow_update.message），
 * 不以英文 graph node（workflow_execution 等）作为展示名。
 */

export type WorkflowProgressNodeStatus = "running" | "done" | "failed";

export type WorkflowProgressNode = {
  id: string;
  title: string;
  status: WorkflowProgressNodeStatus;
  details: string[];
  /** 展示用东八区时间，如 22:25:12 */
  time?: string;
};

export type WorkflowProgressData = {
  nodes: WorkflowProgressNode[];
};

export type WorkflowProgressPart = {
  type: "data-workflow-progress";
  data: WorkflowProgressData;
};

export function isWorkflowProgressPart(part: unknown): part is WorkflowProgressPart {
  return (
    !!part &&
    typeof part === "object" &&
    (part as WorkflowProgressPart).type === "data-workflow-progress" &&
    !!(part as WorkflowProgressPart).data &&
    Array.isArray((part as WorkflowProgressPart).data.nodes)
  );
}

export function createWorkflowProgressPart(data: WorkflowProgressData): WorkflowProgressPart {
  return { type: "data-workflow-progress", data };
}

export type WorkflowProgressMeta = {
  nodeId: string;
  title: string;
  status: WorkflowProgressNodeStatus;
  details: string[];
  time?: string;
};

/** chat_notification.details 里不当作进度明细的元数据键 */
const DETAIL_META_KEYS = new Set([
  "thread_id",
  "alert_area",
  "workflow_name",
  "workflowName",
  "business_workflow_name",
  "display_name",
  "name",
  "acquisition_base",
  "title",
  "message",
  "time",
  "timestamp",
  "created_at",
  "updated_at",
]);

function hasCjk(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/** 英文 snake/camel 技术节点名（不宜作主标题） */
function isTechnicalNodeId(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (hasCjk(t)) return false;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(t)) return true;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return true;
  return false;
}

function normalizeStatus(raw: string): WorkflowProgressNodeStatus {
  const s = raw.trim().toLowerCase();
  if (!s) return "running";
  if (s === "failed" || s === "error" || s.endsWith("_failed") || s.includes("fail")) {
    return "failed";
  }
  if (
    s === "completed" ||
    s === "done" ||
    s === "success" ||
    s === "ok" ||
    s === "workflow_completed" ||
    s.endsWith("_completed") ||
    s.endsWith("_done")
  ) {
    return "done";
  }
  return "running";
}

function formatDetailValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function detailsFromRecord(rec: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (DETAIL_META_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    const rendered = formatDetailValue(v);
    if (!rendered) continue;
    out.push(`${k}:\n${rendered}`);
  }
  return out;
}

/** 纯钟点（无日期）——视为已是展示用时间，原样规范化 */
const CLOCK_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 统一按东八区显示 HH:mm:ss，避免 ISO 里 UTC 时钟被直接抠出来 */
function formatClockInShanghai(d: Date): string | undefined {
  if (Number.isNaN(d.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const second = parts.find((p) => p.type === "second")?.value;
    if (hour != null && minute != null) {
      return second != null ? `${hour}:${minute}:${second}` : `${hour}:${minute}`;
    }
  } catch {
    /* fall through */
  }
  // Intl 不可用时退回本地
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function tryParseTimestamp(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;

  // 仅 HH:mm[:ss] —— 不当日期解析
  if (CLOCK_ONLY_RE.test(t)) return null;

  // 常见：`2026-07-30 16:59:12` → ISO
  const normalized = t.includes("T") ? t : t.replace(" ", "T");

  // 有明确时区（Z / ±HH:MM）时按标准解析
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 无时区的 `YYYY-MM-DDTHH:mm:ss[.sss]`：
  // ES 会当「本地时间」。任务管理多在国内，naive 时间按东八区墙钟理解更稳：
  // 用 UTC 组分构造时先按 +08:00 解释，再交给 formatClockInShanghai。
  const m = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/,
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const s = Number(m[6] ?? "0");
    // Date.UTC(...) - 8h = 把「东八区墙钟」转成正确瞬时
    const d = new Date(Date.UTC(y, mo - 1, day, h - 8, mi, s));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickTime(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      const formatted = formatClockInShanghai(new Date(c < 1e12 ? c * 1000 : c));
      if (formatted) return formatted;
      continue;
    }
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (!t) continue;

    const clockOnly = t.match(CLOCK_ONLY_RE);
    if (clockOnly) {
      const h = pad2(Number(clockOnly[1]));
      const mi = clockOnly[2];
      const s = clockOnly[3] != null ? pad2(Number(clockOnly[3])) : undefined;
      return s != null ? `${h}:${mi}:${s}` : `${h}:${mi}`;
    }

    const parsed = tryParseTimestamp(t);
    if (parsed) {
      const formatted = formatClockInShanghai(parsed);
      if (formatted) return formatted;
    }
  }
  return undefined;
}

function splitTitleAndDetail(message: string): { title: string; detail: string | null } {
  const raw = message.trim();
  if (!raw) return { title: "", detail: null };
  const idx = raw.search(/[:：]/);
  if (idx > 0 && idx < raw.length - 1) {
    const title = raw.slice(0, idx).trim();
    const detail = raw.slice(idx + 1).trim();
    if (title && detail) return { title, detail };
  }
  return { title: raw, detail: null };
}

function pushUniqueDetail(details: string[], text: string) {
  const t = text.trim();
  if (!t) return;
  if (details[details.length - 1] === t) return;
  if (details.includes(t)) return;
  details.push(t);
}

/**
 * 从 workflow_update / chat_notification 提取进度元数据。
 * 主标题优先中文 message；英文 node 仅作内部 id，不作展示名。
 */
export function extractWorkflowProgressMeta(
  parsed: Record<string, unknown>,
): WorkflowProgressMeta | null {
  const ev = String(parsed.event ?? "").toLowerCase();
  const data = parsed.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (ev === "chat_notification") {
    const detailsObj =
      d.details && typeof d.details === "object" && !Array.isArray(d.details)
        ? (d.details as Record<string, unknown>)
        : null;
    const cnObj =
      d.chat_notification && typeof d.chat_notification === "object"
        ? (d.chat_notification as Record<string, unknown>)
        : null;

    const titleRaw =
      (typeof cnObj?.title === "string" && cnObj.title.trim()) ||
      (typeof d.message === "string" && d.message.trim()) ||
      (typeof d.title === "string" && d.title.trim()) ||
      (detailsObj && typeof detailsObj.title === "string" && detailsObj.title.trim()) ||
      (detailsObj && typeof detailsObj.message === "string" && detailsObj.message.trim()) ||
      "";

    if (!titleRaw || !hasCjk(titleRaw)) {
      // 仅有 thread_id 等元数据、无中文标题的通知不进进度树
      return null;
    }

    const { title, detail } = splitTitleAndDetail(titleRaw);
    const kvDetails = detailsObj ? detailsFromRecord(detailsObj) : [];
    // metadata 里的业务字段也进明细（排除已在 details 展示的）
    const meta =
      cnObj?.metadata && typeof cnObj.metadata === "object"
        ? (cnObj.metadata as Record<string, unknown>)
        : null;
    const metaDetails = meta ? detailsFromRecord(meta) : [];
    const details: string[] = [];
    if (detail) pushUniqueDetail(details, detail);
    for (const line of kvDetails) pushUniqueDetail(details, line);
    for (const line of metaDetails) pushUniqueDetail(details, line);

    const time = pickTime(
      d.time,
      d.timestamp,
      cnObj?.timestamp,
      detailsObj?.time,
      detailsObj?.timestamp,
    );
    const statusRaw =
      (typeof cnObj?.status === "string" && cnObj.status) ||
      (typeof d.status === "string" && d.status) ||
      "";
    // 通知类默认视为已完成步骤
    const status = statusRaw ? normalizeStatus(statusRaw) : "done";
    const nodeId = `notify:${title}${time ? `@${time}` : ""}`;

    return { nodeId, title, status, details, time };
  }

  if (ev === "workflow_update") {
    const nodeName = typeof d.node_name === "string" ? d.node_name.trim() : "";
    const node = typeof d.node === "string" ? d.node.trim() : "";
    const techId = node || nodeName;

    const msgRaw = typeof d.message === "string" ? d.message.trim() : "";
    const errRaw = typeof d.error === "string" ? d.error.trim() : "";
    const statusRaw = typeof d.status === "string" ? d.status : "";
    const status = normalizeStatus(statusRaw);

    // 有中文 message/error → 用作标题；英文 node 不当标题
    const displaySrc = errRaw || msgRaw;
    if (displaySrc && hasCjk(displaySrc)) {
      const { title, detail } = splitTitleAndDetail(displaySrc);
      const details: string[] = [];
      if (detail) pushUniqueDetail(details, detail);
      if (errRaw && msgRaw && errRaw !== msgRaw && hasCjk(msgRaw)) {
        pushUniqueDetail(details, msgRaw);
      }
      const nodeId = techId || `msg:${title}`;
      return {
        nodeId,
        title: errRaw && !msgRaw ? title : title,
        status: errRaw ? "failed" : status === "running" && !statusRaw ? "done" : status,
        details,
        time: pickTime(d.time, d.timestamp),
      };
    }

    // 仅有英文技术节点、无中文文案：不展示（避免 workflow_execution 等）
    if (techId && isTechnicalNodeId(techId) && !displaySrc) {
      return null;
    }

    // 无中文但也有可读 message（少见）
    if (displaySrc) {
      const { title, detail } = splitTitleAndDetail(displaySrc);
      return {
        nodeId: techId || `msg:${title}`,
        title,
        status: errRaw ? "failed" : status,
        details: detail ? [detail] : [],
        time: pickTime(d.time, d.timestamp),
      };
    }

    return null;
  }

  return null;
}

/** @deprecated 使用 extractWorkflowProgressMeta */
export function extractWorkflowUpdateProgressMeta(
  parsed: Record<string, unknown>,
): WorkflowProgressMeta | null {
  return extractWorkflowProgressMeta(parsed);
}

/**
 * 将一条进度事件归约进进度树。
 * 新主节点出现时，把上一 running 节点标为 done。
 */
export function applyWorkflowUpdateToProgress(
  prev: WorkflowProgressData | null | undefined,
  parsed: Record<string, unknown>,
): WorkflowProgressData | null {
  const meta = extractWorkflowProgressMeta(parsed);
  if (!meta) return prev ?? null;

  const nodes = prev?.nodes ? prev.nodes.map((n) => ({ ...n, details: [...n.details] })) : [];
  const idx = nodes.findIndex((n) => n.id === meta.nodeId);

  if (idx < 0) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].status === "running") {
        nodes[i] = { ...nodes[i], status: "done" };
        break;
      }
    }
    nodes.push({
      id: meta.nodeId,
      title: meta.title,
      status: meta.status,
      details: [...meta.details],
      time: meta.time,
    });
  } else {
    const cur = nodes[idx];
    const nextStatus: WorkflowProgressNodeStatus =
      meta.status === "failed" || meta.status === "done"
        ? meta.status
        : cur.status === "failed" || cur.status === "done"
          ? cur.status
          : meta.status;
    const details = [...cur.details];
    // 同一技术节点后续中文文案进明细，保留首次主标题（避免英文 node 下标题被刷掉）
    if (meta.title && meta.title !== cur.title) {
      pushUniqueDetail(details, meta.title);
    }
    for (const line of meta.details) pushUniqueDetail(details, line);
    nodes[idx] = {
      ...cur,
      title: cur.title,
      status: nextStatus,
      details,
      time: meta.time || cur.time,
    };
  }

  return { nodes };
}

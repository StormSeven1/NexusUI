/**
 * 系统告警 DTO ↔ AlertData，以及前端过滤常量。
 * 与 `server/system-alarm-grpc.ts` 的 JSON 形状对齐（BFF GET /api/system-alarms）。
 */

import type { AlertData } from "@/stores/alert-store";

export const SYSTEM_ALARM_SOURCE = "SystemAlarm" as const;

/** camServer 检测可疑目标：alarm_camera_detect_<entityId>，reserved3=track */
export const CAMERA_DETECT_ALARM_ID_PREFIX = "alarm_camera_detect_";

export type SystemAlarmKindCode =
  | "EQUIPMENT"
  | "DATA_COMM"
  | "TASK"
  | "ENVIRONMENT"
  | "COMPREHENSIVE"
  | "SYSTEM_AUTH";

export type SystemAlarmApiItem = {
  alarmId: string;
  systemId: string;
  description: string;
  timestampMs: number;
  raisedTimeMs: number;
  canceledTimeMs?: number;
  alarmKind: number;
  alarmKindCode: SystemAlarmKindCode | "";
  alarmKindLabel: string;
  entityId?: string;
  level: number;
  /** 相机告警：CamName（中文名称） */
  reserved1?: string;
  reserved2?: string;
  reserved3?: string;
};

/** 可多选的过滤类别（不含「全部」） */
export type AlertFilterKey =
  | "track"
  | "EQUIPMENT"
  | "DATA_COMM"
  | "TASK"
  | "ENVIRONMENT"
  | "COMPREHENSIVE"
  | "SYSTEM_AUTH";

export const ALERT_FILTER_OPTIONS: ReadonlyArray<{ key: AlertFilterKey; label: string }> = [
  { key: "track", label: "航迹" },
  { key: "EQUIPMENT", label: "装备状态" },
  { key: "DATA_COMM", label: "数据通信" },
  { key: "TASK", label: "任务" },
  { key: "ENVIRONMENT", label: "环境" },
  { key: "COMPREHENSIVE", label: "综合" },
  { key: "SYSTEM_AUTH", label: "系统权鉴" },
];

export const ALL_ALERT_FILTER_KEYS: readonly AlertFilterKey[] = ALERT_FILTER_OPTIONS.map(
  (o) => o.key,
);

/** 告警级别（与 AlertPanel SEVERITY_STYLES 一致） */
export type AlertSeverityFilterKey = "critical" | "warning" | "info";

export const ALERT_SEVERITY_FILTER_OPTIONS: ReadonlyArray<{
  key: AlertSeverityFilterKey;
  label: string;
}> = [
  { key: "critical", label: "严重" },
  { key: "warning", label: "警告" },
  { key: "info", label: "信息" },
];

export const ALL_ALERT_SEVERITY_KEYS: readonly AlertSeverityFilterKey[] =
  ALERT_SEVERITY_FILTER_OPTIONS.map((o) => o.key);

/** 对齐 nginx 尾号 / 告警设计文档的 system_id → 中文名 */
export const SYSTEM_ID_LABEL: Record<string, string> = {
  "sys-001": "融控",
  "sys-002": "作战管理",
  "sys-003": "实体管理",
  "sys-004": "任务管理",
  "sys-005": "相机管理",
  "sys-006": "无人机管理",
  "sys-007": "告警管理",
  "sys-008": "数据管理",
  "sys-009": "雷达管理",
  "sys-010": "航迹管理",
  "sys-011": "数据转发",
};

/** 系统名称筛选：航迹类无 systemId，用 track；系统告警用 sys-xxx */
export type AlertSystemFilterKey = "track" | keyof typeof SYSTEM_ID_LABEL;

export const ALERT_SYSTEM_FILTER_OPTIONS: ReadonlyArray<{
  key: AlertSystemFilterKey;
  label: string;
}> = [
  { key: "track", label: "航迹" },
  ...(Object.entries(SYSTEM_ID_LABEL) as Array<[keyof typeof SYSTEM_ID_LABEL, string]>).map(
    ([key, label]) => ({ key, label }),
  ),
];

export const ALL_ALERT_SYSTEM_FILTER_KEYS: readonly AlertSystemFilterKey[] =
  ALERT_SYSTEM_FILTER_OPTIONS.map((o) => o.key);

export function formatSystemIdLabel(systemId: string | undefined | null): string {
  const id = String(systemId ?? "").trim();
  if (!id) return "";
  return SYSTEM_ID_LABEL[id] ?? id;
}

/** 相机检测可疑目标（camServer SystemAlarm，前端归入航迹类） */
export function isCameraDetectTrackAlarm(alert: {
  id?: string;
  source?: string;
  reserved3?: string;
}): boolean {
  const id = String(alert.id ?? "").trim().toLowerCase();
  if (id.startsWith(CAMERA_DETECT_ALARM_ID_PREFIX)) return true;
  return (
    String(alert.reserved3 ?? "").trim().toLowerCase() === "track" &&
    String(alert.source ?? "") === SYSTEM_ALARM_SOURCE
  );
}

/** 告警归属的系统筛选键；未知 systemId 返回原字符串（仅「全部选中」时放行） */
export function alertSystemFilterKey(alert: AlertData): string {
  if (isCameraDetectTrackAlarm(alert)) return "track";
  if (isSystemAlarm(alert)) {
    const id = alert.systemId?.trim() ?? "";
    return id || "track";
  }
  return "track";
}

function levelToSeverity(level: number): AlertData["severity"] {
  if (level >= 2) return "critical";
  if (level === 1) return "warning";
  return "info";
}

function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function isSystemAlarm(alert: Pick<AlertData, "source">): boolean {
  return alert.source === SYSTEM_ALARM_SOURCE;
}

export function isTrackAlarm(alert: Pick<AlertData, "source" | "trackId" | "type" | "id">): boolean {
  if (isCameraDetectTrackAlarm(alert)) return true;
  if (isSystemAlarm(alert)) return false;
  return Boolean(alert.trackId?.trim());
}

export function alertCategoryKey(alert: AlertData): AlertFilterKey | null {
  if (isCameraDetectTrackAlarm(alert)) return "track";
  if (isSystemAlarm(alert)) {
    const k = alert.systemAlarmKind;
    if (
      k === "EQUIPMENT" ||
      k === "DATA_COMM" ||
      k === "TASK" ||
      k === "ENVIRONMENT" ||
      k === "COMPREHENSIVE" ||
      k === "SYSTEM_AUTH"
    ) {
      return k;
    }
    return null;
  }
  if (isTrackAlarm(alert)) return "track";
  return null;
}

export function systemAlarmToAlertData(item: SystemAlarmApiItem): AlertData {
  const raised = item.raisedTimeMs > 0 ? item.raisedTimeMs : item.timestampMs;
  // 列表时间用上报方最新消息时间；重复上报同 alarm_id 时会刷新
  const displayMs =
    item.timestampMs > 0 ? item.timestampMs : raised > 0 ? raised : Date.now();
  const isDetect =
    item.alarmId.trim().toLowerCase().startsWith(CAMERA_DETECT_ALARM_ID_PREFIX) ||
    item.reserved3?.trim().toLowerCase() === "track";
  const kindCode = item.alarmKindCode || undefined;
  const kindLabel = isDetect ? "航迹" : item.alarmKindLabel || "系统告警";
  const entity = item.entityId?.trim() ?? "";
  const cameraName = item.reserved1?.trim() ?? "";
  const systemLabel = formatSystemIdLabel(item.systemId);
  const entityPart = cameraName
    ? `相机 ${cameraName}`
    : entity
      ? `实体 ${entity}`
      : "";
  return {
    id: item.alarmId,
    // 检测框可疑目标：与目标结构航迹威胁同属「航迹」类，一律严重
    severity: isDetect ? "critical" : levelToSeverity(item.level),
    message: item.description || kindLabel,
    timestamp: formatTs(displayMs) || new Date(displayMs).toISOString(),
    type: kindLabel,
    alarmType: "alert",
    // 系统告警：用最新消息时间做「首次/排序」基准，便于重复上报后时间与置顶更新
    firstSeenTime: displayMs,
    lastUpdateTime: Date.now(),
    title: kindLabel,
    source: SYSTEM_ALARM_SOURCE,
    alarmLevel: isDetect ? 2 : item.level,
    detail: [systemLabel ? `系统 ${systemLabel}` : "", entityPart].filter(Boolean).join(" · "),
    content: item.description,
    // 检测告警不走装备状态筛选，避免与「航迹」分裂
    systemAlarmKind: isDetect ? undefined : (kindCode as AlertData["systemAlarmKind"]),
    systemId: item.systemId || undefined,
    entityId: entity || undefined,
    reserved3: item.reserved3?.trim() || undefined,
  };
}

/**
 * 当前活跃的相机检测可疑目标实体 ID（小写）。
 * 用于地图视场标红；无对应视场的相机仅有告警、不影响地图。
 */
export function collectCameraDetectAlarmEntityIds(
  alerts: ReadonlyArray<Pick<AlertData, "id" | "source" | "entityId" | "reserved3">>,
): Set<string> {
  const out = new Set<string>();
  for (const a of alerts) {
    if (!isCameraDetectTrackAlarm(a)) continue;
    const eid = String(a.entityId ?? "").trim().toLowerCase();
    if (eid) out.add(eid);
    const fromId = String(a.id ?? "").trim().toLowerCase();
    if (fromId.startsWith(CAMERA_DETECT_ALARM_ID_PREFIX)) {
      const rest = fromId.slice(CAMERA_DETECT_ALARM_ID_PREFIX.length).trim();
      if (rest) out.add(rest);
    }
  }
  return out;
}

/**
 * 多选过滤：类型 / 级别 / 系统任一为空 → 不显示；
 * 否则需同时满足已选条件。
 */
export function alertMatchesFilters(
  alert: AlertData,
  selected: ReadonlySet<AlertFilterKey>,
  selectedSeverities?: ReadonlySet<AlertSeverityFilterKey>,
  selectedSystems?: ReadonlySet<AlertSystemFilterKey>,
): boolean {
  if (selected.size === 0) return false;
  const key = alertCategoryKey(alert);
  if (!key || !selected.has(key)) return false;
  if (selectedSeverities) {
    if (selectedSeverities.size === 0) return false;
    const sev = (alert.severity in { critical: 1, warning: 1, info: 1 }
      ? alert.severity
      : "info") as AlertSeverityFilterKey;
    if (!selectedSeverities.has(sev)) return false;
  }
  if (selectedSystems) {
    if (selectedSystems.size === 0) return false;
    const sysKey = alertSystemFilterKey(alert);
    const known = ALL_ALERT_SYSTEM_FILTER_KEYS as readonly string[];
    if (known.includes(sysKey)) {
      if (!selectedSystems.has(sysKey as AlertSystemFilterKey)) return false;
    } else if (selectedSystems.size !== ALL_ALERT_SYSTEM_FILTER_KEYS.length) {
      // 未知 systemId：仅在系统筛选全选时显示
      return false;
    }
  }
  return true;
}

/** 最新在上：优先 firstSeenTime，其次 lastUpdateTime */
export function compareAlertNewestFirst(a: AlertData, b: AlertData): number {
  const ta = a.firstSeenTime ?? a.lastUpdateTime ?? 0;
  const tb = b.firstSeenTime ?? b.lastUpdateTime ?? 0;
  return tb - ta;
}

/** 告警中心列表：严重始终最上，同级再按最新在上 */
const ALERT_CENTER_SEVERITY_RANK: Record<AlertData["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function compareAlertForAlarmCenter(a: AlertData, b: AlertData): number {
  const sa =
    a.severity in ALERT_CENTER_SEVERITY_RANK
      ? ALERT_CENTER_SEVERITY_RANK[a.severity]
      : ALERT_CENTER_SEVERITY_RANK.info;
  const sb =
    b.severity in ALERT_CENTER_SEVERITY_RANK
      ? ALERT_CENTER_SEVERITY_RANK[b.severity]
      : ALERT_CENTER_SEVERITY_RANK.info;
  if (sa !== sb) return sa - sb;
  return compareAlertNewestFirst(a, b);
}

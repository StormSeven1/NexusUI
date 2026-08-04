import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import { pickTaskStatusImageUrl } from "@/lib/task-status-chat-format";
import { isPathishObjectKeyFragment } from "@/lib/task-status-pathish";
import { enrichTaskStatusPayloadForVerifyUi } from "@/lib/task-status-track-enrich";
export type VerifyEnvironmentFields = {
  weather?: string;
  wave?: string;
  seaState?: string;
  visibility?: string;
};

export type VerifyTargetFields = {
  /** 目标名称（允许空字符串） */
  name?: string;
  size?: string;
  clarity?: string;
  type?: string;
  color?: string;
  behavior?: string;
};

/** 智能助手查证卡片视图模型（对齐设计图三框布局） */
export type VerifyReportViewModel = {
  entityKind: "camera" | "uav";
  trackId?: number;
  entityId?: string;
  longitudeDeg?: number;
  latitudeDeg?: number;
  distanceNm?: number;
  azimuthDegrees?: number;
  speedMps?: number;
  shipArchiveInfo?: string;
  imageUrl?: string;
  imageMediaType?: string;
  imageFileName?: string;
  /** taskStatus=4 时尚未完成大模型研判 */
  analyzing?: boolean;
  environment?: VerifyEnvironmentFields;
  target?: VerifyTargetFields;
  /** 研判依据 */
  judgmentBasis?: string;
  /** 特征目标 */
  featureTarget?: string;
  /** 找到目标：1/0 */
  targetFound?: number;
  /** taskStatus=8：知识库来访记录正文 */
  visitHistory?: string;
};

export type TaskVerifyReportPart = {
  type: "data-task-verify-report";
  data: VerifyReportViewModel;
};

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** 字段存在时保留空字符串（如 目标名称: ""） */
function pickFieldExact(obj: Record<string, unknown>, key: string): string | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    if (!(k in obj)) continue;
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "1" || t === "0") return Number(t);
    }
  }
  return undefined;
}

export function isPathishVerifyDisplayText(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return isPathishObjectKeyFragment(t) || /^[\d/.\-_]+$/.test(t);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * watch-sys-camera `ptz_widget` / `updateDescription` 上报的扁平 JSON 字段（journal 实测）。
 *
 * 环境：天气、波浪类型、海况等级、能见度
 * 目标：目标名称、目标尺寸、目标清晰度、目标类型、目标颜色、目标行为
 * 摘要：研判依据（兼容 说明）
 */
function mapEnvironment(obj: Record<string, unknown>): VerifyEnvironmentFields {
  return {
    weather: pickStr(obj, ["天气"]),
    wave: pickStr(obj, ["波浪类型"]),
    seaState: pickStr(obj, ["海况等级"]),
    visibility: pickStr(obj, ["能见度"]),
  };
}

function mapTarget(obj: Record<string, unknown>): VerifyTargetFields {
  const name = pickFieldExact(obj, "目标名称");
  return {
    name,
    size: pickStr(obj, ["目标尺寸"]),
    clarity: pickStr(obj, ["目标清晰度"]),
    type: pickStr(obj, ["目标类型"]),
    color: pickStr(obj, ["目标颜色"]),
    behavior: pickStr(obj, ["目标行为"]),
  };
}

function mapFooterFields(obj: Record<string, unknown>): {
  judgmentBasis?: string;
  featureTarget?: string;
  targetFound?: number;
} {
  const judgmentBasis = pickStr(obj, ["研判依据"]);
  const featureTarget = pickStr(obj, ["特征目标"]);
  const targetFound = pickNum(obj, ["找到目标"]);
  return {
    judgmentBasis:
      judgmentBasis && !isPathishVerifyDisplayText(judgmentBasis) ? judgmentBasis : undefined,
    featureTarget:
      featureTarget && !isPathishVerifyDisplayText(featureTarget) ? featureTarget : undefined,
    targetFound,
  };
}

/** taskStatus=7 的 MinIO 路径分片，不是研判 JSON */
export function isVerifyJudgmentDescriptionFragment(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (isPathishObjectKeyFragment(t)) return false;
  if (
    t.startsWith("{") ||
    t.includes("天气") ||
    t.includes("目标类型") ||
    t.includes("研判依据") ||
    t.includes("找到目标") ||
    t.includes("特征目标")
  ) {
    return true;
  }
  return !/^[\d/.\-_]+$/.test(t);
}
/** 从 description / 研判 JSON 文本解析 */
export function parseVerifyJudgmentText(raw: string): {
  environment?: VerifyEnvironmentFields;
  target?: VerifyTargetFields;
  judgmentBasis?: string;
  featureTarget?: string;
  targetFound?: number;
} {
  const t = raw.trim();
  if (!t || !isVerifyJudgmentDescriptionFragment(t)) return {};

  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };

  let parsed = tryParse(t);
  if (parsed == null) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) parsed = tryParse(m[0]);
  }
  if (parsed == null) return {};

  if (typeof parsed === "string") {
    const inner = tryParse(parsed.trim());
    if (inner && typeof inner === "object") parsed = inner;
    else return {};
  }
  if (Array.isArray(parsed)) {
    const merged: ReturnType<typeof parseVerifyJudgmentText> = {};
    for (const item of parsed) {
      const r = asRecord(item);
      if (!r) continue;
      Object.assign(merged, parseVerifyJudgmentObject(r));
    }
    return merged;
  }

  const obj = asRecord(parsed);
  if (!obj) return {};
  return parseVerifyJudgmentObject(obj);
}

function parseVerifyJudgmentObject(obj: Record<string, unknown>): ReturnType<
  typeof parseVerifyJudgmentText
> {
  const env = mapEnvironment(obj);
  const tgt = mapTarget(obj);
  const footer = mapFooterFields(obj);
  const hasEnv = Object.values(env).some(Boolean);
  const hasTgt =
    tgt.name !== undefined ||
    Object.entries(tgt).some(([k, v]) => k !== "name" && Boolean(v));
  return {
    environment: hasEnv ? env : undefined,
    target: hasTgt ? tgt : undefined,
    ...footer,
  };
}

function mergeFields<T extends Record<string, string | undefined>>(a?: T, b?: T): T | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) } as T;
}

export function mergeVerifyReportJudgment(
  report: VerifyReportViewModel,
  fragments: string[],
): VerifyReportViewModel {
  let environment = report.environment;
  let target = report.target;
  let judgmentBasis = report.judgmentBasis;
  let featureTarget = report.featureTarget;
  let targetFound = report.targetFound;

  for (const frag of fragments) {
    if (!isVerifyJudgmentDescriptionFragment(frag)) continue;
    const p = parseVerifyJudgmentText(frag);
    environment = mergeFields(environment, p.environment);
    target = mergeTargetFields(target, p.target);
    if (p.judgmentBasis?.trim()) judgmentBasis = p.judgmentBasis.trim();
    /** 特征目标 / 找到目标：仅区域搜索（JSON 含「找到目标」） */
    if (p.targetFound != null) {
      targetFound = p.targetFound;
      if (p.featureTarget?.trim()) featureTarget = p.featureTarget.trim();
    }
  }

  if (targetFound == null) featureTarget = undefined;

  return {
    ...report,
    analyzing: false,
    environment,
    target,
    judgmentBasis,
    featureTarget,
    targetFound,
  };
}

function mergeTargetFields(
  a?: VerifyTargetFields,
  b?: VerifyTargetFields,
): VerifyTargetFields | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}

/** 区域搜索等：0/1 时在目标研判框展示 */
export function formatVerifyTargetFoundLabel(targetFound?: number): string | undefined {
  if (targetFound === 1) return "找到目标";
  if (targetFound === 0) return "未找到目标";
  return undefined;
}

/** 三框下方：研判依据（特征目标、找到目标改由卡片分区展示） */
export function buildVerifyReportFooterText(report: VerifyReportViewModel): string {
  const basis = report.judgmentBasis?.trim();
  if (basis && !isPathishVerifyDisplayText(basis)) return basis;
  return "";
}

export function buildVerifyReportFromPayload(p: TaskStatusChatPayload): VerifyReportViewModel {
  const enriched = enrichTaskStatusPayloadForVerifyUi(p);
  const targetId = enriched.verifyTargetId ?? enriched.uniqueId;
  const entityLabel = enriched.entityId?.trim();
  const imageUrl = pickTaskStatusImageUrl(enriched) ?? undefined;

  return {
    entityKind: entityLabel && /^uav/i.test(entityLabel) ? "uav" : "camera",
    trackId:
      targetId != null && Number.isFinite(Number(targetId)) ? Number(targetId) : undefined,
    entityId: entityLabel || undefined,
    longitudeDeg: enriched.longitudeDeg,
    latitudeDeg: enriched.latitudeDeg,
    distanceNm: enriched.distanceNm,
    azimuthDegrees: enriched.azimuthDegrees,
    speedMps: enriched.speedMps,
    shipArchiveInfo: enriched.shipArchiveInfo?.trim() || undefined,
    imageUrl,
    imageMediaType: enriched.imageMediaType,
    imageFileName: enriched.imageFileName?.trim() || undefined,
    analyzing: enriched.taskStatus === 4,
  };
}

export function verifyReportToMessagePart(
  report: VerifyReportViewModel,
): TaskVerifyReportPart {
  return { type: "data-task-verify-report", data: report };
}

export function isTaskVerifyReportPart(part: unknown): part is TaskVerifyReportPart {
  return (
    part != null &&
    typeof part === "object" &&
    (part as TaskVerifyReportPart).type === "data-task-verify-report" &&
    (part as TaskVerifyReportPart).data != null
  );
}

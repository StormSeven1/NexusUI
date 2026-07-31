/**
 * 解析 AlarmSys 告警 content（JSON 证据链）。
 * 兼容旧版纯中文文本：解析失败时用整段作为 summary。
 */

export type AlarmEvidenceContent = {
  v?: number;
  summary: string;
  unique_id?: number | null;
  domain?: "sea" | "air" | string;
  target_type?: string;
  target_type_label?: string;
  angle_label?: string;
  threat_total?: number | null;
  score_type?: number | null;
  score_speed?: number | null;
  score_angle?: number | null;
  score_distance?: number | null;
  score_max_type?: number | null;
  score_max_speed?: number | null;
  score_max_angle?: number | null;
  score_max_distance?: number | null;
  image_bucket?: string | null;
  image_object_key?: string | null;
  image_download_url?: string | null;
  image_camera_index?: string | null;
  image_uploaded_at?: string | null;
  /** 非 JSON 旧文案 */
  rawText?: boolean;
};

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** 从 content 字符串解析证据链；非 JSON 时返回 rawText=true 的 summary */
export function parseAlarmEvidenceContent(content: string | null | undefined): AlarmEvidenceContent | null {
  const raw = (content ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const summary = asString(obj.summary) ?? raw;
      return {
        v: asFiniteNumber(obj.v) ?? undefined,
        summary,
        unique_id: asFiniteNumber(obj.unique_id),
        domain: asString(obj.domain) ?? undefined,
        target_type: asString(obj.target_type) ?? undefined,
        target_type_label: asString(obj.target_type_label) ?? undefined,
        angle_label: asString(obj.angle_label) ?? undefined,
        threat_total: asFiniteNumber(obj.threat_total),
        score_type: asFiniteNumber(obj.score_type),
        score_speed: asFiniteNumber(obj.score_speed),
        score_angle: asFiniteNumber(obj.score_angle),
        score_distance: asFiniteNumber(obj.score_distance),
        score_max_type: asFiniteNumber(obj.score_max_type),
        score_max_speed: asFiniteNumber(obj.score_max_speed),
        score_max_angle: asFiniteNumber(obj.score_max_angle),
        score_max_distance: asFiniteNumber(obj.score_max_distance),
        image_bucket: asString(obj.image_bucket),
        image_object_key: asString(obj.image_object_key),
        image_download_url: asString(obj.image_download_url),
        image_camera_index: asString(obj.image_camera_index),
        image_uploaded_at: asString(obj.image_uploaded_at),
      };
    } catch {
      /* fall through to plain text */
    }
  }

  return { summary: raw, rawText: true };
}

/** 列表「证据链」展示文案 */
export function alarmEvidenceSummaryText(content: string | null | undefined): string {
  return parseAlarmEvidenceContent(content)?.summary ?? "";
}

/** 拼查证图 URL：优先 DB download_url，否则走 Nexus 同源 proxy */
export function resolveEvidenceImageUrl(ev: AlarmEvidenceContent): string | null {
  const du = ev.image_download_url?.trim();
  if (du && (/^https?:\/\//i.test(du) || du.startsWith("/"))) {
    return du;
  }
  const bucket = ev.image_bucket?.trim();
  const objectKey = ev.image_object_key?.trim();
  if (!bucket || !objectKey) return null;
  const bp = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH
    ? process.env.NEXT_PUBLIC_BASE_PATH
    : ""
  ).replace(/\/$/, "");
  return `${bp}/api/task-status-image-proxy?bucket=${encodeURIComponent(bucket)}&objectKey=${encodeURIComponent(objectKey)}`;
}

export type EvidenceScoreRow = {
  key: string;
  label: string;
  value: number;
  max: number;
};

/** hover 弹层分值条（与图示顺序：类型/距离/进攻方向/速度） */
export function buildEvidenceScoreRows(ev: AlarmEvidenceContent): EvidenceScoreRow[] {
  if (ev.threat_total == null && ev.score_type == null && ev.score_distance == null) {
    return [];
  }
  const angleLabel = ev.angle_label?.trim() || "进攻方向";
  return [
    {
      key: "type",
      label: "目标类型",
      value: ev.score_type ?? 0,
      max: ev.score_max_type && ev.score_max_type > 0 ? ev.score_max_type : 42,
    },
    {
      key: "distance",
      label: "距离",
      value: ev.score_distance ?? 0,
      max: ev.score_max_distance && ev.score_max_distance > 0 ? ev.score_max_distance : 24,
    },
    {
      key: "angle",
      label: angleLabel,
      value: ev.score_angle ?? 0,
      max: ev.score_max_angle && ev.score_max_angle > 0 ? ev.score_max_angle : 18,
    },
    {
      key: "speed",
      label: "速度",
      value: ev.score_speed ?? 0,
      max: ev.score_max_speed && ev.score_max_speed > 0 ? ev.score_max_speed : 16,
    },
  ];
}

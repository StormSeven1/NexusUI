/**
 * DDS / WS 航迹分类字段统一解析。
 * - 旧 fusion：`trackCategoryId === 3` 为无人机
 * - NewTrackStruct `classified_type` / `trackType`（UnitType）：
 *   - 对空：`1 = DRONE` 无人机，其余多为鸟
 *   - 对海：`6 = BUOY` 浮标，`7 = SURFACE_SHIP` / `OTHER` 等 → 船（态势不画礁石）
 */

/** 与 NewTrackRealTimeStatus.idl `UnitType` 一致 */
export const UNIT_TYPE_UNKNOWN = 0;
export const UNIT_TYPE_DRONE = 1;
export const UNIT_TYPE_BIRD = 2;
export const UNIT_TYPE_BUOY = 6;
export const UNIT_TYPE_SURFACE_SHIP = 7;
/** IDL UnitType::OTHER */
export const UNIT_TYPE_OTHER = 12;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 与各网关可能使用的键名对齐 */
const CATEGORY_VALUE_KEYS = [
  "trackCategoryId",
  "track_category_id",
  "TrackCategoryId",
  "trackCategoryID",
  "track_category",
  "categoryId",
  "category_id",
] as const;

export function coerceTrackCategoryIdValue(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof raw === "string") {
    const n = parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : undefined;
  }
  /* 少数序列化 Long / protobuf 的 JSON */
  if (typeof raw === "object" && raw !== null && "low" in raw) {
    const low = Number((raw as { low?: unknown }).low);
    if (Number.isFinite(low)) return low & 0xff;
  }
  return undefined;
}

function pickCategoryValue(obj: Record<string, unknown>): unknown {
  for (const k of CATEGORY_VALUE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== null && obj[k] !== undefined) {
      return obj[k];
    }
  }
  return undefined;
}

/** 在纯对象树中深度优先查找分类键（不进入 primitive 数组；遇对象数组则扫元素） */
export function findTrackCategoryIdDeep(root: unknown, maxDepth: number): unknown {
  if (maxDepth < 0 || root == null) return undefined;
  const r = asRecord(root);
  if (!r) return undefined;
  const direct = pickCategoryValue(r);
  if (direct !== undefined) return direct;
  for (const v of Object.values(r)) {
    if (v == null || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const el of v) {
        if (el && typeof el === "object" && !Array.isArray(el)) {
          const hit = findTrackCategoryIdDeep(el, maxDepth - 1);
          if (hit !== undefined) return hit;
        }
      }
      continue;
    }
    const hit = findTrackCategoryIdDeep(v, maxDepth - 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * 从单条 WS 航迹原始对象解析 trackCategoryId；尽力覆盖嵌套与别名。
 */
export function readTrackCategoryFromRecord(rec: Record<string, unknown>): number | undefined {
  const tryVal = (v: unknown) => coerceTrackCategoryIdValue(v);

  const bags: unknown[] = [
    rec,
    rec.properties,
    rec.dds,
    rec.extra,
    rec.payload,
    rec.attributes,
    rec.data,
    rec.raw_data,
  ];
  for (const b of bags) {
    const o = asRecord(b);
    if (!o) continue;
    const v = pickCategoryValue(o);
    if (v !== undefined) {
      const n = tryVal(v);
      if (n !== undefined) return n;
    }
  }

  const raw = asRecord(rec.raw_data);
  if (raw) {
    const deep = findTrackCategoryIdDeep(raw, 5);
    if (deep !== undefined) {
      const n = tryVal(deep);
      if (n !== undefined) return n;
    }
  }

  const nestedData = asRecord(rec.data);
  if (nestedData) {
    const v = pickCategoryValue(nestedData);
    if (v !== undefined) {
      const n = tryVal(v);
      if (n !== undefined) return n;
    }
    const deep = findTrackCategoryIdDeep(nestedData, 4);
    if (deep !== undefined) {
      const n = tryVal(deep);
      if (n !== undefined) return n;
    }
  }

  const res6 = rec.reserved6 ?? rec.reserved_6;
  if (typeof res6 === "string" && res6.trim()) {
    try {
      const j = JSON.parse(res6) as unknown;
      const jr = asRecord(j);
      if (jr) {
        const v = pickCategoryValue(jr);
        if (v !== undefined) {
          const n = tryVal(v);
          if (n !== undefined) return n;
        }
        const deep = findTrackCategoryIdDeep(jr, 4);
        if (deep !== undefined) {
          const n = tryVal(deep);
          if (n !== undefined) return n;
        }
      }
    } catch {
      /* 非 JSON */
    }
  }

  const vRoot = pickCategoryValue(rec);
  if (vRoot !== undefined) {
    const n = tryVal(vRoot);
    if (n !== undefined) return n;
  }

  return undefined;
}

const CLASSIFIED_TYPE_KEYS = [
  "classified_type",
  "classifiedType",
  "trackType",
  "track_type",
] as const;

function pickClassifiedTypeValue(obj: Record<string, unknown>): unknown {
  for (const k of CLASSIFIED_TYPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== null && obj[k] !== undefined) {
      return obj[k];
    }
  }
  return undefined;
}

/** 解析 NewStruct `classified_type`（后端常写作 `trackType` 整型枚举） */
export function readClassifiedTypeFromRecord(rec: Record<string, unknown>): number | undefined {
  const bags: unknown[] = [rec, rec.properties, rec.dds, rec.data, rec.raw_data];
  for (const b of bags) {
    const o = asRecord(b);
    if (!o) continue;
    const v = pickClassifiedTypeValue(o);
    if (v !== undefined) {
      const n = coerceTrackCategoryIdValue(v);
      if (n !== undefined) return n;
    }
  }
  const name = rec.trackCategoryName ?? rec.track_category_name;
  if (typeof name === "string") {
    const s = name.trim().toLowerCase();
    if (s === "drone" || s === "uav") return UNIT_TYPE_DRONE;
    if (s === "bird") return UNIT_TYPE_BIRD;
    if (s === "buoy") return UNIT_TYPE_BUOY;
    if (s === "ship" || s === "surface_ship") return UNIT_TYPE_SURFACE_SHIP;
    if (s === "other") return UNIT_TYPE_OTHER;
  }
  return undefined;
}

/** NewTrackStruct UnitType / trackCategoryName → 标牌「类型」中文 */
const UNIT_TYPE_ZH: Record<number, string> = {
  [UNIT_TYPE_UNKNOWN]: "未知",
  [UNIT_TYPE_DRONE]: "无人机",
  [UNIT_TYPE_BIRD]: "鸟",
  3: "直升机",
  4: "固定翼",
  5: "导弹",
  [UNIT_TYPE_BUOY]: "浮标",
  [UNIT_TYPE_SURFACE_SHIP]: "船",
  8: "潜艇",
  9: "地面车辆",
  10: "人员",
  11: "动物",
  [UNIT_TYPE_OTHER]: "其他",
};

const CATEGORY_NAME_ZH: Record<string, string> = {
  unknown: "未知",
  uav: "无人机",
  drone: "无人机",
  bird: "鸟",
  helicopter: "直升机",
  aircraft: "固定翼",
  fixed_wing: "固定翼",
  missile: "导弹",
  buoy: "浮标",
  ship: "船",
  surface_ship: "船",
  submarine: "潜艇",
  ground_vehicle: "地面车辆",
  person: "人员",
  animal: "动物",
  other: "其他",
};

type TrackLikeForTypeZh = {
  classifiedType?: number;
  targetType?: string;
  manualTargetType?: "ship" | "buoy" | "other";
};

/**
 * 航迹类型中文（标牌「类型」）：优先 `classifiedType`，否则解析 `targetType` / 类别名字符串。
 */
export function formatTrackUnitTypeZh(
  track: Pick<TrackLikeForTypeZh, "classifiedType" | "targetType" | "manualTargetType">,
): string {
  if (track.manualTargetType === "buoy") return "浮标";
  if (track.manualTargetType === "ship") return "船";
  if (track.manualTargetType === "other") return "其他";
  const ct = track.classifiedType;
  if (ct != null && Number.isFinite(ct) && UNIT_TYPE_ZH[ct] != null) {
    return UNIT_TYPE_ZH[ct]!;
  }
  const raw = String(track.targetType ?? "").trim().toLowerCase();
  if (raw && CATEGORY_NAME_ZH[raw]) return CATEGORY_NAME_ZH[raw]!;
  if (raw) return raw;
  return "-";
}

/** 对海航迹 UnitType 是否为 BUOY（6）→ 地图画浮标军标 */
export function isSeaTrackBuoyFromClassification(
  classifiedType: number | undefined,
  targetType?: string | null,
  trackAlias?: string | null,
): boolean {
  if (classifiedType === UNIT_TYPE_BUOY) return true;
  if (classifiedType !== undefined) return false;
  const blob = `${targetType ?? ""} ${trackAlias ?? ""}`.trim().toLowerCase();
  return /\bbuoy\b/.test(blob);
}

/** 对海航迹 UnitType 是否为 SURFACE_SHIP（7）或 OTHER 等 → 地图画船军标（非浮标） */
export function isSeaTrackShipFromClassification(
  classifiedType: number | undefined,
  targetType?: string | null,
  trackAlias?: string | null,
): boolean {
  if (classifiedType === UNIT_TYPE_SURFACE_SHIP || classifiedType === UNIT_TYPE_OTHER) return true;
  if (classifiedType !== undefined) {
    /** 非浮标的已知 UnitType（含 unknown 等）态势一律按船 */
    return classifiedType !== UNIT_TYPE_BUOY;
  }
  const blob = `${targetType ?? ""} ${trackAlias ?? ""}`.trim().toLowerCase();
  if (/\bbuoy\b/.test(blob)) return false;
  return /\b(ship|surface_ship|other)\b/.test(blob) || !blob;
}

/** @deprecated 态势不画礁石；恒为 false，非浮标走船军标 */
export function isSeaTrackReefFromClassification(
  classifiedType: number | undefined,
  targetType?: string | null,
  trackAlias?: string | null,
): boolean {
  void classifiedType;
  void targetType;
  void trackAlias;
  return false;
}

/**
 * 对空航迹是否按无人机图标显示。
 * 优先 NewStruct `classified_type`（DRONE=1）；否则旧 `trackCategoryId===3`。
 */
export function resolveAirTrackIsUav(
  classifiedType: number | undefined,
  trackCategoryId: number | undefined,
  legacyIsUav?: boolean,
): boolean {
  if (classifiedType !== undefined) {
    return classifiedType === UNIT_TYPE_DRONE;
  }
  if (trackCategoryId !== undefined) {
    return trackCategoryId === 3;
  }
  return legacyIsUav === true;
}

export function isAirTrackBirdGlyphFromClassification(
  classifiedType: number | undefined,
  trackCategoryId: number | undefined,
  isUav?: boolean,
): boolean {
  if (classifiedType !== undefined) {
    return classifiedType !== UNIT_TYPE_DRONE;
  }
  if (trackCategoryId != null && Number.isFinite(Number(trackCategoryId))) {
    return Number(trackCategoryId) !== 3;
  }
  return isUav !== true;
}

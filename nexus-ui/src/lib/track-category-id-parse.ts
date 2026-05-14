/**
 * DDS / WS 航迹 `trackCategoryId`（octet，3=无人机）统一解析。
 * 网关与 TrackParser 可能把字段放在根、`raw_data`、`data`、嵌套对象或 `reserved6` JSON 中。
 */

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

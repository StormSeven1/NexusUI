/**
 * 融合航迹 extra_data.fusionSources 目录与解析。
 * bitPosition / 数组下标对应 original_track_id(N+1)；语义以 dataSourceId 为准。
 */

export type FusionDomain = "sea" | "air";

export interface FusionSourceCatalogEntry {
  /** 目录下标 / 约定 bitPosition */
  bitPosition: number;
  name: string;
  dataSourceId: string;
  /** record_radar_track.sensor_id；AIS 用 3；无表则为 null */
  sensorId: number | null;
  /** 是否可作为对海/对空误差真值 */
  isReference: boolean;
  /** 船自报位优先于 AIS */
  referencePriority: number;
}

/** 对海：用户约定目录；另保留 yuan_yao（现场仍在写） */
export const SEA_FUSION_SOURCE_CATALOG: FusionSourceCatalogEntry[] = [
  { bitPosition: 0, name: "鹏飞", dataSourceId: "udp_xpf_track", sensorId: 204, isReference: false, referencePriority: 0 },
  { bitPosition: 1, name: "AIS", dataSourceId: "ais", sensorId: 3, isReference: true, referencePriority: 10 },
  { bitPosition: 2, name: "靖子头-雷达", dataSourceId: "jing_zi_tou", sensorId: 2, isReference: false, referencePriority: 0 },
  { bitPosition: 3, name: "紫东-雷达", dataSourceId: "zi_dong", sensorId: null, isReference: false, referencePriority: 0 },
  { bitPosition: 4, name: "船只自报位", dataSourceId: "udp_boatself_track", sensorId: 202, isReference: true, referencePriority: 100 },
  { bitPosition: 5, name: "天测雷达", dataSourceId: "tian_ce", sensorId: null, isReference: false, referencePriority: 0 },
  { bitPosition: 6, name: "鹏飞", dataSourceId: "udp_xpf_track", sensorId: 204, isReference: false, referencePriority: 0 },
  // 现场库中仍出现的远遥码头
  { bitPosition: -1, name: "远遥码头-雷达", dataSourceId: "yuan_yao", sensorId: 1, isReference: false, referencePriority: 0 },
];

/** 对空目录 */
export const AIR_FUSION_SOURCE_CATALOG: FusionSourceCatalogEntry[] = [
  { bitPosition: 0, name: "探鸟雷达", dataSourceId: "tan_niao", sensorId: 5, isReference: false, referencePriority: 0 },
  { bitPosition: 1, name: "自报位", dataSourceId: "zi_bao_wei", sensorId: 4, isReference: true, referencePriority: 100 },
  { bitPosition: 2, name: "反无车", dataSourceId: "udp_fanwucar_track", sensorId: 203, isReference: false, referencePriority: 0 },
  { bitPosition: 3, name: "打击无人机", dataSourceId: "udp_strike_uav_track", sensorId: null, isReference: false, referencePriority: 0 },
  { bitPosition: -1, name: "KU雷达", dataSourceId: "ku_lei_da", sensorId: 7, isReference: false, referencePriority: 0 },
];

export interface ParsedFusionSource {
  sourceName: string;
  dataSourceId: string;
  trackId: number;
  bitPosition: number;
  /** 数组下标 → original_track_id(index+1) */
  arrayIndex: number;
  catalog: FusionSourceCatalogEntry | null;
}

function catalogByDataSourceId(
  domain: FusionDomain,
  dataSourceId: string,
): FusionSourceCatalogEntry | null {
  const list = domain === "sea" ? SEA_FUSION_SOURCE_CATALOG : AIR_FUSION_SOURCE_CATALOG;
  const id = dataSourceId.trim().toLowerCase();
  return list.find((e) => e.dataSourceId.toLowerCase() === id) ?? null;
}

function catalogByBitPosition(
  domain: FusionDomain,
  bitPosition: number,
): FusionSourceCatalogEntry | null {
  const list = domain === "sea" ? SEA_FUSION_SOURCE_CATALOG : AIR_FUSION_SOURCE_CATALOG;
  return list.find((e) => e.bitPosition === bitPosition) ?? null;
}

/** 解析 extra_data JSON 或已解析对象中的 fusionSources */
export function parseFusionSourcesFromExtraData(
  extraData: unknown,
  domain: FusionDomain,
): ParsedFusionSource[] {
  let root: unknown = extraData;
  if (typeof extraData === "string") {
    const t = extraData.trim();
    if (!t) return [];
    try {
      root = JSON.parse(t);
    } catch {
      return [];
    }
  }
  if (!root || typeof root !== "object") return [];
  const rawList = (root as { fusionSources?: unknown }).fusionSources;
  if (!Array.isArray(rawList)) return [];

  const out: ParsedFusionSource[] = [];
  rawList.forEach((item, arrayIndex) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const trackId = Number(o.trackId ?? o.track_id ?? 0);
    if (!Number.isFinite(trackId) || trackId === 0) return;
    const dataSourceId = String(o.dataSourceId ?? o.data_source_id ?? "").trim();
    const sourceName = String(o.sourceName ?? o.source_name ?? dataSourceId).trim();
    const bitPosition = Number(o.bitPosition ?? o.bit_position ?? arrayIndex);
    const catalog =
      (dataSourceId ? catalogByDataSourceId(domain, dataSourceId) : null) ??
      (Number.isFinite(bitPosition) ? catalogByBitPosition(domain, bitPosition) : null);
    out.push({
      sourceName: sourceName || catalog?.name || dataSourceId || `源${arrayIndex}`,
      dataSourceId: dataSourceId || catalog?.dataSourceId || `unknown_${arrayIndex}`,
      trackId,
      bitPosition: Number.isFinite(bitPosition) ? bitPosition : arrayIndex,
      arrayIndex,
      catalog,
    });
  });
  return out;
}

/** 从融合点 originalData（含 extra_data）解析航迹源 */
export function parseFusionSourcesFromTrackOriginal(
  originalData: Record<string, unknown> | undefined,
  domain: FusionDomain,
): ParsedFusionSource[] {
  if (!originalData) return [];
  const fromExtra = parseFusionSourcesFromExtraData(originalData.extra_data ?? originalData.extraData, domain);
  if (fromExtra.length > 0) return fromExtra;

  // 无 extra_data 时：按数组槽位兼容旧 original_track_id*
  const fallback: ParsedFusionSource[] = [];
  for (let i = 1; i <= 8; i++) {
    const id = Number(originalData[`original_track_id${i}`] ?? 0);
    if (!Number.isFinite(id) || id === 0) continue;
    const cat = catalogByBitPosition(domain, i - 1);
    fallback.push({
      sourceName: cat?.name ?? `源${i}`,
      dataSourceId: cat?.dataSourceId ?? `slot_${i}`,
      trackId: id,
      bitPosition: i - 1,
      arrayIndex: i - 1,
      catalog: cat,
    });
  }
  return fallback;
}

export function isAisFusionSource(src: ParsedFusionSource): boolean {
  const id = src.dataSourceId.toLowerCase();
  return id === "ais" || src.catalog?.dataSourceId === "ais";
}

/** 选误差真值：船自报位优先，其次 AIS / 对空自报位 */
export function pickFusionReferenceSource(
  sources: ParsedFusionSource[],
): ParsedFusionSource | null {
  let best: ParsedFusionSource | null = null;
  let bestPri = -1;
  for (const s of sources) {
    const pri = s.catalog?.isReference ? s.catalog.referencePriority : isAisFusionSource(s) ? 10 : -1;
    if (pri > bestPri) {
      bestPri = pri;
      best = s;
    }
  }
  return best;
}

/** 待评估源：非 AIS，且不是选定的参考源自身 */
export function listFusionEvalSources(
  sources: ParsedFusionSource[],
  reference: ParsedFusionSource | null,
): ParsedFusionSource[] {
  return sources.filter((s) => {
    if (isAisFusionSource(s)) return false;
    if (reference && s.trackId === reference.trackId && s.dataSourceId === reference.dataSourceId) {
      return false;
    }
    return true;
  });
}

export function fusionSourceSeriesKey(src: ParsedFusionSource): string {
  return src.dataSourceId || `bit_${src.bitPosition}`;
}

export function fusionSourceSeriesLabel(src: ParsedFusionSource): string {
  return src.catalog?.name || src.sourceName || src.dataSourceId;
}

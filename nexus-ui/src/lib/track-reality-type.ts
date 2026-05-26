/**
 * DDS NewTrackStruct `reality_type`：0 未知、1 实兵、2 虚兵。
 */

const REALITY_TYPE_KEYS = ["reality_type", "realityType"] as const;

function isVirtualFromPropBag(props: Record<string, unknown> | null | undefined): boolean {
  if (!props) return false;
  if (props.virtualTroop === true || props.virtual_troop === true) return true;
  const raw = props.is_virtual ?? props.virtual ?? props.isVirtual;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "virtual";
  }
  return false;
}

type TrackRealityFields = { realityType?: number; isVirtual?: boolean };

export function readRealityTypeFromRecord(rec: Record<string, unknown> | null | undefined): number | undefined {
  if (!rec) return undefined;
  const bags: Record<string, unknown>[] = [rec];
  const props = rec.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    bags.push(props as Record<string, unknown>);
  }
  for (const bag of bags) {
    for (const key of REALITY_TYPE_KEYS) {
      const raw = bag[key];
      if (raw == null) continue;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
  }
  return undefined;
}

/**
 * 解析是否虚兵：2=虚兵，1=实兵，0/未带=沿用 isVirtual 或 properties 旧字段。
 */
export function resolveTrackIsVirtual(
  realityType: number | undefined,
  propBag?: Record<string, unknown> | null,
  legacyIsVirtual?: boolean,
): boolean {
  if (realityType === 2) return true;
  if (realityType === 1) return false;
  if (legacyIsVirtual === true) return true;
  if (propBag && isVirtualFromPropBag(propBag)) return true;
  return false;
}

/** 态势军标是否按虚兵样式绘制（底部虚线） */
export function isTrackVirtualTroop(t: TrackRealityFields): boolean {
  return resolveTrackIsVirtual(t.realityType, null, t.isVirtual === true);
}

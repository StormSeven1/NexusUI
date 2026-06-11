export function readVirtualTroop(data: Record<string, unknown>): boolean {
  const raw =
    data.virtualTroop ??
    data.virtual_troop ??
    data.is_virtual ??
    data.isVirtual ??
    data.virtual;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "virtual" || s === "铏氬叺";
  }
  const indicators = data.indicators;
  if (indicators && typeof indicators === "object") {
    const simulated = (indicators as Record<string, unknown>).simulated;
    if (typeof simulated === "boolean") return simulated;
  }
  return false;
}

function parseQuantityUnits(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s.toUpperCase() === "NULL") return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

export function readMunitionQuantityFromPayload(
  data: Record<string, unknown> | null | undefined,
): number | null {
  if (!data) return null;
  const munitionInfo = data.munition_info ?? data.munitionInfo;
  if (munitionInfo === null) return null;
  if (munitionInfo && typeof munitionInfo === "object") {
    const bag = munitionInfo as Record<string, unknown>;
    return parseQuantityUnits(bag.quantityUnits ?? bag.quantity_units);
  }
  return parseQuantityUnits(
    data.munition_quantity ??
      data.munitionQuantity ??
      data.quantityUnits ??
      data.quantity_units,
  );
}

import type { EoDroneDeviceRow, EoDroneDevicesFile, UavVendor } from "./droneRegistryTypes";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickStr(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** 从嵌套对象（如 gateway / dock / aircraft）取 SN */
function pickFromChild(
  raw: Record<string, unknown>,
  childKeys: string[],
  fieldKeys: string[],
): string {
  for (const ck of childKeys) {
    const ch = raw[ck];
    if (!isRecord(ch)) continue;
    const s = pickStr(ch, fieldKeys);
    if (s) return s;
  }
  return "";
}

/** 与设备管理接口一致：aliases.alternateIds 里 type=DEVICE_SN / GATEWAY_SN 等 */
function pickAlternateIdByType(raw: Record<string, unknown>, typeLiteral: string): string {
  const want = typeLiteral.toUpperCase();
  const aliases = raw.aliases;
  if (!isRecord(aliases)) return "";
  const alt = aliases.alternateIds;
  if (!Array.isArray(alt)) return "";
  for (const item of alt) {
    if (!isRecord(item)) continue;
    if (String(item.type ?? "").toUpperCase() !== want) continue;
    const id = item.id;
    if (typeof id === "string" && id.trim()) return id.trim();
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
  }
  return "";
}

function isUavOntology(raw: Record<string, unknown>): boolean {
  const o = raw.ontology;
  if (!isRecord(o)) return false;
  const st = String(o.specificType ?? "").toUpperCase();
  const pt = String(o.platformType ?? "").toUpperCase();
  const tpl = String(o.template ?? "").toUpperCase();
  return st === "UAV" || pt.includes("UAV") || tpl.includes("UAV");
}

function inferVendor(r: Record<string, unknown>, entityId: string): UavVendor {
  const eid = entityId.toLowerCase();
  if (eid.includes("uav_jo") || eid.includes("_jo-") || eid.includes("jo-")) return "jouav";
  const blob = JSON.stringify(r).toLowerCase();
  if (blob.includes("jouav") || blob.includes("纵横")) return "jouav";
  if (blob.includes("dji") || blob.includes("大疆")) return "dji";
  const t = pickStr(r, ["vendor", "manufacturer", "brand", "type", "deviceType", "device_type"]).toLowerCase();
  if (t.includes("jouav") || t.includes("纵横")) return "jouav";
  return "dji";
}

function isObjectArray(a: unknown): a is Record<string, unknown>[] {
  return Array.isArray(a) && a.length > 0 && a.every((x) => isRecord(x));
}

/**
 * 从分页 JSON 中找出「对象数组」：兼容 data.records、data.list、result.rows 及更深一层包装。
 */
export function extractEntityRecords(payload: unknown): unknown[] {
  if (isObjectArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const shallowKeys = ["records", "list", "items", "rows", "content", "data", "value", "result", "entities"];
  for (const k of shallowKeys) {
    const v = payload[k];
    if (isObjectArray(v)) return v;
    if (isRecord(v)) {
      const inner = v as Record<string, unknown>;
      for (const ik of ["records", "list", "items", "rows", "content", "data", "value", "entities"]) {
        const a = inner[ik];
        if (isObjectArray(a)) return a;
      }
    }
  }

  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 8 || node == null) return null;
    if (isObjectArray(node)) return node;
    if (!isRecord(node) || seen.has(node)) return null;
    seen.add(node);
    for (const v of Object.values(node)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(payload, 0) ?? [];
}

function mapOne(raw: unknown): EoDroneDeviceRow | null {
  if (!isRecord(raw)) return null;
  const entityId = pickStr(raw, ["entityId", "entity_id", "id", "uuid", "deviceId", "device_id"]);
  const name = pickStr(raw, ["name", "entityName", "entity_name", "title", "label", "displayName", "deviceName"]);
  let deviceSN = pickStr(raw, [
    "deviceSN",
    "device_sn",
    "serialNumber",
    "serial_number",
    "droneSn",
    "drone_sn",
    "aircraftSn",
    "aircraft_sn",
    "uavSn",
    "uav_sn",
    "childSn",
    "child_sn",
    "sn",
    "deviceSn",
  ]);
  let airportSN = pickStr(raw, [
    "airportSN",
    "airport_sn",
    "gatewaySn",
    "gateway_sn",
    "dockSn",
    "dock_sn",
    "nestSn",
    "nest_sn",
    "dockSerial",
    "gateway_serial",
    "parentSn",
    "parent_sn",
    "gateway",
  ]);

  if (!airportSN) {
    airportSN = pickFromChild(raw, ["gateway", "dock", "nest", "airport", "dockInfo", "gatewayInfo"], [
      "sn",
      "serialNumber",
      "serial_number",
      "deviceSn",
      "device_sn",
      "gatewaySn",
      "dockSn",
    ]);
  }
  if (!deviceSN) {
    deviceSN = pickFromChild(raw, ["aircraft", "drone", "uav", "subDevice", "aircraftInfo"], [
      "sn",
      "serialNumber",
      "serial_number",
      "deviceSn",
      "device_sn",
      "droneSn",
    ]);
  }

  if (!deviceSN) {
    deviceSN =
      pickAlternateIdByType(raw, "DEVICE_SN") ||
      pickAlternateIdByType(raw, "AIRCRAFT_SN") ||
      pickAlternateIdByType(raw, "DRONE_SN");
  }
  if (!airportSN) {
    airportSN =
      pickAlternateIdByType(raw, "GATEWAY_SN") ||
      pickAlternateIdByType(raw, "AIRPORT_SN") ||
      pickAlternateIdByType(raw, "DOCK_SN") ||
      pickAlternateIdByType(raw, "NEST_SN");
  }

  if (!entityId || !deviceSN || !airportSN) return null;
  if (!isUavOntology(raw)) return null;

  const vendor = inferVendor(raw, entityId);
  const dockPlaybackEntityId =
    pickStr(raw, ["dockPlaybackEntityId", "dock_entity_id", "airportEntityId", "airport_entity_id", "gatewayEntityId"]) ||
    undefined;
  const airPlaybackEntityId =
    pickStr(raw, ["airPlaybackEntityId", "air_entity_id", "droneEntityId", "drone_entity_id"]) || undefined;
  return {
    entityId,
    ...(name ? { name } : {}),
    deviceSN,
    airportSN,
    vendor,
    dockPlaybackEntityId: dockPlaybackEntityId || undefined,
    airPlaybackEntityId: airPlaybackEntityId || undefined,
  };
}

export function mapEntitiesPayloadToDevices(payload: unknown): EoDroneDeviceRow[] {
  const rows = extractEntityRecords(payload);
  const out: EoDroneDeviceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const d = mapOne(r);
    if (!d) continue;
    const k = `${d.entityId}:${d.deviceSN}:${d.airportSN}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

export function buildDroneDevicesFile(sourceUrl: string, payload: unknown): EoDroneDevicesFile {
  return {
    syncedAt: new Date().toISOString(),
    sourceUrl,
    devices: mapEntitiesPayloadToDevices(payload),
  };
}

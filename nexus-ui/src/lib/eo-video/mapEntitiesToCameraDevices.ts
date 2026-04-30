import type { EoCameraRegistryFile, EoCameraRegistryRow } from "./cameraRegistryTypes";
import { extractEntityRecords } from "./mapEntitiesToDroneDevices";

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

/** 与 EoVideoPanel 一致：camera_000 … camera_999 */
export function isCameraEntityId(id: string): boolean {
  return /^camera_[0-9]{3}$/i.test(id.trim());
}

function cameraLabel(raw: Record<string, unknown>, entityId: string): string {
  const aliases = raw.aliases;
  if (isRecord(aliases) && typeof aliases.name === "string" && aliases.name.trim()) {
    return aliases.name.trim();
  }
  return entityId;
}

function isCameraOntology(raw: Record<string, unknown>): boolean {
  const o = raw.ontology;
  if (!isRecord(o)) return false;
  const st = String(o.specificType ?? "").toUpperCase();
  const tpl = String(o.template ?? "").toUpperCase();
  if (st.includes("CAMERA") || st === "EO" || st === "IR") return true;
  if (tpl.includes("CAMERA") || tpl.includes("SENSOR")) return true;
  return false;
}

function mapCameraOne(raw: unknown): EoCameraRegistryRow | null {
  if (!isRecord(raw)) return null;
  const entityId = pickStr(raw, ["entityId", "entity_id", "id"]);
  if (!entityId) return null;
  if (!isCameraEntityId(entityId) && !isCameraOntology(raw)) return null;
  if (!isCameraEntityId(entityId) && isCameraOntology(raw)) {
    // ontology 像相机但 id 非 camera_xxx 时仍跳过，避免误把 UAV 当相机
    return null;
  }
  return {
    entityId,
    label: cameraLabel(raw, entityId),
  };
}

export function mapEntitiesPayloadToCameras(payload: unknown): EoCameraRegistryRow[] {
  const rows = extractEntityRecords(payload);
  const out: EoCameraRegistryRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = mapCameraOne(r);
    if (!c) continue;
    if (seen.has(c.entityId)) continue;
    seen.add(c.entityId);
    out.push(c);
  }
  return out.sort((a, b) => a.entityId.localeCompare(b.entityId, undefined, { numeric: true }));
}

export function buildCameraRegistryFile(sourceUrl: string, payload: unknown): EoCameraRegistryFile {
  return {
    syncedAt: new Date().toISOString(),
    sourceUrl,
    cameras: mapEntitiesPayloadToCameras(payload),
  };
}

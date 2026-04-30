import { NextRequest, NextResponse } from "next/server";
import { extractEntityRecords, mapEntitiesPayloadToDevices } from "@/lib/eo-video/mapEntitiesToDroneDevices";

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";

function isSafeEntityId(id: string): boolean {
  const t = id.trim();
  if (!t || t.length > 200) return false;
  return /^[a-zA-Z0-9_.:-]+$/.test(t);
}

function pickEntityId(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const rec = raw as Record<string, unknown>;
  for (const k of ["entityId", "entity_id", "id", "uuid", "deviceId", "device_id"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

export async function GET(_req: NextRequest, context: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await context.params;
  const id = decodeURIComponent(entityId).trim();
  if (!isSafeEntityId(id)) {
    return NextResponse.json({ ok: false, error: "invalid_entity_id", entityId: id }, { status: 400 });
  }

  const listUrl = (process.env.NEXUS_ENTITIES_LIST_URL ?? DEFAULT_LIST_URL).trim();
  try {
    const res = await fetch(listUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "entities_fetch_failed", entityId: id, status: res.status, detail: text.slice(0, 300) },
        { status: 502 },
      );
    }
    const payload: unknown = JSON.parse(text);
    const rows = extractEntityRecords(payload);
    const matched = rows.find((r) => pickEntityId(r) === id);
    if (!matched) {
      return NextResponse.json({ ok: false, error: "entity_not_found_in_registry", entityId: id }, { status: 404 });
    }

    const mapped = mapEntitiesPayloadToDevices([matched])[0];
    if (!mapped) {
      return NextResponse.json({ ok: false, error: "entity_not_uav_or_missing_sn", entityId: id }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      entityId: id,
      airportSN: mapped.airportSN,
      deviceSN: mapped.deviceSN,
      dockPlaybackEntityId: mapped.dockPlaybackEntityId ?? null,
      airPlaybackEntityId: mapped.airPlaybackEntityId ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "resolve_failed", entityId: id, detail: msg }, { status: 500 });
  }
}

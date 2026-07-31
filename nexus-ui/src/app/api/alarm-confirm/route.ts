import { NextRequest, NextResponse } from "next/server";
import { getAlarmConfirmApiUrl } from "@/lib/alarm-server-config.server";

type IncomingBody = {
  uniqueId?: unknown;
  unique_id?: unknown;
  uniqueID?: unknown;
  lat?: unknown;
  latitude?: unknown;
  targetlat?: unknown;
  lon?: unknown;
  lng?: unknown;
  longitude?: unknown;
  targetlon?: unknown;
  speed?: unknown;
  speedMps?: unknown;
  course?: unknown;
  courseDeg?: unknown;
  heading?: unknown;
  isAirTrack?: unknown;
  fuseType?: unknown;
};

function parseUniqueId(body: IncomingBody): number | null {
  const raw = body.uniqueId ?? body.unique_id ?? body.uniqueID;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function pickFiniteNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** BFF：转发人工确认告警 POST 至 `NEXUS_ALARM_SERVER_URL/api/alarm_confirm`。 */
export async function POST(req: NextRequest) {
  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return NextResponse.json({ code: -1, message: "invalid JSON body" }, { status: 400 });
  }

  const uniqueId = parseUniqueId(body);
  if (uniqueId == null) {
    return NextResponse.json({ code: -1, message: "missing or invalid uniqueId" }, { status: 400 });
  }

  const upstreamUrl = getAlarmConfirmApiUrl();
  const upstreamBody: Record<string, unknown> = { uniqueId };

  const lat = pickFiniteNumber(body.lat, body.latitude, body.targetlat);
  const lon = pickFiniteNumber(body.lon, body.lng, body.longitude, body.targetlon);
  if (lat != null && lon != null) {
    upstreamBody.lat = lat;
    upstreamBody.lon = lon;
    const speed = pickFiniteNumber(body.speed, body.speedMps);
    const course = pickFiniteNumber(body.course, body.courseDeg, body.heading);
    if (speed != null) upstreamBody.speed = speed;
    if (course != null) upstreamBody.course = course;
    if (typeof body.isAirTrack === "boolean") {
      upstreamBody.isAirTrack = body.isAirTrack;
    } else if (typeof body.fuseType === "number" && Number.isFinite(body.fuseType)) {
      upstreamBody.fuseType = Math.trunc(body.fuseType);
    }
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(5000),
    });
    const text = await upstream.text().catch(() => "");
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { message: text.slice(0, 500) };
    }
    return NextResponse.json(json, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[alarm-confirm] upstream failed:", upstreamUrl, message);
    return NextResponse.json({ code: -1, message }, { status: 502 });
  }
}

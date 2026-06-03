import { NextRequest, NextResponse } from "next/server";
import { getAlarmConfirmApiUrl } from "@/lib/alarm-server-config.server";

type IncomingBody = {
  uniqueId?: unknown;
  unique_id?: unknown;
  uniqueID?: unknown;
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

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uniqueId }),
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

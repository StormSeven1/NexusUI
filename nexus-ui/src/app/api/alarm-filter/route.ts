import { NextRequest, NextResponse } from "next/server";
import { getAlarmFilterApiUrl } from "@/lib/alarm-server-config.server";

const FILTER_SPEC_TYPE = "type.casia.tasks.v1.filterTargetOrForce";

type IncomingBody = {
  taskId?: unknown;
  specification?: {
    "@type"?: unknown;
    type?: unknown;
    id?: unknown;
  };
};

function parseFuseType(v: unknown): 0 | 1 | null {
  if (v === 0 || v === "0") return 0;
  if (v === 1 || v === "1") return 1;
  if (typeof v === "number" && (v === 0 || v === 1)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (n === 0 || n === 1) return n;
  }
  return null;
}

function parseTrackId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) return n;
  }
  return null;
}

/**
 * BFF：转发航迹告警过滤 POST 至 `NEXUS_ALARM_SERVER_URL/api/alarm_filter`。
 */
export async function POST(req: NextRequest) {
  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return NextResponse.json({ code: -1, message: "invalid JSON body" }, { status: 400 });
  }

  const spec = body.specification;
  if (!spec || typeof spec !== "object") {
    return NextResponse.json({ code: -1, message: "missing specification" }, { status: 400 });
  }

  const atType = typeof spec["@type"] === "string" ? spec["@type"] : "";
  if (atType !== FILTER_SPEC_TYPE) {
    return NextResponse.json({ code: -1, message: "invalid specification.@type" }, { status: 400 });
  }

  const fuseType = parseFuseType(spec.type);
  const trackId = parseTrackId(spec.id);
  if (fuseType == null || trackId == null) {
    return NextResponse.json(
      { code: -1, message: "invalid specification.type(0/1) or specification.id" },
      { status: 400 },
    );
  }

  const taskId =
    typeof body.taskId === "string" && body.taskId.trim()
      ? body.taskId.trim()
      : `task-filter-${Date.now()}`;

  const upstreamUrl = getAlarmFilterApiUrl();
  const upstreamBody = {
    taskId,
    specification: {
      "@type": FILTER_SPEC_TYPE,
      type: fuseType,
      id: trackId,
    },
  };

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
    console.error("[alarm-filter] upstream failed:", upstreamUrl, message);
    return NextResponse.json({ code: -1, message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";

function createTaskId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveTaskEndpoint(backendBaseUrl: string): string | null {
  try {
    const u = new URL(backendBaseUrl.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}/api/v1/tasks`;
  } catch {
    return null;
  }
}

function validEntityId(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 192) return false;
  return /^[\w.-]+$/.test(t);
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

type GuideBody = {
  backendBaseUrl?: unknown;
  ownerEntityId?: unknown;
  entityId?: unknown;
  targetLon?: unknown;
  targetLat?: unknown;
  targetAlt?: unknown;
  guideControlType?: unknown;
  imageControlType?: unknown;
};

/**
 * 8院态势跟踪：`ThirdPartyYuan8GuideTask`（XJXT 3006 经纬高引导）
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const p = body as GuideBody;
  const ownerEntityId = String(p.ownerEntityId ?? p.entityId ?? "").trim();
  const backendBaseUrl = String(p.backendBaseUrl ?? "").trim();

  if (ownerEntityId && !validEntityId(ownerEntityId)) {
    return NextResponse.json({ error: "invalid owner entityId" }, { status: 400 });
  }
  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const targetLon = num(p.targetLon);
  const targetLat = num(p.targetLat);
  const targetAlt = num(p.targetAlt) ?? 0;
  if (targetLon === undefined || targetLat === undefined) {
    return NextResponse.json({ error: "targetLon/targetLat required" }, { status: 400 });
  }

  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.ThirdPartyYuan8GuideTask",
    entityId: "",
    guideControlType: num(p.guideControlType) === 0 ? 0 : 1,
    imageControlType: num(p.imageControlType) === 0 ? 0 : 1,
    targetLon,
    targetLat,
    targetAlt,
  };

  const taskPayload: Record<string, unknown> = {
    version: { major: 1, minor: 0 },
    taskId: createTaskId("y8_guide"),
    taskType: "MANUAL",
    createdBy: {
      user: { priority: 0, userId: "nexus_ui" },
    },
    owner: { entityId: ownerEntityId || "" },
    specification,
  };

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(taskPayload),
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "yuan8 guide proxy failed", target, detail }, { status: 502 });
  }
}

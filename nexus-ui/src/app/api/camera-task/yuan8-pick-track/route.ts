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

type PickBody = {
  backendBaseUrl?: unknown;
  ownerEntityId?: unknown;
  entityId?: unknown;
  pickCoordX?: unknown;
  pickCoordY?: unknown;
  controlType?: unknown;
  servoAzimuth?: unknown;
  servoElevation?: unknown;
};

/**
 * 8院视频点动/压点跟踪：`ThirdPartyYuan8PickTrackTask`（XJXT 3003，pickCoord 0~255）
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const p = body as PickBody;
  const ownerEntityId = String(p.ownerEntityId ?? p.entityId ?? "").trim();
  const backendBaseUrl = String(p.backendBaseUrl ?? "").trim();

  if (!ownerEntityId || !validEntityId(ownerEntityId)) {
    return NextResponse.json({ error: "owner entityId required" }, { status: 400 });
  }
  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const pickCoordX = num(p.pickCoordX);
  const pickCoordY = num(p.pickCoordY);
  if (pickCoordX === undefined || pickCoordY === undefined) {
    return NextResponse.json({ error: "pickCoordX/pickCoordY required" }, { status: 400 });
  }

  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.ThirdPartyYuan8PickTrackTask",
    entityId: ownerEntityId,
    controlType: num(p.controlType) ?? 2,
    pickCoordX: Math.max(0, Math.min(255, Math.round(pickCoordX))),
    pickCoordY: Math.max(0, Math.min(255, Math.round(pickCoordY))),
    servoAzimuth: num(p.servoAzimuth) ?? 0,
    servoElevation: num(p.servoElevation) ?? 0,
  };

  const taskPayload: Record<string, unknown> = {
    version: { major: 1, minor: 0 },
    taskId: createTaskId("y8_pick"),
    taskType: "MANUAL",
    createdBy: {
      user: { priority: 0, userId: "nexus_ui" },
    },
    owner: { entityId: ownerEntityId },
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
    return NextResponse.json({ error: "yuan8 pick-track proxy failed", target, detail }, { status: 502 });
  }
}

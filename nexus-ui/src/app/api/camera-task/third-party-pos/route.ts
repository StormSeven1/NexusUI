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

type PosBody = {
  backendBaseUrl?: unknown;
  entityId?: unknown;
  targetId?: unknown;
  targetLon?: unknown;
  targetLat?: unknown;
  targetAlt?: unknown;
  tarSpeed?: unknown;
  tarCourse?: unknown;
  platformLon?: unknown;
  platformLat?: unknown;
  platformAlt?: unknown;
  platformSpeed?: unknown;
  platformCourse?: unknown;
};

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 第三方相机雷达引导：`ThirdPartyCamPosTask`（0x3004 POS）→ `POST …/api/v1/tasks`
 * 见 third_party_camera_task_interface.md §5.4 / §8.4
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const p = body as PosBody;
  const entityId = String(p.entityId ?? "").trim();
  const backendBaseUrl = String(p.backendBaseUrl ?? "").trim();

  if (!validEntityId(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }
  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const targetLon = num(p.targetLon);
  const targetLat = num(p.targetLat);
  if (targetLon === undefined || targetLat === undefined) {
    return NextResponse.json({ error: "targetLon/targetLat required" }, { status: 400 });
  }

  const targetIdN = num(p.targetId);
  const targetAltN = num(p.targetAlt);
  const tarSpeedN = num(p.tarSpeed);
  const tarCourseN = num(p.tarCourse);
  const platformLon = num(p.platformLon);
  const platformLat = num(p.platformLat);
  const platformAlt = num(p.platformAlt);
  const platformSpeed = num(p.platformSpeed);
  const platformCourse = num(p.platformCourse);

  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.ThirdPartyCamPosTask",
    targetId: Math.trunc(targetIdN ?? 0),
    targetLon,
    targetLat,
    targetAlt: targetAltN ?? 0,
    tarSpeed: tarSpeedN ?? 0,
    tarCourse: tarCourseN ?? 0,
  };
  if (platformLon !== undefined) specification.platformLon = platformLon;
  if (platformLat !== undefined) specification.platformLat = platformLat;
  if (platformAlt !== undefined) specification.platformAlt = platformAlt;
  if (platformSpeed !== undefined) specification.platformSpeed = platformSpeed;
  if (platformCourse !== undefined) specification.platformCourse = platformCourse;

  const taskPayload = {
    version: { major: 1, minor: 0 },
    taskId: createTaskId("tp_pos"),
    taskType: "MANUAL",
    createdBy: {
      user: {
        priority: 0,
        userId: "nexus_ui",
      },
    },
    owner: {
      entityId,
    },
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
    return NextResponse.json({ error: "third-party pos proxy failed", target, detail }, { status: 502 });
  }
}

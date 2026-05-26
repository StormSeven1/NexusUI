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
  /** `owner.entityId`；缺省 `""` */
  ownerEntityId?: unknown;
  /** 兼容旧字段名 */
  entityId?: unknown;
  /** `specification.entityId`；缺省 `""` */
  specEntityId?: unknown;
  targetId?: unknown;
  targetLon?: unknown;
  targetLat?: unknown;
  targetAlt?: unknown;
  tarSpeed?: unknown;
  tarCourse?: unknown;
};

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 第三方相机雷达引导：`ThirdPartyCamPosTask`（0x3004 POS）→ `POST …/api/v1/tasks`
 * 与光电视频工具栏 SEARCH/TRACK 同源 BFF 模式；载荷对齐相机管理 HTTP 示例。
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const p = body as PosBody;
  const ownerEntityId = String(p.ownerEntityId ?? p.entityId ?? "").trim();
  const backendBaseUrl = String(p.backendBaseUrl ?? "").trim();
  const specEntityId = String(p.specEntityId ?? "").trim();

  if (ownerEntityId && !validEntityId(ownerEntityId)) {
    return NextResponse.json({ error: "invalid owner entityId" }, { status: 400 });
  }
  if (specEntityId && !validEntityId(specEntityId)) {
    return NextResponse.json({ error: "invalid specification entityId" }, { status: 400 });
  }
  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const targetLon = num(p.targetLon);
  const targetLat = num(p.targetLat);
  const targetIdN = num(p.targetId);
  const targetAltN = num(p.targetAlt);
  const tarSpeedN = num(p.tarSpeed);
  const tarCourseN = num(p.tarCourse);

  if (targetLon === undefined || targetLat === undefined) {
    return NextResponse.json({ error: "targetLon/targetLat required" }, { status: 400 });
  }
  if (targetIdN === undefined) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 });
  }
  if (targetAltN === undefined || tarSpeedN === undefined || tarCourseN === undefined) {
    return NextResponse.json({ error: "targetAlt/tarSpeed/tarCourse required" }, { status: 400 });
  }

  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.ThirdPartyCamPosTask",
    /** 相机 id：态势双击固定传空字符串（由后端按 targetId 路由） */
    entityId: specEntityId || "",
    targetId: Math.trunc(targetIdN),
    targetLon,
    targetLat,
    targetAlt: targetAltN,
    tarSpeed: tarSpeedN,
    tarCourse: tarCourseN,
  };

  const taskPayload: Record<string, unknown> = {
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
      entityId: ownerEntityId || "",
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

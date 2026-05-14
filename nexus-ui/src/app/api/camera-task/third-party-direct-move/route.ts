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

function finiteNum(v: unknown): number | null {
  if (v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `ThirdPartyCamDirectMoveTask`（0x3001）→ `POST …/api/v1/tasks`
 * 与 Qt `sendDirectMove(entityId, pan, tilt, zoom)` 对齐（third_party_camera_task_interface.md §5.1）
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const p = body as Record<string, unknown>;
  const entityId = String(p.entityId ?? "").trim();
  const backendBaseUrl = String(p.backendBaseUrl ?? "").trim();
  const pan = finiteNum(p.pan);
  const tilt = finiteNum(p.tilt);
  const zoom = finiteNum(p.zoom);

  if (!validEntityId(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }
  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }
  if (pan === null || tilt === null || zoom === null) {
    return NextResponse.json({ error: "pan/tilt/zoom must be finite numbers" }, { status: 400 });
  }

  const taskPayload = {
    version: { major: 1, minor: 0 },
    taskId: createTaskId("tp_dm"),
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
    specification: {
      "@type": "type.casia.tasks.v1.ThirdPartyCamDirectMoveTask",
      pan,
      tilt,
      zoom,
    },
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
    return NextResponse.json({ error: "third-party direct move proxy failed", target, detail }, { status: 502 });
  }
}

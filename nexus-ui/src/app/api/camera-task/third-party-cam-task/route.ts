import { NextRequest, NextResponse } from "next/server";

const TASK_KINDS = new Set(["SEARCH", "TRACK", "FOCUS", "STOP"]);

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

/**
 * 第三方相机：`ThirdPartyCamCamTask`（SEARCH/TRACK/FOCUS）或 `ThirdPartyCamStopTask`（STOP）→ `POST …/api/v1/tasks`
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payloadIn = body as { entityId?: unknown; backendBaseUrl?: unknown; taskKind?: unknown };
  const entityId = String(payloadIn.entityId ?? "").trim();
  const backendBaseUrl = String(payloadIn.backendBaseUrl ?? "").trim();
  const taskKind = String(payloadIn.taskKind ?? "").trim().toUpperCase();

  if (!validEntityId(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }
  if (!TASK_KINDS.has(taskKind)) {
    return NextResponse.json({ error: "invalid taskKind" }, { status: 400 });
  }

  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const specification =
    taskKind === "STOP"
      ? {
          "@type": "type.casia.tasks.v1.ThirdPartyCamStopTask",
          params: { entityId },
        }
      : {
          "@type": "type.casia.tasks.v1.ThirdPartyCamCamTask",
          taskKind,
        };

  const taskPayload = {
    version: { major: 1, minor: 0 },
    taskId: createTaskId(taskKind === "STOP" ? "tp_camstop" : "tp_camtask"),
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
    return NextResponse.json({ error: "third-party cam task proxy failed", target, detail }, { status: 502 });
  }
}

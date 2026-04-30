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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payloadIn = body as { entityId?: unknown; backendBaseUrl?: unknown };
  const entityId = String(payloadIn.entityId ?? "").trim().toLowerCase();
  const backendBaseUrl = String(payloadIn.backendBaseUrl ?? "").trim();

  if (!/^camera_\d{3}$/.test(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }

  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const taskPayload = {
    taskId: createTaskId("ptz_stop"),
    parentTaskId: createTaskId("task_search"),
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "云台停止",
    taskType: "MANUAL",
    maxExecutionTimeMs: 1000,
    specification: { "@type": "type.casia.tasks.v1.PTZControlStop" },
    createdBy: {
      user: {
        userId: "operator_001",
        priority: 0,
      },
    },
    owner: { entityId },
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
    return NextResponse.json({ error: "ptz proxy failed", target, detail }, { status: 502 });
  }
}

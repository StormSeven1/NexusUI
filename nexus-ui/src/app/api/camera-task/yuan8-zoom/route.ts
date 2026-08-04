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

/**
 * 8院手动变倍：`ThirdPartyYuan8ZoomTask`（3004：0xF0加大 / 0x0F减小 / 0x00停止）
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const p = body as Record<string, unknown>;
  const ownerEntityId = String(p.ownerEntityId ?? p.entityId ?? "").trim();
  const backendBaseUrl = String(p.backendBaseUrl ?? "").trim();
  if (!ownerEntityId || !validEntityId(ownerEntityId)) {
    return NextResponse.json({ error: "owner entityId required" }, { status: 400 });
  }
  const target = resolveTaskEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const zoomCommand = num(p.zoomCommand);
  if (zoomCommand === undefined) {
    return NextResponse.json({ error: "zoomCommand required" }, { status: 400 });
  }

  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.ThirdPartyYuan8ZoomTask",
    entityId: ownerEntityId,
    camSwitchCommand: num(p.camSwitchCommand) ?? 0,
    zoomControlType: num(p.zoomControlType) ?? 0,
    zoomCommand: Math.trunc(zoomCommand),
    zoomValue: num(p.zoomValue) ?? 0,
  };

  const taskPayload = {
    version: { major: 1, minor: 0 },
    taskId: createTaskId("y8_zoom"),
    taskType: "MANUAL",
    createdBy: { user: { priority: 0, userId: "nexus_ui" } },
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
    return NextResponse.json({ error: "yuan8 zoom proxy failed", target, detail }, { status: 502 });
  }
}

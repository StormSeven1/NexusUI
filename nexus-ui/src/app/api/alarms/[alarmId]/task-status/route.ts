import { NextRequest, NextResponse } from "next/server";
import { processTaskStatusIngest } from "@/lib/task-status-ingest-handler";

export const runtime = "nodejs";

function corsHeaders(): Record<string, string> {
  const origin = process.env.TASK_STATUS_CORS_ORIGIN?.trim();
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Task-Status-Secret",
  };
}

function verifySecret(req: NextRequest): boolean {
  const secret = process.env.TASK_STATUS_INGEST_SECRET?.trim();
  if (!secret) return true;
  const header = req.headers.get("x-task-status-secret")?.trim();
  const auth = req.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return header === secret || bearer === secret;
}

function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

async function handlePutOrPost(req: NextRequest, ctx: { params: Promise<{ alarmId: string }> }) {
  if (!verifySecret(req)) {
    return jsonResponse({ code: 401, message: "unauthorized", data: null }, 401);
  }

  const { alarmId: rawAlarmId } = await ctx.params;
  const alarmId = decodeURIComponent(rawAlarmId ?? "").trim();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "JSON格式不正确", data: null }, 400);
  }

  const result = await processTaskStatusIngest(alarmId, body);
  if (!result.ok) {
    return jsonResponse(result.body, result.status);
  }

  return jsonResponse(result.body, 200);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ alarmId: string }> }) {
  return handlePutOrPost(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ alarmId: string }> }) {
  return handlePutOrPost(req, ctx);
}

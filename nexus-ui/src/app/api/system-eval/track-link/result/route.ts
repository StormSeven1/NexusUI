import { NextRequest, NextResponse } from "next/server";
import {
  custombackendProxyHeaders,
  resolveCustombackendBase,
} from "@/lib/server/custombackend-proxy";

/** 转发到 Custombackend `GET /api/system-eval/track-link/result` */
export async function GET(req: NextRequest) {
  const backendBase = resolveCustombackendBase();
  const taskId = req.nextUrl.searchParams.get("task_id");
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const url = `${backendBase}/api/system-eval/track-link/result${qs}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: custombackendProxyHeaders(req, { Accept: "application/json" }),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "backend proxy failed",
        message: `无法连接 Custombackend: ${backendBase}`,
        backend: backendBase,
        detail: msg,
      },
      { status: 502 },
    );
  }
}

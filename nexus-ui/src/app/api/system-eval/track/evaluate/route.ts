import { NextRequest, NextResponse } from "next/server";
import {
  custombackendProxyHeaders,
  resolveCustombackendBase,
} from "@/lib/server/custombackend-proxy";

/**
 * 转发到 Custombackend `POST /api/system-eval/track/evaluate`（再调 system-evaluation-server gRPC）。
 */
export async function POST(req: NextRequest) {
  const backendBase = resolveCustombackendBase();
  const url = `${backendBase}/api/system-eval/track/evaluate`;

  let bodyText = "";
  try {
    bodyText = await req.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "invalid request body", message: msg },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: custombackendProxyHeaders(req, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: bodyText,
      cache: "no-store",
    });
    const text = await res.text();
    const trimmed = text.trim();
    const looksJson =
      trimmed.startsWith("{") || trimmed.startsWith("[");
    if (!looksJson) {
      const preview = trimmed.slice(0, 200);
      return NextResponse.json(
        {
          code: res.status,
          message:
            preview === "Internal Server Error"
              ? "Custombackend 返回 500（常见原因：评估结果含 NaN 无法序列化，或接口未更新；请重启 Custombackend 并查看日志）"
              : `后端返回非 JSON（HTTP ${res.status}）`,
          error: preview,
          backend: backendBase,
          timestamp: new Date().toISOString(),
        },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }
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
        message: `无法连接 Custombackend: ${backendBase}（请确认 Custombackend 已启动且含 /api/system-eval/track/evaluate）`,
        backend: backendBase,
        detail: msg,
      },
      { status: 502 },
    );
  }
}

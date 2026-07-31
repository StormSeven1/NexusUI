import { NextResponse } from "next/server";

import { resolveNexusEntityApiBase } from "@/lib/nexus-entity-api.server";

/** 上游实测 ping 约 7–15s，给足余量 */
export const maxDuration = 60;

/**
 * 代理 8090 `GET /api/v1/ping`：客户端与各实体链路延迟/丢包。
 */
export async function GET() {
  const pingUrl = `${resolveNexusEntityApiBase()}/api/v1/ping`;
  try {
    const res = await fetch(pingUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { ok: false, error: "上游返回非 JSON", status: res.status, snippet: text.slice(0, 200) },
        { status: 502 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `上游 HTTP ${res.status}`, pingUrl, snippet: text.slice(0, 400) },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: true, pingUrl, fetchedAt: new Date().toISOString(), ...(payload as object) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, pingUrl }, { status: 500 });
  }
}

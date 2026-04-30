import { NextResponse } from "next/server";
import {
  buildEntityV1UpstreamUrl,
  isSafeEntityIdForProxy,
} from "@/lib/entityUpstream";

export const runtime = "nodejs";

/**
 * 代理实体详情 JSON（与 base-vue `/api/v1/entity/:id` 同源），供光电窗 `fetchCameraEntityPlayback` 使用。
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await context.params;
  const id = decodeURIComponent(raw ?? "").trim();
  if (!isSafeEntityIdForProxy(id)) {
    return NextResponse.json({ error: "invalid_entity_id" }, { status: 400 });
  }

  const url = buildEntityV1UpstreamUrl(id);
  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "upstream_fetch_failed", url, detail: msg }, { status: 502 });
  }
}

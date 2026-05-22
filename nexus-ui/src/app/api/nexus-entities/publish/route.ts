import { NextRequest, NextResponse } from "next/server";
import { nexusPublishEntityUrl } from "@/lib/nexus-entity-api.server";
import { parsePublishEntityUpstream } from "@/lib/parse-publish-entity-response";

/** 代理 `POST {host}/api/v1/publishEntity` */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "无效 JSON" }, { status: 400 });
  }

  const url = nexusPublishEntityUrl();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let upstream: unknown = null;
    try {
      upstream = text ? JSON.parse(text) : null;
    } catch {
      upstream = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const parsed = parsePublishEntityUpstream(upstream);
      return NextResponse.json(
        {
          ok: false,
          error: parsed.message || `上游 HTTP ${res.status}`,
          code: parsed.code,
          message: parsed.message,
          entityId: parsed.entityId,
          url,
          upstream,
        },
        { status: 502 },
      );
    }

    const parsed = parsePublishEntityUpstream(upstream);
    return NextResponse.json({
      ok: parsed.ok,
      code: parsed.code,
      message: parsed.message,
      entityId: parsed.entityId,
      url,
      upstream,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, url }, { status: 500 });
  }
}

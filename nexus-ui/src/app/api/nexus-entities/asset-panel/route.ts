import { NextResponse } from "next/server";

import { buildCatalogFromEntitiesPayload } from "@/lib/asset-panel-catalog";

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=500";

/** 资产列表侧边栏：8090 全量实体（不做地图 id 黑名单、不要求坐标） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrl = (
    searchParams.get("url")?.trim() ||
    process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
    DEFAULT_LIST_URL
  ).trim();

  try {
    const res = await fetch(listUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
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
        { ok: false, error: `上游 HTTP ${res.status}`, listUrl, snippet: text.slice(0, 400) },
        { status: 502 },
      );
    }
    const format = searchParams.get("format")?.trim().toLowerCase();
    if (format === "upstream") {
      return NextResponse.json(
        {
          ok: true,
          listUrl,
          fetchedAt: new Date().toISOString(),
          payload,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const items = buildCatalogFromEntitiesPayload(payload);
    return NextResponse.json(
      {
        ok: true,
        listUrl,
        fetchedAt: new Date().toISOString(),
        items,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, listUrl }, { status: 500 });
  }
}

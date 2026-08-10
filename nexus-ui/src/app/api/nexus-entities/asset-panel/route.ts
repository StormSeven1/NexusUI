import { NextResponse } from "next/server";

import { buildCatalogFromEntitiesPayload } from "@/lib/asset-panel-catalog";
import { fetchNexusEntitiesListAllPages } from "@/lib/server/nexus-entities-fetch";

/** 资产列表侧边栏：8090 全量实体（不做地图 id 黑名单、不要求坐标） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrlOverride = searchParams.get("url")?.trim() || null;

  try {
    /* 须分页拉全量：size=100 时雷达等常在第 2 页，单页会导致刷新后雷达数为 0 */
    const upstream = await fetchNexusEntitiesListAllPages({ listUrl: listUrlOverride });
    const { listUrl, status, text, payload } = upstream;
    if (payload == null) {
      return NextResponse.json(
        { ok: false, error: "上游返回非 JSON", status, snippet: text.slice(0, 200) },
        { status: 502 },
      );
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `上游 HTTP ${status}`, listUrl, snippet: text.slice(0, 400) },
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
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        listUrl:
          listUrlOverride ||
          process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
          "http://192.168.18.141:8090/api/v1/entities?page=1&size=500",
      },
      { status: 500 },
    );
  }
}

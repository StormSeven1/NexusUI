import { NextResponse } from "next/server";

import { buildEntityTaskRowsFromEntitiesPayload } from "@/lib/entities-track-task-rows";
import { fetchNexusEntitiesList } from "@/lib/server/nexus-entities-fetch";

/**
 * 供前端内存缓存：拉取实体列表并解析 `camera_*` 的 hasPtz / parent_device_id（不与写盘同步逻辑混用）。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrlOverride = searchParams.get("url")?.trim() || null;

  try {
    const upstream = await fetchNexusEntitiesList({
      listUrl: listUrlOverride,
      timeoutMs: 10_000,
    });
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
    const items = buildEntityTaskRowsFromEntitiesPayload(payload);
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

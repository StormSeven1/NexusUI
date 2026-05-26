import { NextResponse } from "next/server";

import { mapEntitiesPayloadToCameras } from "@/lib/eo-video/mapEntitiesToCameraDevices";

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";

/**
 * 8090 实体列表中 ontology 为光电（`CAMERA` / `camera_XXX` 等，不含第三方 ontology）→ 右键「光电」菜单。
 */
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
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { ok: false, error: "上游返回非 JSON", status: res.status, snippet: text.slice(0, 200), listUrl },
        { status: 502 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `上游 HTTP ${res.status}`, listUrl, snippet: text.slice(0, 400) },
        { status: 502 },
      );
    }
    const cameras = mapEntitiesPayloadToCameras(payload);
    return NextResponse.json(
      {
        ok: true,
        listUrl,
        fetchedAt: new Date().toISOString(),
        cameras,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, listUrl }, { status: 500 });
  }
}

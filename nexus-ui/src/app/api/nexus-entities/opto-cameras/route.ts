import { NextResponse } from "next/server";

import { mapEntitiesPayloadToCameras } from "@/lib/eo-video/mapEntitiesToCameraDevices";
import { fetchNexusEntitiesList } from "@/lib/server/nexus-entities-fetch";

/**
 * 8090 实体列表中 ontology 为光电（`CAMERA` / `camera_XXX` 等，不含第三方 ontology）→ 右键「光电」菜单。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrlOverride = searchParams.get("url")?.trim() || null;

  try {
    const upstream = await fetchNexusEntitiesList({ listUrl: listUrlOverride });
    const { listUrl, status, text, payload } = upstream;
    if (payload == null) {
      return NextResponse.json(
        { ok: false, error: "上游返回非 JSON", status, snippet: text.slice(0, 200), listUrl },
        { status: 502 },
      );
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `上游 HTTP ${status}`, listUrl, snippet: text.slice(0, 400) },
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
    return NextResponse.json(
      { ok: false, error: msg, listUrl: resolveSafeListUrl(listUrlOverride) },
      { status: 500 },
    );
  }
}

function resolveSafeListUrl(override: string | null): string {
  return (
    override?.trim() ||
    process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
    "http://192.168.18.141:8090/api/v1/entities?page=1&size=100"
  );
}

import { NextResponse } from "next/server";

import {
  extractEntityRecords,
  mapEntityRecordsToDevices,
} from "@/lib/eo-video/mapEntitiesToDroneDevices";
import {
  fetchNexusEntitiesListAllPages,
  resolveNexusEntitiesListUrl,
} from "@/lib/server/nexus-entities-fetch";

/**
 * 8090 实体列表中 ontology 为 UAV，且 `indicators.simulated === false` → 光电右键「无人机」菜单。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const includeSimulated = searchParams.get("includeSimulated") === "1";
  const listUrl = resolveNexusEntitiesListUrl(searchParams.get("url"));

  try {
    const upstream = await fetchNexusEntitiesListAllPages({ listUrl });
    if (!upstream.ok || upstream.payload == null) {
      return NextResponse.json(
        {
          ok: false,
          error: upstream.payload == null ? "上游返回非 JSON" : `上游 HTTP ${upstream.status}`,
          listUrl: upstream.listUrl,
          snippet: upstream.text.slice(0, 400),
        },
        { status: 502 },
      );
    }
    const records = extractEntityRecords(upstream.payload);
    const devices = mapEntityRecordsToDevices(records, { includeSimulated });
    return NextResponse.json(
      {
        ok: true,
        listUrl: upstream.listUrl,
        fetchedAt: new Date().toISOString(),
        devices,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, listUrl }, { status: 502 });
  }
}

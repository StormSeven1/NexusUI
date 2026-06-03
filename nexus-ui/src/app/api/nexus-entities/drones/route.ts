import { NextResponse } from "next/server";

import {
  extractEntityRecords,
  mapEntityRecordsToDevices,
} from "@/lib/eo-video/mapEntitiesToDroneDevices";

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 拉取 8090 全部分页（`data.pages`），合并 records 后映射无人机 */
async function fetchAllEntityRecords(listUrl: string): Promise<unknown[]> {
  const res = await fetch(listUrl, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    cache: "no-store",
  });
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`上游返回非 JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`上游 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const merged = [...extractEntityRecords(payload)];
  const data = isRecord(payload) ? payload.data : null;
  const pages = isRecord(data) && typeof data.pages === "number" ? data.pages : 1;
  if (pages <= 1) return merged;

  const base = new URL(listUrl);
  for (let page = 2; page <= pages; page += 1) {
    base.searchParams.set("page", String(page));
    const pageRes = await fetch(base.toString(), {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    if (!pageRes.ok) continue;
    const pageJson = (await pageRes.json()) as unknown;
    merged.push(...extractEntityRecords(pageJson));
  }
  return merged;
}

/**
 * 8090 实体列表中 ontology 为 UAV，且 `indicators.simulated === false` → 光电右键「无人机」菜单。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrl = (
    searchParams.get("url")?.trim() ||
    process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
    DEFAULT_LIST_URL
  ).trim();

  try {
    const records = await fetchAllEntityRecords(listUrl);
    const devices = mapEntityRecordsToDevices(records);
    return NextResponse.json(
      {
        ok: true,
        listUrl,
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

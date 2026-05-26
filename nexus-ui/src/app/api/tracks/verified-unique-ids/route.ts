import { NextRequest } from "next/server";
import { listVerifiedUniqueIdsFromDb } from "@/lib/verified-tracks-db.server";

export const runtime = "nodejs";

/**
 * POST /api/tracks/verified-unique-ids
 * Body: `{ uniqueIds: string[] }` → `{ ok: true, verified: string[] }`
 * 在 `minio_multi_metadata` 中存在匹配 `unique_id` 的视为已查证。
 */
export async function POST(req: NextRequest) {
  let uniqueIds: string[] = [];
  try {
    const body = (await req.json()) as { uniqueIds?: unknown };
    if (Array.isArray(body.uniqueIds)) {
      uniqueIds = body.uniqueIds.map((x) => String(x ?? "").trim()).filter(Boolean);
    }
  } catch {
    return Response.json({ ok: false, verified: [], error: "invalid json" }, { status: 400 });
  }

  const verified = await listVerifiedUniqueIdsFromDb(uniqueIds);
  return Response.json({ ok: true, verified });
}

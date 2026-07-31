import { NextRequest } from "next/server";
import { listRecentTrackScreenshotsFromDb } from "@/lib/track-screenshots-db.server";

export const runtime = "nodejs";

/**
 * GET /api/track-screenshots?uniqueId=&limit=10
 * **仅**按 `uniqueId`（纯数字）查库表 `unique_id`；查不到返回 `items: []`。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const uniqueId = sp.get("uniqueId")?.trim() ?? "";
  const limRaw = sp.get("limit");
  const limit = limRaw != null ? Number(limRaw) : 10;

  const rows = await listRecentTrackScreenshotsFromDb({
    uniqueIdStr: uniqueId || null,
    limit: Number.isFinite(limit) ? limit : 10,
  });

  const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  const items = rows.map((r) => ({
    url: `${bp}/api/task-status-image-proxy?bucket=${encodeURIComponent(r.minioBucket)}&objectKey=${encodeURIComponent(r.minioObjectKey)}`,
    bucket: r.minioBucket,
    objectKey: r.minioObjectKey,
    cameraIndex: r.cameraIndex,
    uploadedAt: r.uploadedAt,
  }));

  return Response.json({ ok: true, items });
}

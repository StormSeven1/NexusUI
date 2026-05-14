/**
 * 按航迹从 PostgreSQL `minio_multi_metadata` 拉取最近截图元数据（与 Qt 查证同源表）。
 * **仅**按库表字段 `unique_id` 查询，与航迹报文 `uniqueID` 严格对应；无合法 `uniqueID` 时返回空。
 */
import { Pool } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

export type TrackScreenshotRow = {
  minioBucket: string;
  minioObjectKey: string;
};

let pool: Pool | null | undefined;

function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  const conn = resolvePostgresConnectionString();
  if (!conn) {
    pool = null;
    return null;
  }
  pool = new Pool({ connectionString: conn, max: 4, idleTimeoutMillis: 10_000 });
  return pool;
}

function isDigits(s: string): boolean {
  return /^\d+$/.test(s.trim());
}

/**
 * 最近最多 `limit` 条截图（按 `uploaded_at` 降序）。
 * **仅** `WHERE "unique_id" = $1::bigint`；`uniqueIdStr` 非纯数字则返回 `[]`。
 */
export async function listRecentTrackScreenshotsFromDb(options: {
  uniqueIdStr?: string | null;
  limit?: number;
}): Promise<TrackScreenshotRow[]> {
  const p = getPool();
  if (!p) return [];

  const limit = Math.min(30, Math.max(1, Math.floor(options.limit ?? 10)));
  const uid = options.uniqueIdStr != null ? String(options.uniqueIdStr).trim() : "";
  if (!uid.length || !isDigits(uid)) return [];

  const client = await p.connect();
  try {
    const sql = `
      SELECT minio_bucket, minio_object_key
      FROM minio_multi_metadata
      WHERE "unique_id" = $1::bigint
        AND minio_bucket IS NOT NULL AND trim(minio_bucket) <> ''
        AND minio_object_key IS NOT NULL AND trim(minio_object_key) <> ''
      ORDER BY uploaded_at DESC NULLS LAST
      LIMIT $2`;

    const r = await client.query<{ minio_bucket: string; minio_object_key: string }>(sql, [uid, limit]);
    const seen = new Set<string>();
    const out: TrackScreenshotRow[] = [];
    for (const row of r.rows) {
      const b = (row.minio_bucket ?? "").trim();
      const k = (row.minio_object_key ?? "").trim();
      if (!b || !k) continue;
      const sig = `${b}\0${k}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ minioBucket: b, minioObjectKey: k });
      if (out.length >= limit) break;
    }
    return out;
  } finally {
    client.release();
  }
}

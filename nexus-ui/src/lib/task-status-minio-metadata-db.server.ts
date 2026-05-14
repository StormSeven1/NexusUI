/**
 * 与 Qt `PgDataAccessLayer::getLatestScreenshotMetadata` 同源：
 * 表 `minio_multi_metadata`，`file_name LIKE screenshot_0_{cameraIndex}_%`。
 * 优先 `unique_id`；无则按 `trackid` 兜底（与 HTTP `trackID` 对齐时）。
 */
import { Pool, type PoolClient } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

export type MinioMetadataRow = {
  minioBucket: string;
  minioObjectKey: string;
  downloadUrl: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function queryOne(
  client: PoolClient,
  sql: string,
  params: (string | number | bigint)[],
): Promise<MinioMetadataRow | null> {
  const r = await client.query<{
    minio_bucket: string;
    minio_object_key: string;
    download_url: string | null;
  }>(sql, params);
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const b = (row.minio_bucket ?? "").trim();
  const k = (row.minio_object_key ?? "").trim();
  const du = (row.download_url ?? "").trim();
  if (!b || !k) return null;
  return { minioBucket: b, minioObjectKey: k, downloadUrl: du };
}

async function byUniqueId(uniqueId: bigint | number, cameraIndex: number): Promise<MinioMetadataRow | null> {
  const p = getPool();
  if (!p) return null;
  const prefix = `screenshot_0_${cameraIndex}_`;
  const client = await p.connect();
  try {
    const sql = `
      SELECT minio_bucket, minio_object_key, download_url
      FROM minio_multi_metadata
      WHERE "unique_id" = $1
        AND file_name LIKE $2
      ORDER BY uploaded_at DESC
      LIMIT 1`;
    return await queryOne(client, sql, [uniqueId, `${prefix}%`]);
  } finally {
    client.release();
  }
}

async function byTrackId(trackId: number, cameraIndex: number): Promise<MinioMetadataRow | null> {
  const p = getPool();
  if (!p) return null;
  const prefix = `screenshot_0_${cameraIndex}_`;
  const client = await p.connect();
  try {
    const sql = `
      SELECT minio_bucket, minio_object_key, download_url
      FROM minio_multi_metadata
      WHERE trackid = $1
        AND file_name LIKE $2
      ORDER BY uploaded_at DESC
      LIMIT 1`;
    return await queryOne(client, sql, [trackId, `${prefix}%`]);
  } finally {
    client.release();
  }
}

/** Qt 在查询前有约 2s 延迟，可通过 TASK_STATUS_METADATA_QUERY_DELAY_MS 对齐 */
export async function resolveScreenshotMetadataFromDb(options: {
  uniqueId?: number | null;
  trackId?: number | null;
  cameraIndex: number;
}): Promise<MinioMetadataRow | null> {
  const delayMs = Number(process.env.TASK_STATUS_METADATA_QUERY_DELAY_MS ?? "0");
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await sleep(delayMs);
  }

  const cam = options.cameraIndex;
  if (options.uniqueId != null && Number.isFinite(Number(options.uniqueId))) {
    const row = await byUniqueId(Number(options.uniqueId), cam);
    if (row) return row;
  }
  if (options.trackId != null && Number.isFinite(options.trackId)) {
    return byTrackId(options.trackId, cam);
  }
  return null;
}

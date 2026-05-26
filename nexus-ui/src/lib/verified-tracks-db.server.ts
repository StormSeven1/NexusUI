/**
 * 批量判断 `minio_multi_metadata` 中是否存在指定 `unique_id`（与 Qt `getMinioMultiMetadata` 一致）。
 */
import { Pool } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

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

function parseDigitsIds(uniqueIds: readonly string[]): bigint[] {
  const out: bigint[] = [];
  const seen = new Set<string>();
  for (const raw of uniqueIds) {
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s) || seen.has(s)) continue;
    seen.add(s);
    try {
      out.push(BigInt(s));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** 返回在库中有任意元数据行的 unique_id（字符串形式） */
export async function listVerifiedUniqueIdsFromDb(uniqueIds: readonly string[]): Promise<string[]> {
  const p = getPool();
  if (!p) return [];
  const ids = parseDigitsIds(uniqueIds);
  if (!ids.length) return [];

  const client = await p.connect();
  try {
    const r = await client.query<{ unique_id: string }>(
      `
      SELECT DISTINCT "unique_id"::text AS unique_id
      FROM minio_multi_metadata
      WHERE "unique_id" = ANY($1::bigint[])
      `,
      [ids],
    );
    return r.rows.map((row) => String(row.unique_id).trim()).filter((s) => /^\d+$/.test(s));
  } finally {
    client.release();
  }
}

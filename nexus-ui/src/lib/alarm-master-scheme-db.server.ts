/**
 * 告警主方案 `alarm_master_schemes`：与 Qt `getActiveSchemeId` 对齐。
 * 取 `enabled = true` 中 `updated_at` 最新的一条（用户切换启用时会更新该行）。
 */
import { Pool } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

let pool: Pool | null = null;

function getPool(): Pool | null {
  const url = resolvePostgresConnectionString();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

/** 当前激活方案 ID；无 enabled=true 或库未配置时返回 null */
export async function queryActiveAlarmSchemeId(): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const r = await p.query<{ scheme_id: string }>(
      `SELECT scheme_id
       FROM alarm_master_schemes
       WHERE enabled = true
       ORDER BY updated_at DESC NULLS LAST, is_default DESC NULLS LAST, created_at DESC
       LIMIT 1`,
    );
    const id = r.rows[0]?.scheme_id?.trim();
    return id || null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[alarm-master-scheme-db] query failed:", message);
    return null;
  }
}

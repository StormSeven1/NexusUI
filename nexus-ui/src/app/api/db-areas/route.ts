import { NextResponse } from "next/server";
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

/**
 * 读取 Postgres `area_table`（与 WatchSys `PgDataAccessLayer::getAreaInfo` 一致）。
 * 连接串：`NEXUS_POSTGRES_URL`（见 `resolvePostgresConnectionString`）；未配置时返回空列表。
 */
export async function GET() {
  const p = getPool();
  if (!p) {
    return NextResponse.json({ areas: [], configured: false });
  }

  try {
    const r = await p.query(
      `SELECT group_id, area_id, COALESCE(group_name,'') AS group_name, COALESCE(area_name,'') AS area_name,
              area_type, COALESCE(start_point,'') AS start_point, COALESCE(end_point,'') AS end_point,
              COALESCE(area_rect,'') AS area_rect, COALESCE(area_points,'') AS area_points,
              COALESCE(line_color,'') AS line_color, COALESCE(line_width, 2) AS line_width
       FROM area_table
       ORDER BY group_id, area_id`,
    );
    return NextResponse.json({ areas: r.rows as unknown[], configured: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ areas: [], configured: true, error: msg }, { status: 200 });
  }
}

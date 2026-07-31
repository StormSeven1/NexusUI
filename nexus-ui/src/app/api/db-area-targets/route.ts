import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

/** 固定目标 `target_id` 起始值（含）；由服务端分配，客户端不可传。 */
export const FIXED_TARGET_ID_START = 10000;

export type DbAreaTargetCreateBody = {
  area_name: string;
  area_type: 1 | 2 | 3;
  start_point?: string;
  end_point?: string;
  area_rect?: string;
  area_points?: string;
};

export type AreaTableTargetRow = {
  id: string;
  area_name: string;
  target_id: number;
  area_type: number;
  start_point: string;
  end_point: string;
  area_rect: string;
  area_points: string;
  created_at?: string;
  updated_at?: string;
};

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
 * 读取 Postgres `area_table_target`（固定目标区域）。
 */
export async function GET() {
  const p = getPool();
  if (!p) {
    return NextResponse.json({ areas: [], configured: false });
  }

  try {
    const r = await p.query(
      `SELECT id::text AS id, COALESCE(area_name,'') AS area_name, target_id, area_type,
              COALESCE(start_point,'') AS start_point, COALESCE(end_point,'') AS end_point,
              COALESCE(area_rect,'') AS area_rect, COALESCE(area_points,'') AS area_points,
              created_at, updated_at
       FROM area_table_target
       ORDER BY target_id`,
    );
    return NextResponse.json({ areas: r.rows as AreaTableTargetRow[], configured: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ areas: [], configured: true, error: msg }, { status: 200 });
  }
}

/**
 * 向 `area_table_target` 插入固定目标区域。
 * `target_id` 由服务端从 10000 起递增分配，唯一且不可由客户端指定。
 */
export async function POST(req: NextRequest) {
  const p = getPool();
  if (!p) {
    return NextResponse.json({ ok: false, error: "数据库未配置（NEXUS_POSTGRES_URL）" }, { status: 503 });
  }

  let body: DbAreaTargetCreateBody;
  try {
    body = (await req.json()) as DbAreaTargetCreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "无效 JSON" }, { status: 400 });
  }

  const areaType = Number(body.area_type);
  if (![1, 2, 3].includes(areaType)) {
    return NextResponse.json({ ok: false, error: "area_type 须为 1/2/3（固定目标不支持航线）" }, { status: 400 });
  }

  const areaName = String(body.area_name ?? "").trim();
  if (!areaName) {
    return NextResponse.json({ ok: false, error: "area_name 不能为空" }, { status: 400 });
  }

  if (areaType === 1 && !String(body.area_rect ?? "").trim()) {
    return NextResponse.json({ ok: false, error: "矩形缺少 area_rect" }, { status: 400 });
  }
  if (areaType === 2 && (!String(body.start_point ?? "").trim() || !String(body.end_point ?? "").trim())) {
    return NextResponse.json({ ok: false, error: "圆形缺少 start_point / end_point" }, { status: 400 });
  }
  if (areaType === 3 && !String(body.area_points ?? "").trim()) {
    return NextResponse.json({ ok: false, error: "多边形缺少 area_points" }, { status: 400 });
  }

  const startPoint = String(body.start_point ?? "");
  const endPoint = String(body.end_point ?? "");
  const areaRect = String(body.area_rect ?? "");
  const areaPoints = String(body.area_points ?? "");

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    // 行锁：并发插入时串行分配 target_id，避免唯一冲突
    await client.query(`LOCK TABLE area_table_target IN SHARE ROW EXCLUSIVE MODE`);

    const idRes = await client.query<{ next_id: string }>(
      `SELECT COALESCE(MAX(target_id) + 1, $1)::bigint AS next_id FROM area_table_target`,
      [FIXED_TARGET_ID_START],
    );
    let targetId = Number(idRes.rows[0]?.next_id ?? FIXED_TARGET_ID_START);
    if (!Number.isFinite(targetId) || targetId < FIXED_TARGET_ID_START) {
      targetId = FIXED_TARGET_ID_START;
    }

    const ins = await client.query<{ id: string; target_id: string }>(
      `INSERT INTO area_table_target (
         area_name, target_id, area_type,
         start_point, end_point, area_rect, area_points
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, $7
       )
       RETURNING id::text AS id, target_id::text AS target_id`,
      [areaName, targetId, areaType, startPoint, endPoint, areaRect, areaPoints],
    );

    await client.query("COMMIT");
    const row = ins.rows[0];
    return NextResponse.json({
      ok: true,
      id: row?.id,
      target_id: Number(row?.target_id ?? targetId),
      area_name: areaName,
      area_type: areaType,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}

/** 按 uuid 删除 `area_table_target` 记录 */
export async function DELETE(req: NextRequest) {
  const p = getPool();
  if (!p) {
    return NextResponse.json({ ok: false, error: "数据库未配置" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "须提供 id（uuid）" }, { status: 400 });
  }

  try {
    const r = await p.query(`DELETE FROM area_table_target WHERE id = $1::uuid`, [id]);
    return NextResponse.json({ ok: true, deleted: r.rowCount ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

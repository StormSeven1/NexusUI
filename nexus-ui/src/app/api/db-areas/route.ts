import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

export type DbAreaCreateBody = {
  group_id?: number;
  /** 新建分组时提供名称；与 `group_id` 二选一（新建时勿传 group_id） */
  new_group_name?: string;
  area_name: string;
  area_type: 1 | 2 | 3 | 4;
  start_point?: string;
  end_point?: string;
  area_rect?: string;
  area_points?: string;
  line_color?: string;
  line_width?: number;
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

/**
 * 向 `area_table` 插入区域（自动分配 area_id；新建分组时自动分配 group_id）。
 */
export async function POST(req: NextRequest) {
  const p = getPool();
  if (!p) {
    return NextResponse.json({ ok: false, error: "数据库未配置（NEXUS_POSTGRES_URL）" }, { status: 503 });
  }

  let body: DbAreaCreateBody;
  try {
    body = (await req.json()) as DbAreaCreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "无效 JSON" }, { status: 400 });
  }

  const areaType = Number(body.area_type);
  if (![1, 2, 3, 4].includes(areaType)) {
    return NextResponse.json({ ok: false, error: "area_type 须为 1/2/3/4" }, { status: 400 });
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
  if (
    areaType === 4 &&
    (!String(body.start_point ?? "").trim() || !String(body.area_points ?? "").trim())
  ) {
    return NextResponse.json({ ok: false, error: "航线缺少 start_point / area_points" }, { status: 400 });
  }

  const lineColor = String(body.line_color ?? "#3b82f6").trim() || "#3b82f6";
  const lineWidth = Math.max(1, Math.min(12, Number(body.line_width) || 2));

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    let groupId = body.group_id != null ? Number(body.group_id) : NaN;
    let groupName = "";

    if (!Number.isFinite(groupId)) {
      const newName = String(body.new_group_name ?? "").trim() || "新分组";
      const gRes = await client.query<{ next_id: string }>(
        `SELECT COALESCE(MAX(group_id), 0) + 1 AS next_id FROM area_table`,
      );
      groupId = Number(gRes.rows[0]?.next_id ?? 1);
      groupName = newName;
    } else {
      const gn = await client.query<{ group_name: string }>(
        `SELECT COALESCE(MAX(group_name), '') AS group_name FROM area_table WHERE group_id = $1`,
        [groupId],
      );
      groupName = String(gn.rows[0]?.group_name ?? "").trim() || `分组${groupId}`;
    }

    const aRes = await client.query<{ next_id: string }>(
      `SELECT COALESCE(MAX(area_id), 0) + 1 AS next_id FROM area_table WHERE group_id = $1`,
      [groupId],
    );
    const areaId = Number(aRes.rows[0]?.next_id ?? 1);

    await client.query(
      `INSERT INTO area_table (
         group_id, area_id, group_name, area_name, area_type,
         start_point, end_point, area_rect, area_points,
         line_width, line_color, check_state, waring_type, waring_time
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, 1, 0, 0
       )`,
      [
        groupId,
        areaId,
        groupName,
        areaName,
        areaType,
        areaType === 2 || areaType === 4 ? String(body.start_point ?? "") : "",
        areaType === 2 ? String(body.end_point ?? "") : "",
        areaType === 1 ? String(body.area_rect ?? "") : "",
        areaType === 3 || areaType === 4 ? String(body.area_points ?? "") : "",
        lineWidth,
        lineColor,
      ],
    );

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      group_id: groupId,
      area_id: areaId,
      group_name: groupName,
      area_name: areaName,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}

/** 删除 `area_table` 中指定 group_id + area_id */
export async function DELETE(req: NextRequest) {
  const p = getPool();
  if (!p) {
    return NextResponse.json({ ok: false, error: "数据库未配置" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const groupId = Number(searchParams.get("group_id"));
  const areaId = Number(searchParams.get("area_id"));
  if (!Number.isFinite(groupId) || !Number.isFinite(areaId)) {
    return NextResponse.json({ ok: false, error: "须提供 group_id 与 area_id" }, { status: 400 });
  }

  try {
    const r = await p.query(
      `DELETE FROM area_table WHERE group_id = $1 AND area_id = $2`,
      [groupId, areaId],
    );
    return NextResponse.json({ ok: true, deleted: r.rowCount ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

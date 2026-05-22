/**
 * 将 Postgres `area_table` 中全部区域/航线批量注册到实体服务 `POST /api/v1/publishEntity`。
 *
 * 用法（在 nexus-ui 目录）:
 *   npx tsx scripts/bulk-register-area-entities.ts
 *   npx tsx scripts/bulk-register-area-entities.ts --dry-run
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { buildAreaPublishEntity } from "../src/lib/build-area-publish-entity";
import { buildRoutePublishEntity } from "../src/lib/build-route-publish-entity";
import { mapEntityId } from "../src/lib/area-entity-id";
import type { AreaTableRow } from "../src/lib/area-table-geometry";
import {
  lineFromAreaRoute,
  parseLatLngPair,
  ringFromAreaPoints,
  ringFromAreaRect,
} from "../src/lib/area-table-geometry";
import type { AreaDrawShape, LngLat } from "../src/lib/area-table-serialize";
import { mapAreaFallbackLabel, ROUTE_AREA_TYPE } from "../src/lib/area-table-serialize";
import { parsePublishEntityUpstream } from "../src/lib/parse-publish-entity-response";

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function resolveEntityApiBase(): string {
  const raw =
    process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
    "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).origin;
    } catch {
      /* fall through */
    }
  }
  if (/^[\w.-]+:\d+$/.test(raw)) return `http://${raw}`;
  return "http://192.168.18.141:8090";
}

function areaTypeToShape(areaType: number): AreaDrawShape | null {
  switch (areaType) {
    case 1:
      return "rect";
    case 2:
      return "circle";
    case 3:
      return "polygon";
    case 4:
      return "route";
    default:
      return null;
  }
}

function rowToLngLatPoints(row: AreaTableRow): LngLat[] | null {
  switch (row.area_type) {
    case 1: {
      const ring = ringFromAreaRect(row.area_rect);
      if (!ring?.length) return null;
      const open =
        ring.length > 1 &&
        ring[0]![0] === ring[ring.length - 1]![0] &&
        ring[0]![1] === ring[ring.length - 1]![1]
          ? ring.slice(0, -1)
          : ring;
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      for (const [lng, lat] of open) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
      return [
        { lng: minLng, lat: minLat },
        { lng: maxLng, lat: maxLat },
      ];
    }
    case 2: {
      const c = parseLatLngPair(row.start_point);
      const e = parseLatLngPair(row.end_point);
      if (!c || !e) return null;
      return [
        { lng: c.lng, lat: c.lat },
        { lng: e.lng, lat: e.lat },
      ];
    }
    case 3: {
      const ring = ringFromAreaPoints(row.area_points);
      if (!ring?.length) return null;
      const open =
        ring.length > 1 &&
        ring[0]![0] === ring[ring.length - 1]![0] &&
        ring[0]![1] === ring[ring.length - 1]![1]
          ? ring.slice(0, -1)
          : ring;
      return open.map(([lng, lat]) => ({ lng, lat }));
    }
    case 4: {
      const line = lineFromAreaRoute(row);
      if (!line || line.length < 2) return null;
      return line.map(([lng, lat]) => ({ lng, lat }));
    }
    default:
      return null;
  }
}

function rowDisplayName(row: AreaTableRow): string {
  const n = row.area_name != null ? String(row.area_name).trim() : "";
  return n || mapAreaFallbackLabel(row.group_id, row.area_id, row.area_type);
}

async function publishEntity(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; message: string; entityId?: string; code?: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let upstream: unknown = null;
  try {
    upstream = text ? JSON.parse(text) : null;
  } catch {
    upstream = { raw: text.slice(0, 300) };
  }
  const parsed = parsePublishEntityUpstream(upstream);
  if (!res.ok) {
    return {
      ok: false,
      message: parsed.message || `HTTP ${res.status}`,
      entityId: parsed.entityId,
      code: parsed.code,
    };
  }
  return {
    ok: parsed.ok,
    message: parsed.message,
    entityId: parsed.entityId ?? String(body.entityId ?? ""),
    code: parsed.code,
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  loadEnvLocal();

  const pgUrl = process.env.NEXUS_POSTGRES_URL?.trim();
  if (!pgUrl) {
    console.error("未配置 NEXUS_POSTGRES_URL（.env.local）");
    process.exit(1);
  }

  const publishUrl = `${resolveEntityApiBase()}/api/v1/publishEntity`;
  console.log(`Postgres: ${pgUrl.replace(/:[^:@/]+@/, ":****@")}`);
  console.log(`实体服务: ${publishUrl}`);
  if (dryRun) console.log("模式: --dry-run（仅预览，不请求上游）\n");

  const pool = new Pool({ connectionString: pgUrl, max: 2 });
  const r = await pool.query<AreaTableRow>(
    `SELECT group_id, area_id, COALESCE(group_name,'') AS group_name, COALESCE(area_name,'') AS area_name,
            area_type, COALESCE(start_point,'') AS start_point, COALESCE(end_point,'') AS end_point,
            COALESCE(area_rect,'') AS area_rect, COALESCE(area_points,'') AS area_points,
            COALESCE(line_color,'') AS line_color, COALESCE(line_width, 2) AS line_width
     FROM area_table
     ORDER BY group_id, area_id`,
  );
  await pool.end();

  const rows = r.rows;
  console.log(`共 ${rows.length} 条 area_table 记录\n`);

  let ok = 0;
  let fail = 0;
  let skip = 0;

  for (const row of rows) {
    const shape = areaTypeToShape(row.area_type);
    const eid = mapEntityId(row.group_id, row.area_id, row.area_type);
    const name = rowDisplayName(row);
    const kind = row.area_type === ROUTE_AREA_TYPE ? "航线" : "区域";

    if (!shape) {
      console.log(`[跳过] ${eid} 未知 area_type=${row.area_type}`);
      skip++;
      continue;
    }

    const points = rowToLngLatPoints(row);
    if (!points) {
      console.log(`[跳过] ${eid} ${name} — 几何解析失败`);
      skip++;
      continue;
    }

    const lineColor =
      row.line_color && String(row.line_color).trim()
        ? String(row.line_color).trim()
        : "#3b82f6";
    const lineWidth = Number(row.line_width) > 0 ? Number(row.line_width) : 2;

    const body =
      row.area_type === ROUTE_AREA_TYPE
        ? buildRoutePublishEntity({
            groupId: row.group_id,
            areaId: row.area_id,
            routeName: name,
            points,
          })
        : buildAreaPublishEntity({
            groupId: row.group_id,
            areaId: row.area_id,
            areaName: name,
            shape,
            points,
            lineColor,
            lineWidth,
          });

    if (!body) {
      console.log(`[跳过] ${eid} ${name} — 无法组包实体`);
      skip++;
      continue;
    }

    if (dryRun) {
      console.log(`[预览] ${kind} ${eid} «${name}» shape=${shape} points=${points.length}`);
      ok++;
      continue;
    }

    try {
      const result = await publishEntity(publishUrl, body);
      if (result.ok) {
        console.log(`[成功] ${eid} «${name}» — ${result.message}`);
        ok++;
      } else {
        console.log(
          `[失败] ${eid} «${name}» — ${result.message}${result.code != null ? ` (code=${result.code})` : ""}`,
        );
        fail++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[失败] ${eid} «${name}» — ${msg}`);
      fail++;
    }

    await new Promise((r) => setTimeout(r, 80));
  }

  console.log(`\n完成: 成功/预览 ${ok}, 失败 ${fail}, 跳过 ${skip}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

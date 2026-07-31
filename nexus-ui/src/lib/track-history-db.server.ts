/**
 * 从 PostgreSQL 拉取融合航迹历史点位（对海 `record_fused_track` / 对空 `record_air_fused_track`）。
 * 按 `unique_id`（界面 target_id）+ 回溯分钟数查询 `longitude` / `latitude`。
 *
 * 性能要点：时间下界用**绝对 timestamp**（勿用 NOW()-interval），
 * 以便 Timescale 在规划期做 chunk 剪枝。
 */
import { Pool } from "pg";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

export type TrackHistoryDomain = "sea" | "air";

export type TrackHistoryPoint = {
  lng: number;
  lat: number;
};

/** 滑块/输入上限：120 分钟 */
export const TRACK_HISTORY_MAX_MINUTES = 120;
const MAX_POINTS = 1200;
const MIN_MINUTES = 1;
const DEFAULT_MINUTES = 30;

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

function tableForDomain(domain: TrackHistoryDomain): "record_fused_track" | "record_air_fused_track" {
  return domain === "air" ? "record_air_fused_track" : "record_fused_track";
}

/** JS Date → PG `timestamp without time zone` 字面量（库内多为无时区） */
function toPgTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

export function clampTrackHistoryMinutes(minutes: number, maxMinutes: number): number {
  const max = Math.max(MIN_MINUTES, Math.min(TRACK_HISTORY_MAX_MINUTES, Math.floor(maxMinutes)));
  if (!Number.isFinite(minutes)) return Math.min(DEFAULT_MINUTES, max);
  return Math.min(max, Math.max(MIN_MINUTES, Math.floor(minutes)));
}

/**
 * 单次查询：指定分钟内的点 + 用同窗 MIN/MAX 估连续时长（上限 120 分钟）。
 */
export async function listTrackHistoryPointsFromDb(options: {
  uniqueIdStr: string;
  domain: TrackHistoryDomain;
  minutes: number;
}): Promise<{ points: TrackHistoryPoint[]; maxMinutes: number }> {
  const p = getPool();
  if (!p) return { points: [], maxMinutes: TRACK_HISTORY_MAX_MINUTES };

  const uid = options.uniqueIdStr.trim();
  if (!uid || !isDigits(uid)) return { points: [], maxMinutes: TRACK_HISTORY_MAX_MINUTES };

  const reqMinutes = Math.min(
    TRACK_HISTORY_MAX_MINUTES,
    Math.max(
      MIN_MINUTES,
      Math.floor(Number.isFinite(options.minutes) ? options.minutes : DEFAULT_MINUTES),
    ),
  );
  const table = tableForDomain(options.domain);
  const nowMs = Date.now();
  const startMs = nowMs - reqMinutes * 60_000;
  const startTs = toPgTimestamp(startMs);
  /** 桶宽：约 MAX_POINTS 覆盖时间窗 */
  const bucketSec = Math.max(1, Math.ceil((reqMinutes * 60) / MAX_POINTS));

  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '8000'");

    const ptsSql = `
      WITH sampled AS (
        SELECT time_bucket(($3::text || ' seconds')::interval, record_time) AS t,
               last(longitude, record_time) AS longitude,
               last(latitude, record_time) AS latitude
        FROM ${table}
        WHERE unique_id = $1::bigint
          AND record_time >= $2::timestamp
          AND longitude IS NOT NULL
          AND latitude IS NOT NULL
        GROUP BY 1
      ),
      meta AS (
        SELECT EXTRACT(EPOCH FROM (MAX(t) - MIN(t))) / 60.0 AS win_mins FROM sampled
      )
      SELECT s.longitude, s.latitude, m.win_mins
      FROM sampled s
      CROSS JOIN meta m
      WHERE s.longitude IS NOT NULL AND s.latitude IS NOT NULL
      ORDER BY s.t ASC
      LIMIT $4`;

    const r = await client.query<{
      longitude: number;
      latitude: number;
      win_mins: string | number | null;
    }>(ptsSql, [uid, startTs, String(bucketSec), MAX_POINTS]);

    const points: TrackHistoryPoint[] = [];
    let winMins = NaN;
    for (const row of r.rows) {
      if (winMins !== winMins && row.win_mins != null) {
        winMins = typeof row.win_mins === "number" ? row.win_mins : Number(row.win_mins);
      }
      const lng = Number(row.longitude);
      const lat = Number(row.latitude);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push({ lng, lat });
    }

    let maxMinutes =
      !Number.isFinite(winMins) || winMins < MIN_MINUTES
        ? MIN_MINUTES
        : Math.min(TRACK_HISTORY_MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil(winMins)));

    /** 当前窗几乎填满 → 再探满 120 分钟下界 */
    if (maxMinutes >= reqMinutes && reqMinutes < TRACK_HISTORY_MAX_MINUTES) {
      const probeStart = toPgTimestamp(nowMs - TRACK_HISTORY_MAX_MINUTES * 60_000);
      const meta = await client.query<{ mins: string | number | null }>(
        `SELECT EXTRACT(EPOCH FROM (MAX(record_time) - MIN(record_time))) / 60.0 AS mins
         FROM ${table}
         WHERE unique_id = $1::bigint
           AND record_time >= $2::timestamp
           AND longitude IS NOT NULL`,
        [uid, probeStart],
      );
      const raw = meta.rows[0]?.mins;
      const mins = typeof raw === "number" ? raw : raw != null ? Number(raw) : NaN;
      if (Number.isFinite(mins) && mins >= MIN_MINUTES) {
        maxMinutes = Math.min(TRACK_HISTORY_MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil(mins)));
      }
    }

    await client.query("COMMIT");
    return { points, maxMinutes };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

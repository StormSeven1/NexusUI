import { NextRequest } from "next/server";
import {
  listTrackHistoryPointsFromDb,
  TRACK_HISTORY_MAX_MINUTES,
  type TrackHistoryDomain,
} from "@/lib/track-history-db.server";

export const runtime = "nodejs";

function parseDomain(raw: string | null): TrackHistoryDomain | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "sea" || s === "air") return s;
  return null;
}

/**
 * GET /api/track-history?uniqueId=&domain=sea|air&minutes=30
 * 按 `unique_id` 查融合表历史点位（longitude/latitude）。
 * 兼容旧参数 `hours`（按小时×60 换算，再钳到 120）。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const uniqueId = sp.get("uniqueId")?.trim() ?? "";
  const domain = parseDomain(sp.get("domain"));
  const minutesRaw = Number(sp.get("minutes"));
  const hoursRaw = Number(sp.get("hours"));
  let minutes = 30;
  if (Number.isFinite(minutesRaw)) minutes = minutesRaw;
  else if (Number.isFinite(hoursRaw)) minutes = hoursRaw * 60;

  if (!uniqueId || !/^\d+$/.test(uniqueId)) {
    return Response.json(
      { ok: false, message: "uniqueId 须为纯数字", points: [], maxMinutes: TRACK_HISTORY_MAX_MINUTES },
      { status: 400 },
    );
  }
  if (!domain) {
    return Response.json(
      {
        ok: false,
        message: "domain 须为 sea 或 air",
        points: [],
        maxMinutes: TRACK_HISTORY_MAX_MINUTES,
      },
      { status: 400 },
    );
  }

  try {
    const { points, maxMinutes } = await listTrackHistoryPointsFromDb({
      uniqueIdStr: uniqueId,
      domain,
      minutes,
    });
    return Response.json({
      ok: true,
      uniqueId,
      domain,
      minutes,
      maxMinutes,
      count: points.length,
      points,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/track-history]", message);
    return Response.json(
      { ok: false, message, points: [], maxMinutes: TRACK_HISTORY_MAX_MINUTES },
      { status: 500 },
    );
  }
}

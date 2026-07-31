import { NextResponse } from "next/server";

import { getActiveSystemAlarmsViaGrpc } from "@/server/system-alarm-grpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/system-alarms — 代理 AlarmSys SystemAlarmService.GetActiveAlarms */
export async function GET() {
  try {
    const result = await getActiveSystemAlarmsViaGrpc();
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          target: result.target,
          alarms: [],
          error: result.error ?? "upstream_failed",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      target: result.target,
      alarms: result.alarms,
      serverTimeMs: result.serverTimeMs ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        alarms: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

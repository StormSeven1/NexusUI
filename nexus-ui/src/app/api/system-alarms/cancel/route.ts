import { NextResponse } from "next/server";

import { cancelSystemAlarmViaGrpc } from "@/server/system-alarm-grpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/system-alarms/cancel — 代理 AlarmSys SystemAlarmService.CancelAlarm */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      alarmId?: string;
      systemId?: string;
      reason?: string;
      timestampMs?: number;
      canceledTimeMs?: number;
    };
    const result = await cancelSystemAlarmViaGrpc({
      alarmId: body.alarmId ?? "",
      systemId: body.systemId ?? "",
      reason: body.reason,
      timestampMs: body.timestampMs,
      canceledTimeMs: body.canceledTimeMs,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          target: result.target,
          message: result.message,
          error: result.error ?? "cancel_failed",
        },
        { status: result.error?.startsWith("invalid_param") ? 400 : 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      target: result.target,
      message: result.message ?? "ok",
      serverTimeMs: result.serverTimeMs ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

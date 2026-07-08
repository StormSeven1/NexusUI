import { NextRequest, NextResponse } from "next/server";
import {
  getDrcSessionStatus,
  startHeartBeatSession,
  stopHeartBeatSession,
  stopStickSession,
  updateStickKeys,
  type UavStickKeys,
} from "@/lib/uav-control/uavDrcSession.server";

type DrcSessionBody = {
  action: "heartbeat_start" | "heartbeat_stop" | "stick_update" | "stick_stop" | "status";
  airportSN: string;
  keys?: Partial<UavStickKeys>;
};

const EMPTY_KEYS: UavStickKeys = { Q: false, W: false, E: false, A: false, S: false, D: false, Z: false, C: false };

function normalizeKeys(raw: Partial<UavStickKeys> | undefined): UavStickKeys {
  return {
    Q: Boolean(raw?.Q),
    W: Boolean(raw?.W),
    E: Boolean(raw?.E),
    A: Boolean(raw?.A),
    S: Boolean(raw?.S),
    D: Boolean(raw?.D),
    Z: Boolean(raw?.Z),
    C: Boolean(raw?.C),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DrcSessionBody;
    const airportSN = (body.airportSN ?? "").trim();
    if (!airportSN) {
      return NextResponse.json({ ok: false, detail: "missing_airportSN" });
    }

    switch (body.action) {
      case "heartbeat_start":
        startHeartBeatSession(airportSN);
        return NextResponse.json({ ok: true, ...getDrcSessionStatus(airportSN) });
      case "heartbeat_stop":
        stopHeartBeatSession(airportSN);
        return NextResponse.json({ ok: true, ...getDrcSessionStatus(airportSN) });
      case "stick_update": {
        const keys = normalizeKeys(body.keys ?? EMPTY_KEYS);
        updateStickKeys(airportSN, keys);
        return NextResponse.json({ ok: true, ...getDrcSessionStatus(airportSN) });
      }
      case "stick_stop":
        stopStickSession(airportSN);
        return NextResponse.json({ ok: true, ...getDrcSessionStatus(airportSN) });
      case "status":
        return NextResponse.json({ ok: true, ...getDrcSessionStatus(airportSN) });
      default:
        return NextResponse.json({ ok: false, detail: "unknown_action" });
    }
  } catch (e) {
    return NextResponse.json({
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { deleteCamConfFromLine, type CalcRecordKind } from "@/lib/eo-calc-record/eoCalcRecordStorage.server";

export const runtime = "nodejs";

function parseCameraIndex(raw: string): number | null {
  const m = raw.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      entityId?: string;
      kind?: string;
      startLine?: number;
    };
    const entityId = String(body.entityId ?? "").trim();
    const kindRaw = String(body.kind ?? "sea").trim().toLowerCase();
    const startLine = Math.trunc(Number(body.startLine));
    const cameraIndex = parseCameraIndex(entityId);
    if (cameraIndex == null || !Number.isFinite(startLine) || startLine < 1) {
      return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }
    const kind: CalcRecordKind = kindRaw === "sky" ? "sky" : "sea";
    const ok = await deleteCamConfFromLine(cameraIndex, kind, startLine);
    return NextResponse.json({ ok });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "delete_failed", detail }, { status: 500 });
  }
}

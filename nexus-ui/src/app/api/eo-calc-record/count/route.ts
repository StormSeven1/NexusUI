import { NextRequest, NextResponse } from "next/server";
import { camConfAbsPath, countCamConfLines, type CalcRecordKind } from "@/lib/eo-calc-record/eoCalcRecordStorage.server";

export const runtime = "nodejs";

function parseCameraIndex(raw: string): number | null {
  const m = raw.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function GET(req: NextRequest) {
  const entityId = (req.nextUrl.searchParams.get("entityId") ?? "").trim();
  const kindRaw = (req.nextUrl.searchParams.get("kind") ?? "sea").trim().toLowerCase();
  const cameraIndex = parseCameraIndex(entityId);
  if (cameraIndex == null) {
    return NextResponse.json({ ok: false, error: "invalid_entity_id" }, { status: 400 });
  }
  const kind: CalcRecordKind = kindRaw === "sky" ? "sky" : "sea";
  const totalLines = await countCamConfLines(cameraIndex, kind);
  return NextResponse.json({
    ok: true,
    totalLines,
    nextSeq: kind === "sea" ? totalLines + 1 : undefined,
    nextLine: totalLines + 1,
    camConfPath: camConfAbsPath(cameraIndex, kind),
  });
}

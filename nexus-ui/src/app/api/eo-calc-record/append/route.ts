import { NextRequest, NextResponse } from "next/server";
import {
  appendCamConfLine,
  countCamConfLines,
  saveRecordPic,
  type CalcRecordKind,
} from "@/lib/eo-calc-record/eoCalcRecordStorage.server";

export const runtime = "nodejs";

function parseCameraIndex(raw: string): number | null {
  const m = raw.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const entityId = String(form.get("entityId") ?? "").trim();
    const kindRaw = String(form.get("kind") ?? "sea").trim().toLowerCase();
    const line = String(form.get("line") ?? "").trim();
    const cameraName = String(form.get("cameraName") ?? "").trim();
    const recordTime = String(form.get("recordTime") ?? "").trim();

    const cameraIndex = parseCameraIndex(entityId);
    if (cameraIndex == null) {
      return NextResponse.json({ ok: false, error: "invalid_entity_id" }, { status: 400 });
    }
    const kind: CalcRecordKind = kindRaw === "sky" ? "sky" : "sea";
    if (!line) {
      return NextResponse.json({ ok: false, error: "empty_line" }, { status: 400 });
    }

    const result = await appendCamConfLine(cameraIndex, kind, line);
    let imagePath: string | undefined;
    const image = form.get("image");
    if (image instanceof File && image.size > 0) {
      const bytes = Buffer.from(await image.arrayBuffer());
      const base = recordTime.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40) || `rec_${Date.now()}`;
      imagePath = await saveRecordPic({
        cameraName: cameraName || entityId,
        fileBaseName: base,
        bytes,
      });
    }

    return NextResponse.json({
      ok: true,
      lineNo: result.lineNo,
      seq: result.seq,
      totalLines: await countCamConfLines(cameraIndex, kind),
      imagePath,
      camConfPath: result.path,
      mode: "append",
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "append_failed", detail }, { status: 500 });
  }
}

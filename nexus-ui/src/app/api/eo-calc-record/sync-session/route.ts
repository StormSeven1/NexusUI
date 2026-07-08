import { NextRequest, NextResponse } from "next/server";
import {
  appendCamConfLinesBatch,
  countCamConfLines,
  saveRecordPic,
  type CalcRecordKind,
} from "@/lib/eo-calc-record/eoCalcRecordStorage.server";

export const runtime = "nodejs";
export const maxDuration = 120;

function parseCameraIndex(raw: string): number | null {
  const m = raw.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type SyncSample = { line?: string; recordTime?: string };

type SyncPayload = {
  entityId?: string;
  kind?: string;
  samples?: SyncSample[];
  cameraName?: string;
};

async function parseSyncPayload(req: NextRequest): Promise<{
  payload: SyncPayload;
  imageFiles: Map<number, File>;
}> {
  const ct = req.headers.get("content-type") ?? "";
  const imageFiles = new Map<number, File>();

  if (ct.includes("application/json")) {
    const payload = (await req.json()) as SyncPayload;
    return { payload, imageFiles };
  }

  const form = await req.formData();
  const payloadRaw = String(form.get("payload") ?? "").trim();
  if (!payloadRaw) {
    throw new Error("missing_payload");
  }
  const payload = JSON.parse(payloadRaw) as SyncPayload;
  const cameraName = String(form.get("cameraName") ?? "").trim();
  if (cameraName) payload.cameraName = cameraName;

  for (const [key, value] of form.entries()) {
    const m = key.match(/^image_(\d+)$/);
    if (m && value instanceof File && value.size > 0) {
      imageFiles.set(Number(m[1]), value);
    }
  }

  return { payload, imageFiles };
}

export async function POST(req: NextRequest) {
  try {
    const { payload, imageFiles } = await parseSyncPayload(req);
    const entityId = String(payload.entityId ?? "").trim();
    const kindRaw = String(payload.kind ?? "sea").trim().toLowerCase();
    const samples = Array.isArray(payload.samples) ? payload.samples : [];
    const cameraName = String(payload.cameraName ?? "").trim();

    const cameraIndex = parseCameraIndex(entityId);
    if (cameraIndex == null) {
      return NextResponse.json({ ok: false, error: "invalid_entity_id" }, { status: 400 });
    }
    const kind: CalcRecordKind = kindRaw === "sky" ? "sky" : "sea";
    if (samples.length === 0) {
      return NextResponse.json({ ok: false, error: "empty_samples" }, { status: 400 });
    }

    const rawLines = samples.map((s) => String(s?.line ?? "").trim()).filter(Boolean);
    const batch = await appendCamConfLinesBatch(cameraIndex, kind, rawLines);

    const imagePaths: (string | undefined)[] = [];
    for (let i = 0; i < samples.length; i++) {
      const image = imageFiles.get(i);
      if (!(image instanceof File) || image.size === 0) {
        imagePaths.push(undefined);
        continue;
      }
      const recordTime = String(samples[i]?.recordTime ?? "").trim();
      try {
        const bytes = Buffer.from(await image.arrayBuffer());
        const base = recordTime.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40) || `rec_${Date.now()}`;
        imagePaths.push(
          await saveRecordPic({
            cameraName: cameraName || entityId,
            fileBaseName: base,
            bytes,
          }),
        );
      } catch {
        imagePaths.push(undefined);
      }
    }

    return NextResponse.json({
      ok: true,
      writtenCount: batch.lines.length,
      firstLineNo: batch.firstLineNo,
      lastLineNo: batch.lastLineNo,
      lines: batch.lines.map((line, i) => ({
        ...line,
        imagePath: imagePaths[i],
      })),
      totalLines:
        batch.mode === "nfs" ? await countCamConfLines(cameraIndex, kind) : batch.lastLineNo,
      camConfPath: batch.path,
      mode: batch.mode,
      stagingHint: batch.stagingHint,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const status = detail === "missing_payload" || detail === "no_valid_lines" ? 400 : 500;
    return NextResponse.json({ ok: false, error: "sync_failed", detail }, { status });
  }
}

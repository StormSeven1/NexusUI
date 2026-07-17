import { NextRequest, NextResponse } from "next/server";
import { uploadBirdRadarCsvFile } from "@/lib/bird-radar-capture-upload.server";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeCsvName(input: string): string {
  const cleaned = (input || "").trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
  const base = cleaned || `radar_${Date.now()}.csv`;
  return base.endsWith(".csv") ? base : `${base}.csv`;
}

/** POST multipart: file + fileName → DataLink 探鸟雷达 CSV 上传 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const fileNameRaw = String(form.get("fileName") ?? "").trim();
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: "缺少 CSV 文件" }, { status: 400 });
    }
    const fileName = safeCsvName(fileNameRaw || file.name);
    const fileBytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadBirdRadarCsvFile({ fileBytes, fileName });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, detail: result.detail, steps: result.steps },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, repoPath: result.repoPath, steps: result.steps });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "bird_radar_upload_exception", detail }, { status: 500 });
  }
}

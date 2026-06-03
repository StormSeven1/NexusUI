import { NextRequest, NextResponse } from "next/server";
import {
  isEoCollectUploadType,
  uploadEoCaptureCollectFile,
  type EoCollectDataType,
} from "@/lib/eo-video/eoCaptureCollectUpload.server";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeFileName(input: string): string {
  const cleaned = (input || "").trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
  return cleaned || `capture_${Date.now()}.bin`;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const uploadTypeRaw = String(form.get("uploadType") ?? "").trim();
    const dataTypeRaw = String(form.get("dataType") ?? "原始数据").trim();

    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: "缺少文件或文件为空" }, { status: 400 });
    }
    if (!isEoCollectUploadType(uploadTypeRaw)) {
      return NextResponse.json({ ok: false, error: "无效 uploadType" }, { status: 400 });
    }
    const dataType: EoCollectDataType = dataTypeRaw === "预处理数据" ? "预处理数据" : "原始数据";

    const fileName = safeFileName(file.name);
    const fileBytes = Buffer.from(await file.arrayBuffer());

    const result = await uploadEoCaptureCollectFile({
      fileBytes,
      fileName,
      uploadType: uploadTypeRaw,
      dataType,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, steps: result.steps },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      repoPath: result.repoPath,
      steps: result.steps,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "collect_upload_exception", detail }, { status: 500 });
  }
}

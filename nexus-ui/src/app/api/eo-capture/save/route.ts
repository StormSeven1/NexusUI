import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_PIC_ROOT = "C:\\watch_data\\pic";
const DEFAULT_VIDEO_ROOT = "C:\\watch_data\\video";

function safeSegment(input: string, fallback: string): string {
  const s = input
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return s || fallback;
}

function safeFileName(input: string, fallbackExt: string): string {
  const raw = (input || "").trim();
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
  if (!cleaned) return `capture_${Date.now()}.${fallbackExt}`;
  return cleaned;
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kindRaw = (searchParams.get("kind") ?? "").trim().toLowerCase();
    const streamLabelRaw = searchParams.get("streamLabel") ?? "";
    const fileNameRaw = searchParams.get("fileName") ?? "";

    if (kindRaw !== "snapshot" && kindRaw !== "record") {
      return NextResponse.json({ ok: false, error: "invalid_kind" }, { status: 400 });
    }

    const kind = kindRaw as "snapshot" | "record";
    const streamDir = safeSegment(streamLabelRaw, "光电");
    const root =
      kind === "snapshot"
        ? (process.env.NEXUS_EO_CAPTURE_PIC_DIR ?? DEFAULT_PIC_ROOT)
        : (process.env.NEXUS_EO_CAPTURE_VIDEO_DIR ?? DEFAULT_VIDEO_ROOT);
    const targetDir = path.join(root, streamDir);

    const fallbackExt = kind === "snapshot" ? "png" : "webm";
    const fileName = safeFileName(fileNameRaw, fallbackExt);
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ ok: false, error: "empty_body" }, { status: 400 });
    }

    await mkdir(targetDir, { recursive: true });
    const finalPath = path.join(targetDir, fileName);
    await writeFile(finalPath, bytes);

    return NextResponse.json({ ok: true, path: finalPath });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "save_capture_failed", detail }, { status: 500 });
  }
}


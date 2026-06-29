import { randomBytes } from "crypto";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { unlink, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function resolveFfmpegBin(): string {
  const fromEnv = process.env.NEXUS_SPEECH_FFMPEG_BIN?.trim();
  if (fromEnv) return fromEnv;
  for (const candidate of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
    if (candidate === "ffmpeg" || existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
}

const FFMPEG_BIN = resolveFfmpegBin();const CONVERT_MS = 120_000;

function baseMime(mimeType: string): string {
  return mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

export function isWavSpeechInput(mimeType: string, fileName: string): boolean {
  const mt = baseMime(mimeType);
  if (mt === "audio/wav" || mt === "audio/x-wav" || mt === "audio/wave") return true;
  return fileName.trim().toLowerCase().endsWith(".wav");
}

function inputExtension(mimeType: string, fileName: string): string {
  const lower = fileName.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot >= 0 && dot < lower.length - 1) return lower.slice(dot + 1);

  const mt = baseMime(mimeType);
  if (mt.includes("webm")) return "webm";
  if (mt.includes("wav")) return "wav";
  if (mt.includes("mpeg") || mt.includes("mp3")) return "mp3";
  if (mt.includes("ogg")) return "ogg";
  if (mt.includes("mp4") || mt.includes("m4a")) return "m4a";
  return "webm";
}

/** 浏览器 webm/opus 等 → 16kHz mono wav（Qwen3-ASR Mode 2 可读） */
export async function convertSpeechToWav16k(
  input: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ wav: Buffer; error?: string }> {
  if (!input.byteLength) return { wav: input, error: "音频为空" };

  const id = randomBytes(8).toString("hex");
  const ext = inputExtension(mimeType, fileName);
  const inPath = join(tmpdir(), `nexus-asr-in-${id}.${ext}`);
  const outPath = join(tmpdir(), `nexus-asr-out-${id}.wav`);

  try {
    await writeFile(inPath, input);
    await execFileAsync(
      FFMPEG_BIN,
      ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", outPath],
      { timeout: CONVERT_MS },
    );
    const wav = await readFile(outPath);
    if (!wav.byteLength) return { wav, error: "音频转码结果为空" };
    return { wav };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      wav: input,
      error: msg.includes("ENOENT")
        ? `未找到 ffmpeg（${FFMPEG_BIN}），无法转换录音格式；请在 Docker 容器内安装 ffmpeg 或设置 NEXUS_SPEECH_FFMPEG_BIN`
        : `音频转码失败: ${msg}`,
    };  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

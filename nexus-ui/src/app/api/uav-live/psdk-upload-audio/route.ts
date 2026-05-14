import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";

const LOGIN_MS = 15000;
const UPSTREAM_MS = 12000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, stage: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${stage}:timeout`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loginAndGetToken(base: string): Promise<string> {
  const username = process.env.NEXUS_DRONE_PLATFORM_USERNAME ?? "adminPC";
  const password = process.env.NEXUS_DRONE_PLATFORM_PASSWORD ?? "adminPC";
  const loginRes = await fetchWithTimeout(
    `${base}/manage/api/v1/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password, flag: 1 }),
      cache: "no-store",
    },
    LOGIN_MS,
    "upload_audio_login",
  );
  const loginText = await loginRes.text().catch(() => "");
  if (!loginRes.ok) {
    throw new Error(`login_${loginRes.status}:${loginText.slice(0, 200)}`);
  }
  const loginJson = loginText ? (JSON.parse(loginText) as Record<string, unknown>) : {};
  const data = (loginJson.data ?? {}) as Record<string, unknown>;
  const tk = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!tk) throw new Error(`login_no_access_token:${loginText.slice(0, 240)}`);
  return tk;
}

/**
 * `UAV_CTRL_UPLOADAUDIO_FMT`：`{base}/api4third/control/api/v1/payload/psdk/upload-audio`
 * multipart 字段名 `file`（与 WatchSys CURL 一致）。返回服务端 JSON 解析出的 file_id（在 `data`）及本地计算的 md5，
 * 便于随后调用 `speaker_audio_play_start`。
 */
export async function POST(req: NextRequest) {
  const base = getDronePlatformBaseUrl();
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
    }

    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const md5hex = crypto.createHash("md5").update(buf).digest("hex");
    const name =
      typeof (file as Blob & { name?: string }).name === "string" && (file as Blob & { name?: string }).name
        ? (file as Blob & { name?: string }).name!
        : "record.webm";

    const token = await loginAndGetToken(base);
    const upstreamUrl = `${base}/api4third/control/api/v1/payload/psdk/upload-audio`;

    const out = new FormData();
    const nodeFile = new File([buf], name, {
      type: file.type || "application/octet-stream",
    });
    out.append("file", nodeFile);

    const upstream = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "x-auth-token": token,
        },
        body: out,
        cache: "no-store",
      },
      UPSTREAM_MS,
      "upload_audio",
    );

    const text = await upstream.text().catch(() => "");
    let message = "";
    let fileId = "";
    try {
      const j = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      message = typeof j.message === "string" ? j.message : "";
      if (typeof j.data === "string") fileId = j.data.trim();
      else if (j.data != null && typeof j.data === "object" && typeof (j.data as { file_id?: string }).file_id === "string")
        fileId = String((j.data as { file_id: string }).file_id).trim();
    } catch {
      /* ignore */
    }

    const ok = upstream.ok && message === "success" && !!fileId;
    return NextResponse.json(
      {
        ok,
        md5: md5hex,
        fileId,
        message: message || undefined,
        detail: text.slice(0, 1200),
      },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "upload_audio_exception", detail }, { status: 500 });
  }
}

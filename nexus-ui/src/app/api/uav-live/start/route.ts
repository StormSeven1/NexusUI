import { NextRequest, NextResponse } from "next/server";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";

const LOGIN_MS = 15000;
const UPSTREAM_MS = 12000;

/**
 * 对齐 WatchSys：`customconfig.h` START_LIVE_STREAM_FMT
 * POST `/api4third/manage/api/v1/live/streams/start`
 * body: { device_sn, payload_index, url_type, video_quality } + x-auth-token
 * 参见 `ptzmainwidget.cpp` sendStartLiveStream。
 */

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
    "live_start_login",
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

/** 与 C++ 一致：rtmp 1935 → rtsp 8554 */
function normalizeStreamUrl(raw: string): string {
  let u = raw.trim();
  if (/rtmp/i.test(u) && u.includes("1935")) {
    u = u.replace(/rtmp/gi, "rtsp").replace(/1935/g, "8554");
  }
  return u;
}

export async function POST(req: NextRequest) {
  const base = getDronePlatformBaseUrl();
  try {
    const body = (await req.json()) as {
      deviceSn?: string;
      payloadIndex?: string;
      urlType?: number;
      videoQuality?: number;
    };

    const device_sn = String(body.deviceSn ?? "").trim();
    const payload_index = String(body.payloadIndex ?? "").trim();
    const url_type = Number.isFinite(body.urlType) ? Number(body.urlType) : 1;
    const video_quality = Number.isFinite(body.videoQuality) ? Number(body.videoQuality) : 0;

    if (!device_sn || !payload_index) {
      return NextResponse.json({ ok: false, error: "missing_device_sn_or_payload_index" }, { status: 400 });
    }

    const token = await loginAndGetToken(base);
    const upstreamUrl = `${base}/api4third/manage/api/v1/live/streams/start`;

    const upstream = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-auth-token": token,
        },
        body: JSON.stringify({
          device_sn,
          payload_index,
          url_type,
          video_quality,
        }),
        cache: "no-store",
      },
      UPSTREAM_MS,
      "live_streams_start",
    );

    const text = await upstream.text().catch(() => "");
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* 非 JSON */
      }
    }

    const message = typeof json.message === "string" ? json.message : "";

    if (message === "success") {
      const data = (json.data ?? {}) as Record<string, unknown>;
      const raw = typeof data.url === "string" ? data.url.trim() : "";
      if (!raw) {
        return NextResponse.json({
          ok: false,
          error: "live_start_success_but_no_url",
          detail: text.slice(0, 800),
          platformHttpStatus: upstream.status,
        });
      }
      const rawUrl = normalizeStreamUrl(raw);
      return NextResponse.json({
        ok: true,
        rawUrl,
        message,
      });
    }

    /** C++：`The camera has started live streaming.` 视为已在推（无新 url仍继续拉 ZLM/WebRTC） */
    if (/already started/i.test(message) || message.includes("The camera has started live streaming")) {
      return NextResponse.json({
        ok: true,
        rawUrl: "",
        message,
        hint: "already_streaming_no_url",
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "live_streams_start_upstream",
        upstreamMessage: message || text.slice(0, 300),
        platformHttpStatus: upstream.status,
      },
      { status: upstream.ok ? 502 : upstream.status >= 400 ? upstream.status : 502 },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "live_streams_start_exception", detail }, { status: 500 });
  }
}

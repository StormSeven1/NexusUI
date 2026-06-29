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
    "switch_video_login",
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
 * WatchSys `switchboard::sendSwitchCameraRequest` →
 * `POST /api4third/manage/api/v1/live/streams/switch`
 */
export async function POST(req: NextRequest) {
  const base = getDronePlatformBaseUrl();
  try {
    const body = (await req.json()) as {
      deviceSn?: string;
      payloadIndex?: string;
      videoType?: string;
    };

    const device_sn = String(body.deviceSn ?? "").trim();
    const payload_index = String(body.payloadIndex ?? "").trim();
    const video_type = String(body.videoType ?? "").trim();

    if (!device_sn || !payload_index) {
      return NextResponse.json({ ok: false, error: "missing_device_sn_or_payload_index" }, { status: 400 });
    }
    if (!video_type || !/^(wide|zoom|ir)$/i.test(video_type)) {
      return NextResponse.json({ ok: false, error: "invalid_video_type" }, { status: 400 });
    }

    const token = await loginAndGetToken(base);
    const upstreamUrl = `${base}/api4third/manage/api/v1/live/streams/switch`;

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
          video_type: video_type.toLowerCase(),
        }),
        cache: "no-store",
      },
      UPSTREAM_MS,
      "live_streams_switch",
    );

    const text = await upstream.text().catch(() => "");
    let message = "";
    if (text) {
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        message = typeof j.message === "string" ? j.message : "";
      } catch {
        message = text.slice(0, 200);
      }
    }

    const ok = upstream.ok && (message === "success" || message === "");
    return NextResponse.json(
      {
        ok,
        message: message || (ok ? "success" : ""),
        detail: text.slice(0, 800),
        status: upstream.status,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "switch_video_exception", detail }, { status: 500 });
  }
}

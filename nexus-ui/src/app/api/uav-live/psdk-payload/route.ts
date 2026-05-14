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
    "psdk_login",
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
 * WatchSys：`UAV_CTRL_PAYLOAD` → `{base}/api4third/control/api/v1/payload/psdk/commands`
 * 见 `PtzMainWidget::{OpenLighter,ShutDownLighter,sendQuickUAVSpeakerVoice}` 等同构 JSON：`gateway_sn` + `cmd` + `data`。
 */
export async function POST(req: NextRequest) {
  const base = getDronePlatformBaseUrl();
  try {
    const body = (await req.json()) as {
      gatewaySn?: string;
      cmd?: string;
      data?: Record<string, unknown>;
    };

    const gateway_sn = String(body.gatewaySn ?? "").trim();
    const cmd = String(body.cmd ?? "").trim();
    const data =
      body.data != null && typeof body.data === "object" && !Array.isArray(body.data)
        ? body.data
        : {};

    if (!gateway_sn) {
      return NextResponse.json({ ok: false, error: "missing_gateway_sn" }, { status: 400 });
    }
    if (!cmd) {
      return NextResponse.json({ ok: false, error: "missing_cmd" }, { status: 400 });
    }

    const token = await loginAndGetToken(base);
    const upstreamUrl = `${base}/api4third/control/api/v1/payload/psdk/commands`;

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
          gateway_sn,
          cmd,
          data,
        }),
        cache: "no-store",
      },
      UPSTREAM_MS,
      "psdk_commands",
    );

    const text = await upstream.text().catch(() => "");
    let message = "";
    try {
      const j = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      message = typeof j.message === "string" ? j.message : "";
    } catch {
      /* ignore */
    }
    const commandOk = upstream.ok && message === "success";

    return NextResponse.json(
      {
        ok: commandOk,
        status: upstream.status,
        message: message || undefined,
        detail: text.slice(0, 1200),
      },
      { status: commandOk ? 200 : upstream.ok ? 200 : 502 },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "psdk_payload_exception", detail }, { status: 500 });
  }
}

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
    "gimbal_reset_login",
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
 * 对齐 `PtzMainWidget::onUavCamCtrl`：
 * `POST .../api4third/control/api/v1/devices/payload/commands`
 * `cmd`=`gimbal_reset`，`data` 含 `reset_mode`（0 回中 / 1 向下）与 `payload_index`。
 */
export async function POST(req: NextRequest) {
  const base = getDronePlatformBaseUrl();
  try {
    const body = (await req.json()) as {
      deviceSn?: string;
      payloadIndex?: string;
      resetMode?: number;
    };

    const device_sn = String(body.deviceSn ?? "").trim();
    const payload_index = String(body.payloadIndex ?? "").trim();
    const resetMode = Number(body.resetMode);

    if (!device_sn || !payload_index) {
      return NextResponse.json({ ok: false, error: "missing_device_sn_or_payload_index" }, { status: 400 });
    }
    if (resetMode !== 0 && resetMode !== 1) {
      return NextResponse.json({ ok: false, error: "invalid_reset_mode" }, { status: 400 });
    }

    const token = await loginAndGetToken(base);
    const upstreamUrl = `${base}/api4third/control/api/v1/devices/payload/commands`;

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
          cmd: "gimbal_reset",
          data: {
            reset_mode: resetMode,
            payload_index,
          },
        }),
        cache: "no-store",
      },
      UPSTREAM_MS,
      "gimbal_reset_cmd",
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
    return NextResponse.json({ ok: false, error: "gimbal_reset_exception", detail }, { status: 500 });
  }
}

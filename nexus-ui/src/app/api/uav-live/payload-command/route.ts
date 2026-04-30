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
    "payload_cmd_login",
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
 * 对齐 `WatchSys` `GIMBAL_RESET_URL` → `api4third/control/api/v1/devices/payload/commands`
 * `UavAimAt5`：`cmd`=`camera_aim`，`data` 含 `payload_index` / `camera_type` / `locked` / `x` / `y`
 */
export async function POST(req: NextRequest) {
  const base = getDronePlatformBaseUrl();
  try {
    const body = (await req.json()) as {
      deviceSn?: string;
      payloadIndex?: string;
      x?: number;
      y?: number;
      cameraType?: string;
      locked?: boolean;
      cmd?: string;
    };

    const device_sn = String(body.deviceSn ?? "").trim();
    const payload_index = String(body.payloadIndex ?? "").trim();
    const cmd = String(body.cmd ?? "camera_aim").trim() || "camera_aim";
    const x = Number(body.x);
    const y = Number(body.y);
    const camera_type = String(body.cameraType ?? "zoom").trim() || "zoom";
    const locked = Boolean(body.locked);

    if (!device_sn || !payload_index) {
      return NextResponse.json({ ok: false, error: "missing_device_sn_or_payload_index" }, { status: 400 });
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ ok: false, error: "invalid_x_y" }, { status: 400 });
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
          cmd,
          data: {
            payload_index,
            camera_type,
            locked,
            x,
            y,
          },
        }),
        cache: "no-store",
      },
      UPSTREAM_MS,
      "payload_commands",
    );

    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        detail: text.slice(0, 1200),
      },
      { status: upstream.ok ? 200 : 502 },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "payload_command_exception", detail }, { status: 500 });
  }
}

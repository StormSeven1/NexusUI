import { NextRequest, NextResponse } from "next/server";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";

/**
 * 无人机控制授权 API
 * 对应 C++ UAV_CTRL_CONNECT → UAV_CTRL_ENTER / UAV_CTRL_EXIT 三步流程
 */

interface DroneCtrlInfo {
  address: string;
  username: string;
  password: string;
  client_id: string;
  expire_time: string;
  enable_tls: string;
}

interface AuthRequestBody {
  action: "connect" | "enter" | "exit";
  airportSN: string;
  /** connect 步骤返回的 client_id，enter/exit 时必需 */
  clientId?: string;
}

interface AuthResponse {
  ok: boolean;
  action: "connect" | "enter" | "exit";
  /** connect 成功返回控制凭证 */
  ctrlInfo?: DroneCtrlInfo;
  message?: string;
  detail?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, stage: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${stage}_timeout_or_fetch_error: ${msg}`);
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
    15000,
    "uav_auth_login",
  );
  const loginText = await loginRes.text().catch(() => "");
  if (!loginRes.ok) throw new Error(`login_failed_${loginRes.status}: ${loginText.slice(0, 200)}`);
  const loginJson = loginText ? (JSON.parse(loginText) as Record<string, unknown>) : {};
  const data = (loginJson.data ?? {}) as Record<string, unknown>;
  const tk = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!tk) throw new Error(`login_no_access_token: ${loginText.slice(0, 200)}`);
  return tk;
}

async function postDroneAuth(
  url: string,
  body: Record<string, unknown>,
  token: string | null,
): Promise<{ ok: boolean; status: number; data?: unknown; message?: string }> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["x-auth-token"] = token;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // 私有云部分接口在异常时可能返回空 body，需避免直接 res.json() 抛错
    const raw = await res.text().catch(() => "");
    let data = {} as { message?: string; data?: unknown };
    if (raw) {
      try {
        data = JSON.parse(raw) as { message?: string; data?: unknown };
      } catch {
        data = {};
      }
    }
    return {
      ok: res.ok && data.message === "success",
      status: res.status,
      data: data.data,
      message: data.message,
    };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<AuthResponse>> {
  try {
    const body = (await req.json()) as AuthRequestBody;
    const { action, airportSN, clientId } = body;

    const base = getDronePlatformBaseUrl();
    const token = await loginAndGetToken(base);
    const baseUrl = `${base}/api4third/control/api/v1/workspaces/drc`;

    if (action === "connect") {
      // 步骤1：请求控制权，获取 MQTT 凭证
      const url = `${baseUrl}/connect`;
      const result = await postDroneAuth(url, { expire_sec: 3600 }, token);

      if (!result.ok || !result.data) {
        return NextResponse.json({
          ok: false,
          action,
          message: result.message || "connect_failed",
        });
      }

      const data = result.data as Record<string, unknown>;
      const ctrlInfo: DroneCtrlInfo = {
        address: String(data.address || ""),
        username: String(data.username || ""),
        password: String(data.password || ""),
        client_id: String(data.client_id || ""),
        expire_time: String(data.expire_time || ""),
        enable_tls: String(data.enable_tls || ""),
      };

      return NextResponse.json({ ok: true, action, ctrlInfo });
    }

    if (action === "enter") {
      // 步骤2：进入控制模式
      if (!clientId) {
        return NextResponse.json({
          ok: false,
          action,
          detail: "missing_clientId_for_enter",
        });
      }

      const url = `${baseUrl}/enter`;
      const result = await postDroneAuth(url, { client_id: clientId, dock_sn: airportSN }, token);

      return NextResponse.json({
        ok: result.ok,
        action,
        message: result.message,
      });
    }

    if (action === "exit") {
      // 步骤3：退出控制模式
      if (!clientId) {
        return NextResponse.json({
          ok: false,
          action,
          detail: "missing_clientId_for_exit",
        });
      }

      const url = `${baseUrl}/exit`;
      const result = await postDroneAuth(url, { client_id: clientId }, token);

      return NextResponse.json({
        ok: result.ok,
        action,
        message: result.message,
      });
    }

    return NextResponse.json({
      ok: false,
      action,
      detail: "unknown_action",
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      action: "connect",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

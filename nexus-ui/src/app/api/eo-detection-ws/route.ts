import { NextResponse } from "next/server";
import { resolveNginxTunnelWssHost } from "@/lib/wsTunnelHost";

/**
 * 返回检测框 WebSocket 候选地址（与 z_others public/config.json 一致：HTTP 8088 同机 WS 2088）。
 *
 * - `EO_DETECTION_WS_URL`：完整 ws/wss URL，优先使用
 * - 否则由 `NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL`（兼容旧 `CAMERA_ENTITY_BASE_URL`）推导 `ws(s)://{host}:2088`
 */
const DEFAULT_ENTITY_BASE = "http://192.168.18.141:8088";

function deriveWsFromEntityHttpBase(httpBase: string): string {
  const u = new URL(httpBase.replace(/\/$/, ""));
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.hostname}:2088`;
}

export async function GET(request: Request) {
  const base = (
    process.env.NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL ??
    process.env.CAMERA_ENTITY_BASE_URL ??
    DEFAULT_ENTITY_BASE
  ).replace(/\/$/, "");
  const explicit = process.env.EO_DETECTION_WS_URL?.trim();
  const derived = deriveWsFromEntityHttpBase(base);
  const tunnel = process.env.NEXT_PUBLIC_WS_USE_NGINX_TUNNEL === "true";
  const host = request.headers.get("host")?.trim();
  const xfProto = request.headers.get("x-forwarded-proto");
  const pageHttps = xfProto?.split(",")[0]?.trim().toLowerCase() === "https";
  /** 隧道模式下 WSS 须打到 Nginx 端口（非 Next dev :22301） */
  let viaNginx: string | null = null;
  if (tunnel && host && pageHttps) {
    const wssHost = resolveNginxTunnelWssHost(host);
    viaNginx = wssHost ? `wss://${wssHost}/wss-detection/` : null;
  }
  const urls = [...(explicit ? [explicit] : []), ...(viaNginx ? [viaNginx] : []), derived];
  const dedup = [...new Set(urls)];
  return NextResponse.json({ urls: dedup }, { headers: { "Cache-Control": "no-store" } });
}

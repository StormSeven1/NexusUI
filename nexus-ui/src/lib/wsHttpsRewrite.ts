/**
 * HTTPS + Nginx 同源 wss（与 prod-start-nginx.sh 中 /ws、/wss-track 等映射配合）。
 *
 * 默认 **不重写**，保持与加装 Nginx 之前一致：`app-config.json` 里写什么 WebSocket URL 就用什么，
 * 避免开发版 HTTPS、或不经 Nginx 反代时出现 `wss://当前页:wss-track/...` 打到 Next（无对应反代 → 航迹断开）。
 *
 * 仅当您使用 **`prod-start-nginx.sh`** 且页面必须从 **https:** 同源连后端明文 ws 时，在构建前配置：
 *   `NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=true`（写入 `.env.local` 后重新 `npm run build`）。
 * 开发环境页面在 **Next HTTPS :22301** 时，重写后的 WSS 会打到 **同主机 :22401**（见 `wsTunnelHost.ts`）；无 Nginx 时请关闭隧道或改用 HTTP 前端。
 *
 * prod-start-nginx.sh 将下列端口映射为同源 path（Nginx 终结 TLS 后反代到本机明文 WS）：
 *   /wss-track/      → TRACK_WS_BACKEND_PORT（`prod-start-nginx.sh` 默认 **同 BACKEND_PORT=27004**；dev 单机常为 **27003**，见 `PORT_PREFIX`）
 *   /ws              → BACKEND_PORT
 *   /wss-mqtt/       → MQTT_WS_BACKEND_PORT
 *   /wss-detection/  → EO_DETECTION_WS_BACKEND_PORT
 */

import { resolveNginxTunnelWssHost } from "@/lib/wsTunnelHost";

const PORT_PREFIX: Record<string, string> = {
  "26003": "/wss-track",
  /** xk_docker / 多环境常见航迹 WS 端口；与 26003 同源走 Nginx `location /wss-track/` */
  "27003": "/wss-track",
  "27004": "",
  "8083": "/wss-mqtt",
  "2088": "/wss-detection",
};

function useNginxTunnel(): boolean {
  if (typeof process === "undefined") return false;
  const v = (process.env.NEXT_PUBLIC_WS_USE_NGINX_TUNNEL ?? "").toLowerCase();
  return v === "true" || v === "1";
}

export function rewriteWsUrlForHttpsPage(wsUrl: string): string {
  if (!useNginxTunnel()) {
    return wsUrl;
  }
  if (typeof window === "undefined" || window.location.protocol !== "https:") {
    return wsUrl;
  }
  const raw = wsUrl.trim();
  if (!raw) return wsUrl;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return wsUrl;
  }
  if (u.protocol !== "ws:") {
    return wsUrl;
  }

  let page: URL;
  try {
    page = new URL(window.location.href);
  } catch {
    return wsUrl;
  }

  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  const hostOk = u.hostname === page.hostname || loopback.has(u.hostname);
  if (!hostOk) {
    return wsUrl;
  }

  const prefix = PORT_PREFIX[u.port];
  if (prefix === undefined) {
    return wsUrl;
  }

  const path = u.pathname.startsWith("/") ? u.pathname : `/${u.pathname}`;
  const search = u.search;
  const tail = path === "/" ? "/" : path;
  const newPath =
    prefix === ""
      ? `${tail}${search}`
      : `${prefix}${tail === "/" ? "/" : tail}${search}`;

  const tunnelHost =
    typeof window !== "undefined" ? resolveNginxTunnelWssHost(window.location.host) : resolveNginxTunnelWssHost(page.host);
  const target = tunnelHost || page.host;

  return `wss://${target}${newPath}`;
}

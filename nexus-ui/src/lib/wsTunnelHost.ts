/**
 * `NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=true` 时：WSS 路径（/ws、/wss-detection 等）由 **Nginx** 提供，
 * 不能与 Next HTTPS dev **同端口（常见 22301）**，否则会连到 Next 且无升级 → 控制台报 handshake 关闭。
 *
 * 端口映射：
 *   **:22301**（Next dev HTTPS）→ **:22402**（dev-wss-nginx）
 *   **:22411**（next start 内网）→ **:21911**（prod-start-nginx，仅无 Host 时的兜底）
 *   **生产 HTTPS 页**（:21911 日常 / :25311 演示）：WSS **与当前页同 host:port**（switch-site-mode 切换无需 rebuild）
 */
export function resolveNginxTunnelWssHost(pageHostHeader: string | undefined | null): string {
  const raw = (pageHostHeader ?? "").trim();

  // 开发 HTTPS :22301 → 独立 WSS 网关 :22402
  if (/:22301\b/.test(raw)) {
    return raw.replace(/:22301\b/, ":22402");
  }

  // 生产 / 演示 HTTPS：Nginx WSS 与页面同端口（避免构建时 NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT 写死 :21911）
  if (raw) {
    const inBrowser = typeof window !== "undefined";
    if (inBrowser && window.location.protocol === "https:") {
      return raw;
    }
    // BFF（如 /api/eo-detection-ws）经 Nginx 反代时 Host 即对外 HTTPS 端口
    if (!inBrowser && /:\d+$/.test(raw)) {
      return raw;
    }
  }

  const explicit =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT?.trim() ?? "" : "";
  if (explicit) {
    return explicit
      .replace(/^wss:\/\//i, "")
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.trim() ?? explicit;
  }
  if (!raw) return "";
  return raw
    .replace(/:22411\b/, ":21911")
    .replace(/:3000\b/, ":22402");
}

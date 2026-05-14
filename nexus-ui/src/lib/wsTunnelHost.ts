/**
 * `NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=true` 时：WSS 路径（/ws、/wss-detection 等）由 **Nginx** 提供，
 * 不能与 Next HTTPS dev **同端口（常见 22301）**，否则会连到 Next 且无升级 → 控制台报 handshake 关闭。
 *
 * 默认把页面 Host 里的 **:22301 / :22411 / :3000** 替换为 **:22401**（与 prod-start-nginx PUBLIC_HTTPS_PORT 对齐）。
 * 若 Nginx 监听其它端口：设 **`NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT`**，例如 `192.168.18.141:22401`。
 */
export function resolveNginxTunnelWssHost(pageHostHeader: string | undefined | null): string {
  const explicit =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT?.trim() ?? "" : "";
  if (explicit) {
    return explicit
      .replace(/^wss:\/\//i, "")
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.trim() ?? explicit;
  }
  const raw = (pageHostHeader ?? "").trim();
  if (!raw) return "";
  return raw.replace(/:22301\b/, ":22401").replace(/:22411\b/, ":22401").replace(/:3000\b/, ":22401");
}

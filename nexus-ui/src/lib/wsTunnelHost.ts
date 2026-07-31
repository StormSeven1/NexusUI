/**
 * `NEXT_PUBLIC_WS_USE_NGINX_TUNNEL=true` 时：WSS 路径（/ws、/wss-detection 等）由 **Nginx** 提供，
 * 不能与 Next HTTPS dev **同端口（常见 22301）**，否则会连到 Next 且无升级 → 控制台报 handshake 关闭。
 *
 * 端口映射：
 *   **:22301**（Next dev HTTPS）→ **:22402**（dev-wss-nginx）
 *   **:22411**（next start 内网）→ **:21911**（prod-start-nginx，仅无 Host 时的兜底）
 *   **生产 HTTPS 页**（:21911 日常 / :25311 演示）：WSS **与当前页同 host:port**（switch-site-mode 切换无需 rebuild）
 *
 * 注意：Nginx `$host` 会丢掉非默认端口；反代须用 `$http_host`。BFF 在 Host 无端口时用
 * `X-Forwarded-Port` / `NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT` 补全，避免拼出 `wss://IP/`（→443）。
 */

function stripUrlToHostPort(raw: string): string {
  return (
    raw
      .replace(/^wss:\/\//i, "")
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.trim() ?? raw
  );
}

function readExplicitTunnelHostPort(): string {
  if (typeof process === "undefined") return "";
  const explicit =
    process.env.NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT?.trim() ||
    process.env.NGINX_WS_PUBLIC_HOSTPORT?.trim() ||
    "";
  return explicit ? stripUrlToHostPort(explicit) : "";
}

/** Host 无端口时，用 X-Forwarded-Port 或显式配置补全（禁止落默认 443）。 */
export function ensureTunnelHostHasPort(
  host: string,
  forwardedPort?: string | null,
): string {
  const h = host.trim();
  if (!h || /:\d+$/.test(h)) return h;
  const xfPort = (forwardedPort ?? "").split(",")[0]?.trim() ?? "";
  if (/^\d+$/.test(xfPort) && xfPort !== "443" && xfPort !== "80") {
    return `${h}:${xfPort}`;
  }
  const explicit = readExplicitTunnelHostPort();
  if (explicit && /:\d+$/.test(explicit)) {
    const explicitHost = explicit.replace(/:\d+$/, "");
    if (!explicitHost || explicitHost === h) return explicit;
  }
  return h.replace(/:22411\b/, ":21911").replace(/:3000\b/, ":22402");
}

export function resolveNginxTunnelWssHost(
  pageHostHeader: string | undefined | null,
  opts?: { forwardedPort?: string | null },
): string {
  const raw = (pageHostHeader ?? "").trim();

  // 开发 HTTPS :22301 → 独立 WSS 网关 :22402
  if (/:22301\b/.test(raw)) {
    return raw.replace(/:22301\b/, ":22402");
  }

  // 生产 / 演示 HTTPS：Nginx WSS 与页面同端口（避免构建时 NEXT_PUBLIC_NGINX_WS_PUBLIC_HOSTPORT 写死 :21911）
  if (raw) {
    const inBrowser = typeof window !== "undefined";
    if (inBrowser && window.location.protocol === "https:") {
      return ensureTunnelHostHasPort(raw, opts?.forwardedPort);
    }
    // BFF（如 /api/eo-detection-ws）经 Nginx 反代时 Host 应带对外 HTTPS 端口
    if (!inBrowser && /:\d+$/.test(raw)) {
      return raw;
    }
    // Host 被 $host 剥端口时：优先 X-Forwarded-Port / 显式配置补全
    if (!inBrowser) {
      const patched = ensureTunnelHostHasPort(raw, opts?.forwardedPort);
      if (/:\d+$/.test(patched)) return patched;
    }
  }

  const explicit = readExplicitTunnelHostPort();
  if (explicit) {
    return ensureTunnelHostHasPort(explicit, opts?.forwardedPort);
  }
  if (!raw) return "";
  return ensureTunnelHostHasPort(
    raw.replace(/:22411\b/, ":21911").replace(/:3000\b/, ":22402"),
    opts?.forwardedPort,
  );
}

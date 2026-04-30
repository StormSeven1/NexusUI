/**
 * 将 ZLM 绝对信令地址转为同源 Next 代理路径，避免浏览器直连内网 IP 触发 CORS。
 * 仅处理 path 为 `/index/api/webrtc` 且目标为私网 IPv4 的 http(s) URL。
 */
export function isPrivateIPv4Host(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function toZlmProxySignalingUrl(absUrl: string): string | null {
  try {
    const u = new URL(absUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!isPrivateIPv4Host(u.hostname)) return null;
    if (!u.pathname.replace(/\/$/, "").endsWith("/index/api/webrtc")) return null;
    const stream = u.searchParams.get("stream");
    if (!stream) return null;
    const app = u.searchParams.get("app") ?? "live";
    const type = u.searchParams.get("type") ?? "play";
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const q = new URLSearchParams({
      host: u.hostname,
      port,
      app,
      stream,
      type,
    });
    return `/api/webrtc-zlm?${q.toString()}`;
  } catch {
    return null;
  }
}

/** 在浏览器中把外链 ZLM 信令改写为同源代理 */
export function rewriteSignalingUrlForBrowser(signalingUrl: string): string {
  if (typeof window === "undefined") return signalingUrl;
  try {
    const abs = new URL(signalingUrl, window.location.origin);
    if (abs.origin === window.location.origin) return signalingUrl;
    const proxied = toZlmProxySignalingUrl(abs.toString());
    return proxied ?? signalingUrl;
  } catch {
    return signalingUrl;
  }
}

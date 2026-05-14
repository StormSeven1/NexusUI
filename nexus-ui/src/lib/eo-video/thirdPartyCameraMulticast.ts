/**
 * 右键「光电」→「第三方相机」的 UDP 组播末端 `IPv4:port`。
 *
 * 浏览器无法收组播；同进程 Next（`instrumentation.ts`）会起中继：UDP → 紧凑 I420 → `ws://0.0.0.0:${EO_THIRD_PARTY_CAMERA_WS_PORT}`（默认 40777）。
 * 前端可用 `NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL` 指向 `ws(s)://主机:端口`，或 `NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_PORT` 与页面 `hostname` 拼 URL。
 */
export function getThirdPartyCameraMulticastUdp(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const raw = process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_MULTICAST_UDP?.trim();
  return raw ? raw : undefined;
}

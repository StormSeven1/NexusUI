/**
 * 与 z_others/base-vue-main VideoWall / videoPlayer 一致：
 * `webrtc://host:port/app/stream` → ZLM `POST .../index/api/webrtc?app=&stream=&type=play`
 */
export function signalingUrlFromWebrtcUrl(webrtcUrl: string): string {
  const trimmed = webrtcUrl.trim();
  if (!trimmed) throw new Error("Empty webrtcUrl");
  let parsed = trimmed;
  if (parsed.startsWith("webrtc://")) {
    parsed = parsed.slice("webrtc://".length);
  }
  const parts = parsed.split("/").filter(Boolean);
  const serverPort = parts[0];
  if (!serverPort) throw new Error("Invalid webrtcUrl: missing host:port");
  if (parts.length < 2) throw new Error("Invalid webrtcUrl: missing app");
  const app = parts[1] ?? "live";
  /** ZLM 的 stream 常为多级，如 livestream/7CTD...，须 join 而非只取 [2]（否则与 uav 配置不一致） */
  const stream = parts.length >= 3 ? parts.slice(2).join("/") : "livestream";
  if (!stream) throw new Error("Invalid webrtcUrl: empty stream");
  const q = new URLSearchParams({ app, stream, type: "play" });
  return `http://${serverPort}/index/api/webrtc?${q.toString()}`;
}

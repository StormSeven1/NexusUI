export function signalingUrlFromWebrtcUrl(webrtcUrl: string): string {
  const trimmed = webrtcUrl.trim();
  if (!trimmed) {
    throw new Error("Empty webrtcUrl");
  }

  let parsed = trimmed;
  if (parsed.startsWith("webrtc://")) {
    parsed = parsed.slice("webrtc://".length);
  }

  const parts = parsed.split("/").filter(Boolean);
  const serverPort = parts[0];
  if (!serverPort) {
    throw new Error("Invalid webrtcUrl: missing host:port");
  }
  if (parts.length < 2) {
    throw new Error("Invalid webrtcUrl: missing app");
  }

  const app = parts[1] ?? "live";
  const stream = parts.length >= 3 ? parts.slice(2).join("/") : "";
  if (!stream) {
    throw new Error("Invalid webrtcUrl: missing stream");
  }

  const query = new URLSearchParams({ app, stream, type: "play" });
  return `http://${serverPort}/index/api/webrtc?${query.toString()}`;
}

/**
 * Next 启动时在 Node 侧挂载查证专用端口（默认 7774），与 Qt TaskStatusHttp 一致。
 * @see src/server/task-status-http-listener.ts
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { startTaskStatusHttpListener } = await import("@/server/task-status-http-listener");
  startTaskStatusHttpListener();

  const { startEoThirdPartyCameraRelay } = await import("@/server/eo-third-party-camera-relay");
  startEoThirdPartyCameraRelay();
}

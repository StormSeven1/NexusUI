/**
 * Node-only startup hooks (must not be imported from Edge / client bundles).
 */
export async function registerNodeInstrumentation() {
  const { startTaskStatusHttpListener } = await import("@/server/task-status-http-listener");
  startTaskStatusHttpListener();

  const { startEoThirdPartyCameraRelay } = await import("@/server/eo-third-party-camera-relay");
  startEoThirdPartyCameraRelay();
}

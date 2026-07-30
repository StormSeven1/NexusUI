/**
 * Next 启动时在 Node 侧挂载查证专用端口（默认 7774），与 Qt TaskStatusHttp 一致。
 * Node 逻辑在 instrumentation.node.ts；Edge 构建由 next.config alias 置空。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNodeInstrumentation } = await import("./instrumentation.node");
  await registerNodeInstrumentation();
}

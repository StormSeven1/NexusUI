import type { TaskStatusChatPayload } from "@/lib/task-status-types";

const MAX_QUEUE = 100;

let queue: TaskStatusChatPayload[] = [];
const listeners = new Set<(p: TaskStatusChatPayload) => void>();

/**
 * 查证 SSE 在 AppShell 层常驻连接；无订阅者时先入队，打开对话后由 subscribe 回放。
 * 避免「智能助手未挂载 / 弹出为独立窗时右侧无 ChatPanel」导致永远收不到查证。
 */
export function publishTaskStatusChatPayload(p: TaskStatusChatPayload): void {
  if (listeners.size === 0) {
    queue.push(p);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    return;
  }
  for (const l of listeners) {
    try {
      l(p);
    } catch (e) {
      console.error("[task-status-chat-feed]", e);
    }
  }
}

export function subscribeTaskStatusChat(listener: (p: TaskStatusChatPayload) => void): () => void {
  listeners.add(listener);
  const pending = queue;
  queue = [];
  for (const item of pending) {
    try {
      listener(item);
    } catch (e) {
      console.error("[task-status-chat-feed] replay", e);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

export function resolveTaskStatusSseUrl(): string {
  const override = process.env.NEXT_PUBLIC_TASK_STATUS_STREAM_URL?.trim();
  if (override) return override;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  const path = `${base}/api/task-status-stream`;
  if (typeof window !== "undefined") {
    return new URL(path, window.location.origin).toString();
  }
  return path;
}

import { EventEmitter } from "events";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";

/**
 * 进程内事件总线：HTTP 接入路由与 SSE 流共享（与 Qt 单机 TCP 监听等价场景）。
 * 多实例/Serverless 部署需另行接入 Redis 等，此处按单 Node 进程假设。
 */
class TaskStatusBridge extends EventEmitter {
  emitPayload(p: TaskStatusChatPayload): void {
    this.emit("payload", p);
  }

  onPayload(handler: (p: TaskStatusChatPayload) => void): () => void {
    this.on("payload", handler);
    return () => {
      this.off("payload", handler);
    };
  }
}

const globalForBridge = globalThis as typeof globalThis & {
  __nexusTaskStatusBridge?: TaskStatusBridge;
};

export function getTaskStatusBridge(): TaskStatusBridge {
  if (!globalForBridge.__nexusTaskStatusBridge) {
    globalForBridge.__nexusTaskStatusBridge = new TaskStatusBridge();
  }
  return globalForBridge.__nexusTaskStatusBridge;
}

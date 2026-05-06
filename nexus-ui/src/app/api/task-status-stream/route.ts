import { NextRequest } from "next/server";
import { getTaskStatusBridge } from "@/lib/task-status-bridge";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/**
 * 浏览器 EventSource 订阅：相机管理回调写入 `/api/alarms/.../task-status` 后，由此推送到右侧会话。
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const bridge = getTaskStatusBridge();

  const stream = new ReadableStream({
    start(controller) {
      const write = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };

      write({ type: "connected", t: Date.now() });

      const onPayload = (p: TaskStatusChatPayload) => {
        write({ type: "task_status", payload: p });
      };

      const unsubscribe = bridge.onPayload(onPayload);

      req.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* noop */
          }
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

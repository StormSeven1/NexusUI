import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8001";

/**
 * SSE proxy adapter：
 * 接收 useChat 的请求 → 转发给 FastAPI → 读取 SSE 事件 → 转换为 AI SDK UIMessageStream
 */
export async function POST(req: Request) {
  const body = await req.json();

  const messages = body.messages ?? [];
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === "user");

  const userText =
    lastUserMsg?.parts
      ?.filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join(" ") ?? "";

  const userParts = lastUserMsg?.parts ?? [{ type: "text", text: userText }];
  const conversationId = body.conversationId ?? body.conversation_id ?? null;

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: userText,
        parts: userParts,
        model: body.model ?? null,
      }),
    });
  } catch {
    return Response.json({ error: "无法连接到后端服务" }, { status: 502 });
  }

  if (!backendRes.ok || !backendRes.body) {
    const text = await backendRes.text().catch(() => "unknown error");
    return Response.json({ error: text }, { status: backendRes.status });
  }

  const reader = backendRes.body.getReader();
  const decoder = new TextDecoder();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let buffer = "";
      let textPartId = "";
      let textActive = false;

      const processEvent = (event: string, data: Record<string, unknown>) => {
        switch (event) {
          case "message_start":
            writer.write({ type: "start", messageId: generateId() });
            break;

          case "text_delta": {
            if (!textActive) {
              textPartId = generateId();
              writer.write({ type: "text-start", id: textPartId });
              textActive = true;
            }
            writer.write({ type: "text-delta", delta: data.text as string, id: textPartId });
            break;
          }

          case "tool_call":
            if (textActive) {
              writer.write({ type: "text-end", id: textPartId });
              textActive = false;
            }
            writer.write({
              type: "tool-input-available",
              toolCallId: data.tool_call_id as string,
              toolName: data.tool_name as string,
              input: data.args as Record<string, unknown>,
            });
            break;

          case "tool_result":
            writer.write({
              type: "tool-output-available",
              toolCallId: data.tool_call_id as string,
              output: data.result as Record<string, unknown>,
            });
            break;

          case "step_done":
            if (textActive) {
              writer.write({ type: "text-end", id: textPartId });
              textActive = false;
            }
            writer.write({ type: "finish-step" });
            break;

          case "message_done":
            if (textActive) {
              writer.write({ type: "text-end", id: textPartId });
              textActive = false;
            }
            writer.write({ type: "finish-step" });
            writer.write({ type: "finish", finishReason: "stop" });
            break;

          case "error":
            writer.write({ type: "error", errorText: (data.message as string) ?? "unknown error" });
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              processEvent(currentEvent, data);
            } catch { /* skip malformed */ }
            currentEvent = "";
          }
        }
      }

      // 处理残余 buffer
      if (buffer.trim()) {
        const remaining = buffer.split("\n");
        let currentEvent = "";
        for (const line of remaining) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              processEvent(currentEvent, data);
            } catch { /* skip */ }
            currentEvent = "";
          }
        }
      }
    },
    onError: (error) => {
      console.error("[ChatProxy]", error);
      return error instanceof Error ? error.message : "proxy error";
    },
  });

  return createUIMessageStreamResponse({ stream });
}

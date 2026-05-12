import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";

/**
 * =====================================================================
 * 本文件的位置：src/app/api/chat/route.ts
 * 对外暴露的路径：POST /api/chat
 * （Next.js App Router 约定：src/app/api/chat/ 目录 + route.ts = /api/chat）
 *
 * 【这个文件是干什么的？——一句话版本】
 * 它是一个「SSE 翻译代理」：
 *   浏览器(useChat) → 本文件 → Python FastAPI → 本文件翻译 → 浏览器渲染气泡
 *
 * 【完整请求链路（从你点发送到看到回复）】
 *
 *   ① 用户在 ChatInput.tsx 输入文字，按回车
 *   ② ChatPanel.tsx 的 handleSend 调用 AI SDK 的 sendMessage(...)
 *   ③ AI SDK 内部通过 DefaultChatTransport 自动 POST 到 /api/chat（就是本文件）
 *      ┌────────────────────────────────────────────────────────────┐
 *      │ 浏览器发出的请求体（AI SDK UIMessage 格式）：              │
 *      │ {                                                          │
 *      │   "messages": [{                                           │
 *      │     "role": "user",                                        │
 *      │     "parts": [{"type":"text","text":"请处置告警信息..."}],  │
 *      │     "id": "pCVRGZL6yZWo8LFK"                              │
 *      │   }],                                                      │
 *      │   "threadId": "session_20260511_0ckkpi",                   │
 *      │   "conversationId": null,                                  │
 *      │   "situationalContext": { ... }                            │
 *      │ }                                                          │
 *      │ ★ 这就是你在浏览器 DevTools 里看到的 body！               │
 *      └────────────────────────────────────────────────────────────┘
 *   ④ 本文件（route.ts）在 Node.js 服务端收到上面的 body，做两件事：
 *      a) 把 AI SDK 格式 → 转换成 Python 后端要求的格式
 *      b) 用 fetch 发给 Python（这一步在服务端，浏览器 DevTools 看不到！）
 *      ┌────────────────────────────────────────────────────────────┐
 *      │ 实际发给 Python 的请求体（转换后）：                       │
 *      │ POST http://192.168.18.103:8000/api/v1/chat/stream        │
 *      │ {                                                          │
 *      │   "messages": [                                            │
 *      │     {"role":"user","content":"请处置告警信息，告警区域：搜索区1"} │
 *      │   ],                                                       │
 *      │   "thread_id": "session_20260511_0ckkpi"                   │
 *      │ }                                                          │
 *      │ ★ parts 已被提取为 content，多余字段已去掉                 │
 *      └────────────────────────────────────────────────────────────┘
 *   ⑤ Python FastAPI 返回 SSE 流，事件格式举例：
 *      event: workflow_update
 *      data: {"event":"workflow_update","thread_id":"...","data":{"node":"intent_understanding","status":"completed","message":"意图理解完成"}}
 *
 *      event: message_chunk
 *      data: {"event":"message_chunk","thread_id":"...","data":{"node":"...","output":{"response_text":"已识别告警...","error_messages":[]}}}
 *
 *   ⑥ 本文件逐条读取 SSE 事件 → 翻译成 AI SDK 的 UIMessageStream 格式
 *      （text-start / text-delta / text-end / finish 等）
 *   ⑦ 翻译后的流返回给浏览器 → useChat hook 自动拼成 messages 数组
 *   ⑧ ChatMessageList.tsx 拿 messages 渲染聊天气泡
 *
 * 【和 V2 对比（Vue 版本的 httpClient.js）】
 * - V2：浏览器直接 fetch Python 后端，自己在浏览器里解析 SSE
 * - V3：浏览器只和 Next.js 通信，SSE 解析在 Node 服务端完成，好处：
 *   · 无跨域（浏览器请求同源 /api/chat）
 *   · 后端地址不暴露给前端
 *   · 可在此做日志、鉴权、格式转换
 *
 * 【和 next.config.ts 里的 rewrites 什么关系？】
 * 没关系！rewrites 是给 /api/backend/* → Java 后端 用的（会话列表等）。
 * 聊天走的是「本文件手写 fetch 转发」，不是 rewrites 代理。
 * =====================================================================
 */

/** Python AI 后端地址，在 next.config.ts 的 env 里配置，运行时通过 process.env 读取 */
const CHAT_STREAM_URL = process.env.CHAT_STREAM_URL ?? "http://192.168.18.103:8000/api/v1/chat/stream";

export async function POST(req: Request) {
  // ─── 第一步：从浏览器请求里取出数据 ───
  // body 是 AI SDK 格式：{ messages: [{role, parts, id}], threadId, conversationId, situationalContext }
  const body = await req.json();
  const uiMessages = body.messages ?? [];
  const threadId = body.threadId ?? `session_${Date.now().toString(36)}`;

  // ─── 第二步：格式转换（AI SDK → Python 后端）───
  // 浏览器发来的每条消息长这样：
  //   { role: "user", parts: [{type:"text", text:"你好"}], id: "xxx" }
  // Python 后端要的是：
  //   { role: "user", content: "你好" }
  // 所以这里提取 parts 里 type=text 的文本，拼成 content 字符串
  const backendMessages = uiMessages.map((m: { role: string; parts?: Array<{ type: string; text?: string }> }) => {
    const text = (m.parts ?? [])
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text?: string }) => p.text ?? "")
      .join(" ")
      .trim();
    return { role: m.role, content: text };
  }).filter((m: { content: string }) => m.content);

  // ─── 第三步：转发给 Python 后端（服务端 fetch，浏览器看不到！）───
  // 最终发给 Python 的 body：{ messages: [{role,content}], thread_id: "..." }
  const backendBody = { messages: backendMessages, thread_id: threadId };
  console.log("[ChatProxy] → Python backend:", CHAT_STREAM_URL, JSON.stringify(backendBody));

  let backendRes: Response;
  try {
    backendRes = await fetch(CHAT_STREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backendBody),
    });
  } catch {
    return Response.json({ error: "无法连接到后端服务" }, { status: 502 });
  }

  if (!backendRes.ok || !backendRes.body) {
    const text = await backendRes.text().catch(() => "unknown error");
    return Response.json({ error: text }, { status: backendRes.status });
  }

  // ─── 第四步：读取 Python 返回的 SSE 流，翻译成 AI SDK UIMessageStream ───
  // Python 返回的是标准 SSE 格式（event: xxx\ndata: {...}\n\n），需要逐行解析
  // 解析后通过 writer 写入 AI SDK 能理解的格式，浏览器的 useChat 会自动渲染
  const reader = backendRes.body.getReader();
  const decoder = new TextDecoder();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let buffer = "";           // SSE 行缓冲区（TCP 可能把一行拆成多个 chunk）
      let textPartId = "";       // 当前文本块的 ID（AI SDK 要求每个 text part 有唯一 ID）
      let textActive = false;    // 是否有一个 text part 正在输出中
      let reasoningPartId = "";  // 当前思考过程块的 ID
      let reasoningActive = false;
      const registeredPlanIds = new Set<string>();
      let lastResponseText = ""; // 去重用：Python 每个 message_chunk 都带完整 response_text，但内容可能没变
      let started = false;       // 是否已向浏览器发送过 start 信号
      let finished = false;      // 是否已向浏览器发送过 finish 信号
      const seenErrors = new Set<string>(); // 错误消息去重

      /**
       * 核心函数：拿到一条 SSE 事件（event 名 + data JSON），翻译成 AI SDK writer 指令。
       *
       * Python 后端目前发两种事件：
       *   - "workflow_update"：工作流节点状态变化（意图理解完成、执行开始、执行失败等）
       *   - "message_chunk"：包含完整的阶段性输出快照（response_text、execution_results、error_messages）
       *
       * AI SDK useChat 需要的 writer 指令：
       *   - start         → 开始一条新的 assistant 消息
       *   - text-start    → 开始一个文本块
       *   - text-delta    → 追加一段文字（就是聊天气泡里出现的文字）
       *   - text-end      → 结束当前文本块
       *   - finish-step   → 当前步骤完成
       *   - finish        → 整条消息完成
       */
      const processEvent = (event: string, data: Record<string, unknown>) => {
        // 收到第一个事件时，自动发 start（不管是新协议的 message_start 还是旧协议的 message_chunk）
        if (!started) {
          writer.write({ type: "start", messageId: generateId() });
          started = true;
        }

        switch (event) {
          // ============================
          // 新协议事件（预留，目前后端未使用）
          // ============================
          case "message_start":
            break;

          case "thinking_delta": {
            if (textActive) {
              writer.write({ type: "text-end", id: textPartId });
              textActive = false;
            }
            if (!reasoningActive) {
              reasoningPartId = generateId();
              writer.write({ type: "reasoning-start", id: reasoningPartId });
              reasoningActive = true;
            }
            writer.write({ type: "reasoning-delta", delta: data.text as string, id: reasoningPartId });
            break;
          }

          case "text_delta": {
            if (reasoningActive) {
              writer.write({ type: "reasoning-end", id: reasoningPartId });
              reasoningActive = false;
            }
            if (!textActive) {
              textPartId = generateId();
              writer.write({ type: "text-start", id: textPartId });
              textActive = true;
            }
            writer.write({ type: "text-delta", delta: data.text as string, id: textPartId });
            break;
          }

          case "tool_call":
            if ((data.tool_name as string) === "declare_plan") break;
            if (reasoningActive) {
              writer.write({ type: "reasoning-end", id: reasoningPartId });
              reasoningActive = false;
            }
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
            if ((data.tool_name as string) === "declare_plan") break;
            writer.write({
              type: "tool-output-available",
              toolCallId: data.tool_call_id as string,
              output: data.result as Record<string, unknown>,
            });
            break;

          case "plan_update": {
            const planToolCallId = `plan-${data.planId as string}`;
            if (!registeredPlanIds.has(planToolCallId)) {
              registeredPlanIds.add(planToolCallId);
              writer.write({
                type: "tool-input-available",
                toolCallId: planToolCallId,
                toolName: "__plan__",
                input: {},
              });
            }
            writer.write({
              type: "tool-output-available",
              toolCallId: planToolCallId,
              output: { action: "show_plan", ...data } as Record<string, unknown>,
            });
            break;
          }

          case "approval_required": {
            const approvalToolCallId = `approval-${data.approval_id as string}`;
            writer.write({
              type: "tool-input-available",
              toolCallId: approvalToolCallId,
              toolName: "__approval__",
              input: data as Record<string, unknown>,
            });
            break;
          }

          case "approval_result": {
            const approvalToolCallId = `approval-${data.approval_id as string}`;
            writer.write({
              type: "tool-output-available",
              toolCallId: approvalToolCallId,
              output: { action: "show_approval_result", ...data } as Record<string, unknown>,
            });
            break;
          }

          // ============================================================
          // 旧协议事件（当前 Python 后端实际使用的格式）
          // 参考 V2 的 httpClient.js → parseSSEStream 方法
          //
          // Python SSE 数据结构：
          //   event: message_chunk
          //   data: {
          //     "event": "message_chunk",
          //     "thread_id": "session_xxx",
          //     "data": {                        ← 这是 inner，通过 data.data 访问
          //       "node": "intent_understanding",
          //       "output": {                    ← 这是 output
          //         "response_text": "已识别...",  ← 聊天气泡要显示的文字
          //         "error_messages": ["..."],     ← 错误列表
          //         "execution_results": [...]     ← 执行步骤详情
          //       }
          //     }
          //   }
          // ============================================================

          case "message_chunk": {
            // data.data 是 Python SSE 里的内层 data 对象
            const inner = data.data as Record<string, unknown> | undefined;
            const output = inner?.output as Record<string, unknown> | undefined;
            if (!output) break;

            // response_text 在同一轮对话中可能多个 chunk 都带相同的文本，只在变化时输出，避免重复
            const responseText = output.response_text as string | undefined;
            if (responseText && responseText !== lastResponseText) {
              if (reasoningActive) { writer.write({ type: "reasoning-end", id: reasoningPartId }); reasoningActive = false; }
              if (!textActive) { textPartId = generateId(); writer.write({ type: "text-start", id: textPartId }); textActive = true; }
              writer.write({ type: "text-delta", delta: responseText + "\n", id: textPartId });
              lastResponseText = responseText;
            }

            // 显示新增的错误信息（用 Set 去重，同一个错误只显示一次）
            const errorMessages = output.error_messages as string[] | undefined;
            if (errorMessages) {
              for (const err of errorMessages) {
                if (seenErrors.has(err)) continue;
                seenErrors.add(err);
                if (!textActive) { textPartId = generateId(); writer.write({ type: "text-start", id: textPartId }); textActive = true; }
                writer.write({ type: "text-delta", delta: `❌ ${err}\n`, id: textPartId });
              }
            }
            break;
          }

          case "workflow_update": {
            // 工作流节点状态更新，格式同上，inner = data.data
            // 例如：{ node: "intent_understanding", status: "completed", message: "意图理解完成" }
            // 或：  { node: "workflow_execution", status: "failed", error: "告警信息获取失败" }
            const inner = data.data as Record<string, unknown> | undefined;
            if (!inner) break;
            const node = (inner.node_name || inner.node) as string;
            const wfStatus = inner.status as string;
            const wfMessage = inner.message as string | undefined;
            const wfError = inner.error as string | undefined;

            if (reasoningActive) { writer.write({ type: "reasoning-end", id: reasoningPartId }); reasoningActive = false; }
            if (!textActive) { textPartId = generateId(); writer.write({ type: "text-start", id: textPartId }); textActive = true; }

            // 拼成一行状态文字，类似 V2 的 "🔄 [node] status：message"
            let line = `🔄 [${node}] ${wfStatus}`;
            if (wfMessage) line += `：${wfMessage}`;
            if (wfError) line += `：${wfError}`;
            writer.write({ type: "text-delta", delta: line + "\n", id: textPartId });
            break;
          }

          case "step_done":
            if (reasoningActive) {
              writer.write({ type: "reasoning-end", id: reasoningPartId });
              reasoningActive = false;
            }
            if (textActive) {
              writer.write({ type: "text-end", id: textPartId });
              textActive = false;
            }
            writer.write({ type: "finish-step" });
            break;

          case "message_done":
            if (reasoningActive) {
              writer.write({ type: "reasoning-end", id: reasoningPartId });
              reasoningActive = false;
            }
            if (textActive) {
              writer.write({ type: "text-end", id: textPartId });
              textActive = false;
            }
            writer.write({ type: "finish-step" });
            writer.write({ type: "finish", finishReason: "stop" });
            finished = true;
            break;

          case "error":
            writer.write({ type: "error", errorText: (data.message as string) ?? "unknown error" });
            break;
        }
      };

      // ─── 第五步：循环读取 Python 返回的 SSE 流 ───
      // SSE 协议：每条事件由 "event: xxx\n" + "data: {...}\n" + "\n" 组成
      // TCP 不保证按行分割，所以需要 buffer 缓冲 + 按 \n 拆行
      while (true) {
        const { done, value } = await reader.read();
        if (done) break; // Python 端关闭了连接，流结束

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // 最后一行可能不完整，留到下一轮

        let currentEvent = "";
        for (const line of lines) {
          // 解析 "event: message_chunk" → currentEvent = "message_chunk"
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          // 解析 "data: {...}" → JSON.parse → 交给 processEvent 翻译
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              processEvent(currentEvent, data);
            } catch { /* 跳过格式错误的行 */ }
            currentEvent = "";
          }
        }
      }

      // 处理残余 buffer（TCP 流结束时可能还有未处理的最后几行）
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

      // 流结束：旧协议后端不会发 message_done，所以这里自动补上 finish
      // 否则 useChat 会一直显示 loading 状态
      if (started && !finished) {
        if (reasoningActive) writer.write({ type: "reasoning-end", id: reasoningPartId });
        if (textActive) writer.write({ type: "text-end", id: textPartId });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
      }
    },
    onError: (error) => {
      console.error("[ChatProxy]", error);
      return error instanceof Error ? error.message : "proxy error";
    },
  });

  // ─── 第六步：把翻译后的 UIMessageStream 作为 HTTP 响应返回给浏览器 ───
  // 浏览器的 useChat hook 会自动消费这个流，拼成 messages 数组 → 渲染聊天气泡
  return createUIMessageStreamResponse({ stream });
}

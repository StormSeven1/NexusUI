import { streamText, tool, convertToModelMessages } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openrouter = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  headers: {
    "HTTP-Referer": "https://nexusui.local",
    "X-Title": "NexusUI",
  },
});

const SYSTEM_PROMPT = `你是 NexusUI 态势感知系统的 AI 助手，代号"Nexus"。你可以帮助操作员分析态势、查询目标信息、控制地图和系统面板。

你的能力包括：
- 在地图上导航到指定坐标位置
- 选中并查看特定目标(track)的详细信息
- 切换地图 2D/3D 显示模式
- 打开系统面板（概览、仪表、通信、环境、日志、数据）
- 查询目标列表和态势信息

回复要求：
- 使用中文回复
- 回答简洁专业，适合态势感知场景
- 执行操作后简要说明已完成的动作`;

const NEXUS_TOOLS = {
  navigate_to_location: tool({
    description: "在地图上导航到指定经纬度坐标，可选缩放级别",
    inputSchema: z.object({
      lat: z.number().describe("纬度"),
      lng: z.number().describe("经度"),
      zoom: z.number().optional().describe("缩放级别，1-18"),
    }),
  }),
  select_track: tool({
    description: "选中指定 ID 的目标进行查看，ID 格式如 TRK-001",
    inputSchema: z.object({
      trackId: z.string().describe("目标 ID，如 TRK-001"),
    }),
  }),
  switch_map_mode: tool({
    description: "切换地图显示模式为 2D 或 3D",
    inputSchema: z.object({
      mode: z.enum(["2d", "3d"]).describe("地图模式"),
    }),
  }),
  open_panel: tool({
    description: "打开系统面板。可选面板：overview(概览)、dashboard(仪表)、comm(通信)、environment(环境)、eventlog(日志)、datatable(数据)",
    inputSchema: z.object({
      panel: z.enum(["overview", "dashboard", "comm", "environment", "eventlog", "datatable"]).describe("面板名称"),
      side: z.enum(["left", "right"]).default("right").describe("左侧或右侧面板"),
    }),
  }),
  query_tracks: tool({
    description: "查询当前态势中的目标列表，可按类型或态势属性筛选",
    inputSchema: z.object({
      type: z.enum(["air", "ground", "sea", "unknown", "all"]).optional().describe("目标类型筛选"),
      disposition: z.enum(["hostile", "friendly", "neutral", "suspect", "unknown", "assumed-friend", "all"]).optional().describe("敌我属性筛选"),
    }),
  }),
};

// 设为 "true" 禁用 tool calling（适用于不支持 tools 的模型）
const toolsDisabled = process.env.DISABLE_TOOLS === "true";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const modelMessages = await convertToModelMessages(messages);
  const modelId = process.env.OPENAI_MODEL ?? "google/gemini-2.5-flash-preview";

  try {
    const result = streamText({
      model: openrouter.chat(modelId),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      ...(toolsDisabled ? {} : { tools: NEXUS_TOOLS }),
      maxRetries: 1,
    });

    return result.toUIMessageStreamResponse();
  } catch (err: unknown) {
    const error = err as Error & { cause?: unknown; data?: unknown; statusCode?: number };
    console.error("[NexusChat] Error:", error.message);
    if (error.data) console.error("[NexusChat] Data:", JSON.stringify(error.data, null, 2));
    return Response.json(
      { error: error.message },
      { status: error.statusCode ?? 500 }
    );
  }
}

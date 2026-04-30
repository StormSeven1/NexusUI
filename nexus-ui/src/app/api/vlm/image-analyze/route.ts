import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

type VlmJsonConfig = {
  baseUrl?: string;
  model?: string;
  bearerToken?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

async function loadVlmConfig(): Promise<VlmJsonConfig> {
  const cfgPath = path.join(process.cwd(), "public", "config", "vlm-image-analysis.json");
  const raw = await readFile(cfgPath, "utf8");
  return JSON.parse(raw) as VlmJsonConfig;
}

/**
 * 与 Qt `CommonFunc::GenerateVLDescription` 对齐：OpenAI 兼容 `POST {baseUrl}/chat/completions`
 */
export async function POST(req: Request) {
  let body: { imageBase64?: string; fileName?: string };
  try {
    body = (await req.json()) as { imageBase64?: string; fileName?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const imageBase64 = body.imageBase64?.trim();
  if (!imageBase64) {
    return NextResponse.json({ error: "缺少 imageBase64" }, { status: 400 });
  }

  let fileCfg: VlmJsonConfig;
  try {
    fileCfg = await loadVlmConfig();
  } catch (e) {
    console.error("[vlm/image-analyze] 读取 vlm-image-analysis.json 失败", e);
    return NextResponse.json({ error: "VLM 配置文件不可用" }, { status: 500 });
  }

  const baseUrl = (process.env.VLM_IMAGE_ANALYSIS_BASE_URL ?? fileCfg.baseUrl ?? "").replace(/\/$/, "");
  const model = process.env.VLM_IMAGE_ANALYSIS_MODEL ?? fileCfg.model;
  const bearer = process.env.VLM_IMAGE_ANALYSIS_BEARER ?? fileCfg.bearerToken ?? "EMPTY";
  const systemPrompt = fileCfg.systemPrompt ?? "";
  const userPrompt = fileCfg.userPrompt ?? "";

  if (!baseUrl || !model) {
    return NextResponse.json({ error: "VLM baseUrl/model 未配置" }, { status: 500 });
  }

  const url = `${baseUrl}/chat/completions`;
  const dataUrl = `data:image/png;base64,${imageBase64}`;

  const payload = {
    model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: [
          { type: "image_url" as const, image_url: { url: dataUrl } },
          { type: "text" as const, text: userPrompt },
        ],
      },
    ],
  };

  let vlmRes: Response;
  try {
    vlmRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[vlm/image-analyze] fetch", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "无法连接 VLM 服务" },
      { status: 502 },
    );
  }

  const rawText = await vlmRes.text();
  if (!vlmRes.ok) {
    console.error("[vlm/image-analyze] VLM HTTP", vlmRes.status, rawText.slice(0, 500));
    return NextResponse.json(
      { error: rawText || `VLM HTTP ${vlmRes.status}` },
      { status: 502 },
    );
  }

  let content = "";
  try {
    const j = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    content = j?.choices?.[0]?.message?.content ?? "";
  } catch {
    return NextResponse.json({ error: "VLM 返回非 JSON" }, { status: 502 });
  }

  if (!content) {
    return NextResponse.json({ error: "VLM 返回空内容" }, { status: 502 });
  }

  const tag = "<answer>";
  const idx = content.indexOf(tag);
  if (idx !== -1) {
    content = content.slice(idx + tag.length);
  }

  return NextResponse.json({ text: content.trim(), model, fileName: body.fileName ?? null });
}

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

async function loadVlmConfig(): Promise<VlmJsonConfig | null> {
  const cfgPath = path.join(process.cwd(), "public", "config", "vlm-image-analysis.json");
  try {
    const raw = await readFile(cfgPath, "utf8");
    return JSON.parse(raw) as VlmJsonConfig;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "ENOENT") return null;
    throw e;
  }
}

async function readPromptIni(fileName: string): Promise<string> {
  const p = path.join(process.cwd(), "public", "config", fileName);
  try {
    return (await readFile(p, "utf8")).trim();
  } catch {
    return "";
  }
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

  let fileCfg: VlmJsonConfig | null;
  try {
    fileCfg = await loadVlmConfig();
  } catch (e) {
    console.error("[vlm/image-analyze] 读取 vlm-image-analysis.json 失败", e);
    return NextResponse.json({ error: "VLM 配置文件不可用" }, { status: 500 });
  }

  const baseUrl = (process.env.VLM_IMAGE_ANALYSIS_BASE_URL ?? fileCfg?.baseUrl ?? "").replace(/\/$/, "");
  const model = process.env.VLM_IMAGE_ANALYSIS_MODEL ?? fileCfg?.model;
  const bearer = (process.env.VLM_IMAGE_ANALYSIS_BEARER ?? fileCfg?.bearerToken ?? "").trim();
  // 约定：Config_Prompt.ini 为 system 提示词；Config_Quest.ini 为 user 提示词。
  const [systemPromptIni, userPromptIni] = await Promise.all([
    readPromptIni("Config_Prompt.ini"),
    readPromptIni("Config_Quest.ini"),
  ]);
  const systemPrompt = systemPromptIni || fileCfg?.systemPrompt || "";
  const userPrompt = userPromptIni || fileCfg?.userPrompt || "";

  if (!baseUrl || !model) {
    return NextResponse.json({ error: "VLM baseUrl/model 未配置" }, { status: 500 });
  }

  const candidateUrls = [`${baseUrl}/chat/completions`, `${baseUrl}/v1/chat/completions`];
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  let vlmRes: Response | null = null;
  let rawText = "";
  let lastErr = "";
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (res.ok) {
        vlmRes = res;
        rawText = text;
        break;
      }
      lastErr = `URL=${url} HTTP ${res.status} ${text.slice(0, 300)}`;
      if (res.status === 404) continue;
      return NextResponse.json({ error: text || `VLM HTTP ${res.status}` }, { status: 502 });
    } catch (e) {
      lastErr = `URL=${url} ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (!vlmRes) {
    console.error("[vlm/image-analyze] fetch failed", lastErr);
    return NextResponse.json({ error: `无法连接 VLM 服务: ${lastErr}` }, { status: 502 });
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

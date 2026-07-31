import { NextRequest, NextResponse } from "next/server";

/**
 * Word 报告生成服务基址（agent-toolbox report-docx）。
 * 默认：http://192.168.18.103:9780
 */
function resolveWordReportBase(): string {
  const fromEnv =
    process.env.WORD_REPORT_API_BASE_URL?.trim() ||
    process.env.NEXUS_WORD_REPORT_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://192.168.18.103:9780";
}

async function forwardToWordService(
  form: FormData,
  requestId: string,
): Promise<NextResponse> {
  const wordBase = resolveWordReportBase();
  const url = `${wordBase}/api/v1/tools/report-docx/generate`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Request-ID": requestId,
        Accept: "application/json",
      },
      body: form,
      cache: "no-store",
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "application/json; charset=utf-8";
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": contentType },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "word_proxy_failed",
        message: `无法连接 Word 报告服务: ${wordBase}`,
        detail: msg,
        request_id: requestId,
      },
      { status: 502 },
    );
  }
}

/**
 * POST /api/eval-report/word
 * - multipart/form-data：manifest(字符串) + images(文件)
 * - application/json：{ manifest }（兼容旧调用，无图）
 *
 * Word 服务要求 manifest 为普通 Form 字段（不能带 filename），
 * 否则返回 422「The multipart request does not match the required interface」。
 */
export async function POST(req: NextRequest) {
  const requestId =
    req.headers.get("x-request-id")?.trim() ||
    `nexus-eval-word-${Date.now()}`;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    let incoming: FormData;
    try {
      incoming = await req.formData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "invalid_multipart", message: msg },
        { status: 400 },
      );
    }

    const manifestRaw = incoming.get("manifest");
    if (manifestRaw == null) {
      return NextResponse.json(
        { error: "invalid_manifest", message: "multipart 需包含 manifest 字段" },
        { status: 400 },
      );
    }

    let manifestText: string;
    if (typeof manifestRaw === "string") {
      manifestText = manifestRaw;
    } else if (typeof Blob !== "undefined" && manifestRaw instanceof Blob) {
      // 兼容误传 Blob：读成文本后再以字符串字段转发
      manifestText = await manifestRaw.text();
    } else {
      return NextResponse.json(
        { error: "invalid_manifest", message: "manifest 格式无效" },
        { status: 400 },
      );
    }

    try {
      JSON.parse(manifestText);
    } catch {
      return NextResponse.json(
        { error: "invalid_manifest", message: "manifest 不是合法 JSON" },
        { status: 400 },
      );
    }

    const form = new FormData();
    form.append("manifest", manifestText);

    const images = incoming.getAll("images");
    for (const item of images) {
      if (typeof item === "string") continue;
      const name =
        "name" in item && typeof item.name === "string" && item.name
          ? item.name
          : "chart.jpg";
      form.append("images", item, name);
    }

    return forwardToWordService(form, requestId);
  }

  let body: { manifest?: unknown };
  try {
    body = (await req.json()) as { manifest?: unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "invalid_json", message: msg },
      { status: 400 },
    );
  }

  if (!body?.manifest || typeof body.manifest !== "object") {
    return NextResponse.json(
      { error: "invalid_manifest", message: "请求体需包含 manifest 对象" },
      { status: 400 },
    );
  }

  const form = new FormData();
  form.append("manifest", JSON.stringify(body.manifest));
  return forwardToWordService(form, requestId);
}

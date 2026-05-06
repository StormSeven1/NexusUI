import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { getTaskStatusMinioClient } from "@/lib/task-status-minio-presign.server";

export const runtime = "nodejs";

/**
 * 同源拉图：浏览器只请求 Next，避免 HTTPS 页面加载 HTTP MinIO 预签名 URL 被混合内容拦截；
 * 服务端用 AK/SK 从 MinIO getObject 流出字节。
 */
export async function GET(req: NextRequest) {
  const bucket = req.nextUrl.searchParams.get("bucket")?.trim();
  const objectKey = req.nextUrl.searchParams.get("objectKey")?.trim();
  if (!bucket || !objectKey) {
    return new Response("missing bucket or objectKey", { status: 400 });
  }

  const client = getTaskStatusMinioClient();
  if (!client) {
    return new Response("MinIO not configured for task-status", { status: 503 });
  }

  try {
    const stat = await client.statObject(bucket, objectKey);
    const nodeStream = await client.getObject(bucket, objectKey);
    const meta = stat.metaData as Record<string, string> | undefined;
    let ct =
      meta?.["content-type"] ??
      meta?.["Content-Type"] ??
      (objectKey.toLowerCase().endsWith(".png")
        ? "image/png"
        : objectKey.toLowerCase().match(/\.(jpe?g)$/i)
          ? "image/jpeg"
          : objectKey.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : objectKey.toLowerCase().endsWith(".gif")
              ? "image/gif"
              : "image/jpeg");

    ct = typeof ct === "string" ? ct.split(";")[0].trim() : "image/jpeg";

    const webBody = Readable.toWeb(nodeStream);

    return new Response(webBody as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[task-status-image-proxy] ${bucket}/${objectKey}:`, msg);
    return new Response("object not found or access denied", { status: 404 });
  }
}

import { NextRequest } from "next/server";
import { buildMinioPathStyleBrowserUrl } from "@/lib/task-status-minio-acc.server";
import { presignTaskStatusGetUrl } from "@/lib/task-status-minio-presign.server";
import { listRecentTrackScreenshotsFromDb } from "@/lib/track-screenshots-db.server";

export const runtime = "nodejs";

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

/**
 * 供船只识别等外部服务匿名 GET 的下载地址：
 * DB download_url → MinIO 预签名 → path-style → 同源图片代理绝对地址。
 */
async function resolveExternalDownloadUrl(opts: {
  dbDownloadUrl: string;
  bucket: string;
  objectKey: string;
  proxyPath: string;
  requestOrigin: string;
}): Promise<string> {
  const fromDb = opts.dbDownloadUrl.trim();
  if (fromDb && isHttpUrl(fromDb)) return fromDb;

  const presigned = await presignTaskStatusGetUrl(opts.bucket, opts.objectKey);
  if (presigned && isHttpUrl(presigned)) return presigned;

  const pathStyle = buildMinioPathStyleBrowserUrl(opts.bucket, opts.objectKey);
  if (pathStyle && isHttpUrl(pathStyle)) return pathStyle;

  if (isHttpUrl(opts.proxyPath)) return opts.proxyPath;
  const origin = opts.requestOrigin.replace(/\/$/, "");
  const path = opts.proxyPath.startsWith("/") ? opts.proxyPath : `/${opts.proxyPath}`;
  return `${origin}${path}`;
}

/**
 * GET /api/track-screenshots?uniqueId=&limit=10
 * **仅**按 `uniqueId`（纯数字）查库表 `unique_id`；查不到返回 `items: []`。
 * - `url`：浏览器展示用（同源 proxy）
 * - `downloadUrl`：外部服务可 GET 的下载地址（不用于前端展示）
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const uniqueId = sp.get("uniqueId")?.trim() ?? "";
  const limRaw = sp.get("limit");
  const limit = limRaw != null ? Number(limRaw) : 10;

  const rows = await listRecentTrackScreenshotsFromDb({
    uniqueIdStr: uniqueId || null,
    limit: Number.isFinite(limit) ? limit : 10,
  });

  const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  const requestOrigin = req.nextUrl.origin;

  const items = await Promise.all(
    rows.map(async (r) => {
      const proxyPath = `${bp}/api/task-status-image-proxy?bucket=${encodeURIComponent(r.minioBucket)}&objectKey=${encodeURIComponent(r.minioObjectKey)}`;
      const downloadUrl = await resolveExternalDownloadUrl({
        dbDownloadUrl: r.downloadUrl,
        bucket: r.minioBucket,
        objectKey: r.minioObjectKey,
        proxyPath,
        requestOrigin,
      });
      return {
        url: proxyPath,
        downloadUrl,
        bucket: r.minioBucket,
        objectKey: r.minioObjectKey,
        cameraIndex: r.cameraIndex,
        uploadedAt: r.uploadedAt,
      };
    }),
  );

  return Response.json({ ok: true, items });
}

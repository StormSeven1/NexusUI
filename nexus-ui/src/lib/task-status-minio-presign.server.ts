/**
 * Node 服务端：使用 MinIO 凭证为 bucket+objectKey 生成预签名 GET，供查证气泡 `<img>` 加载私有桶对象。
 */
import * as Minio from "minio";

type ParsedEp = { endPoint: string; port: number; useSSL: boolean };

function parseMinioEndpoint(): ParsedEp | null {
  const combined = process.env.TASK_STATUS_MINIO_ENDPOINT?.trim();
  if (combined) {
    try {
      const u = new URL(combined.includes("://") ? combined : `http://${combined}`);
      const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : 9000;
      return { endPoint: u.hostname, port, useSSL: u.protocol === "https:" };
    } catch {
      return null;
    }
  }
  const host = process.env.TASK_STATUS_MINIO_HOST?.trim() ?? process.env.MINIO_HOST?.trim();
  const portRaw =
    process.env.TASK_STATUS_MINIO_PORT?.trim() ??
    process.env.MinioPort?.trim() ??
    process.env.MINIO_PORT?.trim();
  if (!host || !portRaw) return null;
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  const useSSL = process.env.TASK_STATUS_MINIO_USE_SSL === "true" || process.env.MINIO_USE_SSL === "true";
  return { endPoint: host, port, useSSL };
}

function readCredentials(): { access: string; secret: string } | null {
  const access =
    process.env.TASK_STATUS_MINIO_ACCESS_KEY?.trim() ??
    process.env.MINIO_ACCESS_KEY?.trim() ??
    process.env.MINIO_ROOT_USER?.trim();
  const secret =
    process.env.TASK_STATUS_MINIO_SECRET_KEY?.trim() ??
    process.env.MINIO_SECRET_KEY?.trim() ??
    process.env.MINIO_ROOT_PASSWORD?.trim();
  if (!access || !secret) return null;
  return { access, secret };
}

const g = globalThis as typeof globalThis & { __nexusMinioPresignClient?: Minio.Client | null };

function getMinioPresignClient(): Minio.Client | null {
  if (g.__nexusMinioPresignClient !== undefined) return g.__nexusMinioPresignClient;

  const ep = parseMinioEndpoint();
  const creds = readCredentials();
  if (!ep || !creds) {
    g.__nexusMinioPresignClient = null;
    return null;
  }

  g.__nexusMinioPresignClient = new Minio.Client({
    endPoint: ep.endPoint,
    port: ep.port,
    useSSL: ep.useSSL,
    accessKey: creds.access,
    secretKey: creds.secret,
    /** MinIO 常用 path-style（尤其 IP + 非标端口） */
    pathStyle: process.env.TASK_STATUS_MINIO_PATH_STYLE !== "false",
  });
  return g.__nexusMinioPresignClient;
}

/** 配置了 endpoint + AK/SK 时可用预签名或同源图片代理。 */
export function isTaskStatusMinioPresignConfigured(): boolean {
  return getMinioPresignClient() != null;
}

/** 供 `/api/task-status-image-proxy` 与预签名共用同一客户端 */
export function getTaskStatusMinioClient(): Minio.Client | null {
  return getMinioPresignClient();
}

export async function presignTaskStatusGetUrl(bucket: string, objectKey: string): Promise<string | null> {
  const client = getMinioPresignClient();
  if (!client) return null;

  const b = bucket.trim();
  const key = objectKey.trim().replace(/^\/+/, "");
  if (!b || !key) return null;

  const secRaw = process.env.TASK_STATUS_MINIO_PRESIGN_EXPIRY_SEC?.trim() ?? "86400";
  const sec = Number(secRaw);
  const expiry = Number.isFinite(sec) && sec > 0 ? sec : 86400;

  try {
    return await client.presignedGetObject(b, key, expiry);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[task-status] MinIO presignedGetObject 失败 (${b}/${key}):`, msg);
    return null;
  }
}

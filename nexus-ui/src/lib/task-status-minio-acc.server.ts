/**
 * Node 服务端：累积 MinIO object key 分片（与 track+camera 绑定），并从 env 组装浏览器可直接 GET 的路径式 URL。
 * 若 Bucket 非公网可读，仍需上游发预签名 downloadUrl。
 */
import { isPathishObjectKeyFragment } from "@/lib/task-status-pathish";

type AccStore = Map<string, string>;

const g = globalThis as typeof globalThis & { __nexusTaskStatusKeyAcc?: AccStore };
function store(): AccStore {
  if (!g.__nexusTaskStatusKeyAcc) g.__nexusTaskStatusKeyAcc = new Map();
  return g.__nexusTaskStatusKeyAcc;
}

function sessionTrackCameraKey(trackID: number, cameraIndex: number): string {
  return `${trackID}_${cameraIndex}`;
}

export function resetVerifyObjectKeyAccumulator(trackID: number, cameraIndex: number): void {
  store().delete(sessionTrackCameraKey(trackID, cameraIndex));
}

function normalizeKey(k: string): string {
  return k.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
}

/**
 * 合并分片到累积 key；仅 pathish 描述参与累积，避免把中文研判拼进 key。
 */
export function accumulateVerifyObjectKeyFromDescription(
  trackID: number,
  cameraIndex: number,
  taskStatus: number,
  description: string,
): string {
  const sk = sessionTrackCameraKey(trackID, cameraIndex);
  const m = store();
  if (taskStatus === 4) {
    m.delete(sk);
    return "";
  }
  const frag = description.trim();
  if (!frag || !isPathishObjectKeyFragment(frag)) return m.get(sk) ?? "";
  const prev = m.get(sk) ?? "";
  const merged = normalizeKey(prev + frag);
  m.set(sk, merged);
  return merged;
}

function encodeKeyPathSegments(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * path-style: `{endpoint}/{bucket}/{objectKey...}`
 */
export function buildMinioPathStyleBrowserUrl(bucket: string, objectKey: string): string | null {
  const raw = process.env.TASK_STATUS_MINIO_BROWSER_BASE_URL?.trim();
  if (!raw) return null;
  const endpoint = raw.replace(/\/+$/, "");
  const b = bucket.trim();
  const k = normalizeKey(objectKey);
  if (!b || !k) return null;
  return `${endpoint}/${encodeURIComponent(b)}/${encodeKeyPathSegments(k)}`;
}

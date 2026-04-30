import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  type EntityTaskRow,
  isTrackTaskOwnerRowAllowed,
} from "@/lib/entities-track-task-rows";

/** 单次页面会话内复用，避免每发一次航迹任务都拉实体列表 */
const SESSION_TTL_MS = 10 * 60 * 1000;

type Cached = {
  fetchedAt: number;
  listUrl: string;
  byId: Map<string, EntityTaskRow>;
};

let cached: Cached | null = null;
let inflight: Promise<void> | null = null;

type SnapshotResponse = {
  ok?: boolean;
  listUrl?: string;
  fetchedAt?: string;
  items?: EntityTaskRow[];
  error?: string;
};

export function getEntitiesTrackTaskCacheRow(entityId: string): EntityTaskRow | undefined {
  const id = canonicalEntityId(entityId);
  return cached?.byId.get(id);
}

export function invalidateEntitiesTrackTaskCache(): void {
  cached = null;
  inflight = null;
}

/**
 * 预拉实体快照；默认用同源 `/api/nexus-entities/snapshot`（SERVER 再请求 NEXUS_ENTITIES_LIST_URL）。
 * @param force 为 true 时忽略 TTL 立即刷新
 */
export async function ensureEntitiesTrackTaskCache(force = false): Promise<void> {
  if (!force && cached && Date.now() - cached.fetchedAt < SESSION_TTL_MS) return;
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch("/api/nexus-entities/snapshot", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    let json: SnapshotResponse;
    try {
      json = JSON.parse(text) as SnapshotResponse;
    } catch {
      throw new Error(`[entities-track-task-cache] 快照非 JSON: HTTP ${res.status}`);
    }
    if (!res.ok || json.ok !== true || !Array.isArray(json.items)) {
      throw new Error(
        json.error ||
          `[entities-track-task-cache] 快照失败 HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const byId = new Map<string, EntityTaskRow>();
    for (const row of json.items) {
      if (!row?.entityId) continue;
      byId.set(canonicalEntityId(row.entityId), row);
    }
    cached = {
      fetchedAt: Date.now(),
      listUrl: json.listUrl ?? "",
      byId,
    };
  })();

  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

/** 所有可下发光电航迹元任务的 owner（hasPtz 且 parent_device_id 为空），按 entityId 排序 */
export function listTrackTaskOwnerEntityIds(): string[] {
  if (!cached) return [];
  const out: string[] = [];
  for (const r of cached.byId.values()) {
    if (isTrackTaskOwnerRowAllowed(r)) out.push(r.entityId);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * 按 app-config 给出的 preferred owner 解析实际下发用的 entityId：
 * 1. preferred 自身满足「hasPtz + parent 为空」则直接用（主云台）；
 * 2. 若 preferred 是子路（`parent_device_id` 非空），则改为其父设备且父满足上条时用父（如流配成 `camera_002` 时发到 `camera_001`）。
 */
export function resolveTrackTaskOwnerEntityId(preferred: string): string | null {
  if (!cached) return null;
  const p = canonicalEntityId(preferred.trim());
  if (!p) return null;
  const byId = cached.byId;
  const direct = byId.get(p);
  if (direct && isTrackTaskOwnerRowAllowed(direct)) return direct.entityId;
  if (direct?.parentDeviceId) {
    const parent = byId.get(direct.parentDeviceId);
    if (parent && isTrackTaskOwnerRowAllowed(parent)) return parent.entityId;
  }
  return null;
}

export { isTrackTaskOwnerRowAllowed, type EntityTaskRow };

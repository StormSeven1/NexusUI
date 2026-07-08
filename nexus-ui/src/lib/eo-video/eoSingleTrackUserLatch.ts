import { canonicalEntityId } from "@/lib/camera-entity-id";

/** 界面双击起跟后、DDS EXECUTING 确认前的单目标层 latch（禁止 WS singleRect 无 DDS 时自动抢层） */
const DEFAULT_LATCH_MS = 5000;

type LatchEntry = { untilMs: number };

const byEntity = new Map<string, LatchEntry>();

function keyFor(entityId: string): string {
  const t = entityId.trim();
  if (!t) return "";
  return canonicalEntityId(t) || t;
}

/** 双击发送 trackAction=1 后调用 */
export function armEoSingleTrackUserLatch(entityId: string, maxMs = DEFAULT_LATCH_MS): void {
  const k = keyFor(entityId);
  if (!k) return;
  byEntity.set(k, { untilMs: Date.now() + maxMs });
}

export function clearEoSingleTrackUserLatch(entityId: string): void {
  const k = keyFor(entityId);
  if (!k) return;
  byEntity.delete(k);
}

export function isEoSingleTrackUserLatchActive(entityId: string, nowMs = Date.now()): boolean {
  const k = keyFor(entityId);
  if (!k) return false;
  const e = byEntity.get(k);
  if (!e) return false;
  if (nowMs > e.untilMs) {
    byEntity.delete(k);
    return false;
  }
  return true;
}

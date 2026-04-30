import { canonicalEntityId } from "@/lib/camera-entity-id";
import type { EoCameraWsPayload, EoRectLayerPayload } from "@/lib/eo-video/eoDetectionTypes";

function toOptionalNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeRectLayer(layer: unknown): EoRectLayerPayload | null | undefined {
  if (layer == null) return undefined;
  if (typeof layer !== "object") return undefined;
  const o = layer as Record<string, unknown>;
  const vr = o.videoRect ?? o.video_rect;
  if (vr == null) return undefined;
  const out: EoRectLayerPayload = {
    header: o.header as EoRectLayerPayload["header"],
    videoRect: vr as EoRectLayerPayload["videoRect"],
  };
  // 透传时间戳字段（captureTs / encodeTs / frameId），供 EMA 同步校准使用
  const ct = toOptionalNumber(o.captureTs ?? o.capture_ts ?? o.captureTimestamp ?? o.capture_timestamp);
  if (ct !== undefined) out.captureTs = ct;
  const et = toOptionalNumber(o.encodeTs ?? o.encode_ts ?? o.encodeTimestamp ?? o.encode_timestamp);
  if (et !== undefined) out.encodeTs = et;
  const fid = toOptionalNumber(o.frameId ?? o.frame_id ?? o.frameID);
  if (fid !== undefined) out.frameId = fid;
  return out;
}

/** 将后端蛇形字段 / 变体键转为 ingest 使用的 EoCameraWsPayload */
export function normalizeWsCameraRow(row: unknown): EoCameraWsPayload | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const eid = r.entityId ?? r.entity_id ?? r.EntityId;
  if (eid == null) return null;
  const out: EoCameraWsPayload = {
    entityId: eid as string | number,
    videoWidth: Number(r.videoWidth ?? r.video_width) || undefined,
    videoHeight: Number(r.videoHeight ?? r.video_height) || undefined,
  };
  // 顶层时间戳字段透传（某些后端在顶层而非各 rectLayer 里提供）
  const ct = toOptionalNumber(r.captureTs ?? r.capture_ts ?? r.captureTimestamp ?? r.capture_timestamp);
  if (ct !== undefined) out.captureTs = ct;
  const et = toOptionalNumber(r.encodeTs ?? r.encode_ts ?? r.encodeTimestamp ?? r.encode_timestamp);
  if (et !== undefined) out.encodeTs = et;
  const fid = toOptionalNumber(r.frameId ?? r.frame_id ?? r.frameID);
  if (fid !== undefined) out.frameId = fid;
  const b = normalizeRectLayer(r.boatRect ?? r.boat_rect);
  if (b) out.boatRect = b;
  const p = normalizeRectLayer(r.planeRect ?? r.plane_rect);
  if (p) out.planeRect = p;
  const s = normalizeRectLayer(r.singleRect ?? r.single_rect);
  if (s) out.singleRect = s;
  return out;
}

export function unwrapDetectionEnvelope(root: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(root.cameraArray) || root.entityId != null || root.entity_id != null) return root;
  const inner = root.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const o = inner as Record<string, unknown>;
    if (Array.isArray(o.cameraArray) || o.entityId != null || o.entity_id != null) return o;
  }
  const pay = root.payload;
  if (pay && typeof pay === "object" && !Array.isArray(pay)) {
    const o = pay as Record<string, unknown>;
    if (Array.isArray(o.cameraArray) || o.entityId != null || o.entity_id != null) return o;
  }
  return root;
}

export function summarizeWsInboundPayload(
  data: Record<string, unknown>,
  opts?: { listenerKeys?: readonly string[] },
): string {
  const keys = Object.keys(data).slice(0, 24).join(",");
  if (Array.isArray(data.cameraArray)) {
    const arr = data.cameraArray as unknown[];
    const n = arr.length;
    const canonIds: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const row = arr[i];
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const e = r.entityId ?? r.entity_id;
      if (e == null) continue;
      const c = canonicalEntityId(e as string | number);
      if (c) canonIds.push(c);
    }
    const uniq = [...new Set(canonIds)];
    const list = uniq.slice(0, 14).join(",");
    const more = uniq.length > 14 ? `+${uniq.length - 14}` : "";

    let subHit = "";
    const lk = opts?.listenerKeys?.filter(Boolean) ?? [];
    if (lk.length) {
      const parts = lk.slice(0, 3).map((want) => {
        let idx = -1;
        for (let i = 0; i < arr.length; i++) {
          const row = arr[i];
          if (!row || typeof row !== "object") continue;
          const r = row as Record<string, unknown>;
          const e = r.entityId ?? r.entity_id;
          if (e == null) continue;
          if (canonicalEntityId(e as string | number) === want) {
            idx = i;
            break;
          }
        }
        return idx >= 0 ? `${want}#${idx}` : `!${want}`;
      });
      subHit = ` | 订阅=${parts.join(",")}`;
    }

    return `cameraArray n=${n} 本包实体=[${list}${more ? more : ""}]${subHit} rootKeys=[${keys}]`;
  }
  const eid = data.entityId ?? data.entity_id;
  if (eid != null) {
    const rk = Object.keys(data).slice(0, 20).join(",");
    return `single entityId=${String(eid)} keys=[${rk}]`;
  }
  return `no route keys=[${keys}]`;
}

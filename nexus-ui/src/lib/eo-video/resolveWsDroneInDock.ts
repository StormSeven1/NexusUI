import { canonicalEntityId } from "@/lib/camera-entity-id";
import { useDroneStore } from "@/stores/drone-store";

/** 从 dock_status / MQTT 同源字段解析 `drone_in_dock` */
export function readDroneInDockFlag(payload: unknown): boolean | null {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  const v = o.drone_in_dock ?? o.droneInDock;
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "1" || t === "true" || t === "yes") return true;
    if (t === "0" || t === "false" || t === "no" || t === "") return false;
    const n = Number(v);
    if (Number.isFinite(n)) return n !== 0;
  }
  return Boolean(v);
}

/**
 * 按无人机 entityId / 机场 SN 从 drone-store 解析是否在舱。
 * 无数据时返回 null（未知），不误判为空闲。
 */
export function resolveWsDroneInDock(
  entityId: string | null | undefined,
  airportSn?: string | null,
): boolean | null {
  const s = useDroneStore.getState();
  const ap = (airportSn ?? "").trim();
  if (ap) {
    const fromAp = readDroneInDockFlag(s.docks[ap]?.payload);
    if (fromAp !== null) return fromAp;
  }
  const raw = (entityId ?? "").trim();
  if (!raw) return null;
  const uavId = canonicalEntityId(raw) || raw;
  const deviceSn =
    s.entityIdToDeviceSn[uavId] ||
    (raw !== uavId ? s.entityIdToDeviceSn[raw] : undefined) ||
    "";
  const dockSn = deviceSn ? s.droneToAirport[deviceSn] : "";
  if (!dockSn) return null;
  return readDroneInDockFlag(s.docks[dockSn]?.payload);
}

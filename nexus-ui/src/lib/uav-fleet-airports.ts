import { useDroneStore } from "@/stores/drone-store";

/**
 * 当前 WS 机务关系中的全部机场（dock / gateway）SN，用于顶栏「一键返航 / 一键热备」逐台下发。
 * `extra` 可并入光电 MQTT 当前机场（尚未写入 drone-store 时兜底）。
 */
export function getAllFleetAirportSNs(extra?: string | null): string[] {
  const { airportToDrones, docks } = useDroneStore.getState();
  const set = new Set<string>();
  for (const k of Object.keys(airportToDrones)) {
    const t = k.trim();
    if (t) set.add(t);
  }
  for (const k of Object.keys(docks)) {
    const t = k.trim();
    if (t) set.add(t);
  }
  const e = extra?.trim();
  if (e) set.add(e);
  return Array.from(set);
}

/** 某机场下第一架无人机 SN（供 `postUavControlAction` deviceSN 可选字段） */
export function primaryDroneSnForAirport(airportSn: string): string | undefined {
  const list = useDroneStore.getState().airportToDrones[airportSn];
  const d = list?.[0]?.trim();
  return d || undefined;
}

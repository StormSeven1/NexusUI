/**
 * 处置方案执行态与 V2 DisposalCard 对齐：按「目标 + 方案内设备名集合」做跨方案去重与已执行继承。
 */

import type { DisposalInputParams, MappedDisposalScheme, NormalizedDisposalPlans } from "./disposal-types";

export function collectSchemeDeviceNames(scheme: MappedDisposalScheme): string[] {
  const out: string[] = [];
  const scan = (t: { deviceName?: unknown; deviceId?: unknown }) => {
    let n = t.deviceName != null && t.deviceName !== "" ? String(t.deviceName).trim() : "";
    if (!n && t.deviceId != null && t.deviceId !== "") n = String(t.deviceId).trim();
    if (n) out.push(n);
  };
  for (const t of scheme.tasks || []) scan(t);
  const raw = scheme._raw?.tasks;
  if (Array.isArray(raw)) {
    for (const t of raw) scan(t as { deviceName?: unknown; deviceId?: unknown });
  }
  return [...new Set(out)].sort();
}

/** 与 V2 `getExecutionTrackingKey` 一致：target + 设备名集合（排序后 \\u001f 拼接） */
export function getExecutionTrackingKey(targetId: string, scheme: MappedDisposalScheme): string {
  const tid = String(targetId ?? "").trim();
  const names = collectSchemeDeviceNames(scheme);
  if (!tid || !names.length) return "";
  return `target:${tid}|names:${names.join("\u001f")}`;
}

export function collectAllDeviceIdsFromNormalized(n: NormalizedDisposalPlans): Set<string> {
  const s = new Set<string>();
  for (const item of n.items || []) {
    for (const sch of item.mappedSchemes || []) {
      for (const t of sch.tasks || []) {
        const id = t.deviceId != null ? String(t.deviceId).trim() : "";
        if (id) s.add(id);
      }
    }
  }
  return s;
}

export function primaryTargetIdFromNormalized(n: NormalizedDisposalPlans): string {
  const ti = n.target as { targetId?: unknown } | undefined;
  const fromTarget = ti?.targetId != null ? String(ti.targetId).trim() : "";
  const fromItem =
    n.items?.[0]?.inputParams?.targetId != null ? String(n.items[0].inputParams.targetId).trim() : "";
  return fromItem || fromTarget || "";
}

/** 与 V2 `inferIsAirTrackFromInput` 一致：0/1、字符串 uav/boat 等 */
export function inferIsAirTrackFromInputParams(ip: DisposalInputParams | undefined): boolean | undefined {
  if (!ip) return undefined;
  const raw = ip.targetType;
  if (raw === 1 || raw === "1") return true;
  if (raw === 0 || raw === "0") return false;
  const n = Number(raw);
  if (raw != null && raw !== "" && Number.isFinite(n)) {
    if (n === 1) return true;
    if (n === 0) return false;
  }
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (!t) return undefined;
  if (t === "uav" || t === "drone" || t === "air" || t === "aircraft") return true;
  if (t === "ship" || t === "boat" || t === "sea") return false;
  return undefined;
}

/**
 * 航迹告警 ThreatLevel（与 TargetAlarmItem.level / proto ThreatLevel 一致）：
 * 0=LOW、1=MEDIUM、2=HIGH。
 * 态势：LOW 普通色、MEDIUM 黄（预警）、HIGH 蓝（告警）；告警中心仅展示 HIGH。
 * 不读 is_suspicious。
 */

import type { AlertData } from "@/stores/alert-store";

export type ThreatLevelRank = 0 | 1 | 2;

/** 从告警条目解析 ThreatLevel；无法判定时返回 null */
export function resolveAlertThreatLevel(
  alert: Pick<AlertData, "alarmLevel" | "severity">,
): ThreatLevelRank | null {
  const raw = alert.alarmLevel;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    if (n === 0 || n === 1 || n === 2) return n;
    // 非枚举残留（如威胁分）：≥3 视为 HIGH，否则忽略
    if (n >= 3) return 2;
  }
  if (alert.severity === "critical") return 2;
  if (alert.severity === "warning") return 1;
  if (alert.severity === "info") return 0;
  return null;
}

/** 正式告警 HIGH：进告警中心、态势蓝 */
export function isHighThreatAlert(alert: Pick<AlertData, "alarmLevel" | "severity">): boolean {
  return resolveAlertThreatLevel(alert) === 2;
}

/** 预警 MEDIUM：态势黄，不进告警中心列表 */
export function isMediumThreatAlert(alert: Pick<AlertData, "alarmLevel" | "severity">): boolean {
  return resolveAlertThreatLevel(alert) === 1;
}

/** ThreatLevel → 展示名（与 AreaEscalation stageName 一致） */
export function threatLevelName(level: ThreatLevelRank): "LOW" | "MEDIUM" | "HIGH" {
  if (level === 2) return "HIGH";
  if (level === 1) return "MEDIUM";
  return "LOW";
}

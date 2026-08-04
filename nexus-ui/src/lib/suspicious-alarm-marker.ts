/**
 * 判断告警条目是否为「可疑/重点关注」标记（非真实威胁告警）。
 * 标记只应走黄色重点关注，不得进入威胁蓝 / alarmTrackIds。
 */
export function isSuspiciousAlarmMarker(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw || typeof raw !== "object") return false;
  if (raw.is_suspicious === true || raw.isSuspicious === true) return true;
  if (raw.is_suspicious === 1 || raw.isSuspicious === 1) return true;

  const details = String(raw.resolutionDetails ?? raw.resolution_details ?? "")
    .trim()
    .toLowerCase();
  if (details === "is_suspicious" || details.includes("is_suspicious")) return true;

  const content = String(raw.content ?? raw.message ?? "").trim();
  if (content === "SuspiciousTarget") return true;

  const aid = String(raw.alarmId ?? raw.alarm_id ?? raw.id ?? "").trim();
  if (aid.startsWith("suspicious_")) return true;

  const rules = raw.alarmRuleId ?? raw.rule_ids ?? raw.ruleIds;
  const list = Array.isArray(rules) ? rules : rules != null ? [rules] : [];
  for (const r of list) {
    if (String(r ?? "").trim() === "suspicious_target") return true;
  }
  return false;
}

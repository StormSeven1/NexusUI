export const NEXUS_COLORS = {
  bg: {
    base: "#09090b",
    surface: "#111113",
    elevated: "#1a1a1e",
    overlay: "rgba(17, 17, 19, 0.92)",
  },
  border: {
    default: "rgba(255, 255, 255, 0.06)",
    strong: "rgba(255, 255, 255, 0.10)",
    accent: "rgba(176, 180, 188, 0.2)",
  },
  text: {
    primary: "#d4d4d8",
    secondary: "#8b8b93",
    muted: "#52525b",
  },
  accent: {
    default: "#b0b4bc",
    dim: "#5a5d64",
    glow: "rgba(176, 180, 188, 0.06)",
  },
  force: {
    /** 敌方 / 地方目标：蓝 */
    hostile: "#3b82f6",
    /** 友方：默认红；实际优先走业务配置色 */
    friendly: "#ff0000",
    /** 我方：默认与友方一致，实际优先走业务配置色 */
    own: "#ff0000",
    /** 中立：灰 */
    neutral: "#737378",
    /** 未知：浅灰 */
    unknown: "#a1a1aa",
  },
} as const;

export type ForceDisposition =
  | "hostile"
  | "friendly"
  | "own"
  | "neutral"
  | "unknown";

export const FORCE_COLORS: Record<ForceDisposition, string> = {
  hostile: NEXUS_COLORS.force.hostile,
  friendly: NEXUS_COLORS.force.friendly,
  own: NEXUS_COLORS.force.own,
  neutral: NEXUS_COLORS.force.neutral,
  unknown: NEXUS_COLORS.force.unknown,
};

export const FORCE_LABELS: Record<ForceDisposition, string> = {
  hostile: "敌方",
  friendly: "友方",
  own: "我方",
  neutral: "中立",
  unknown: "未知",
};

export function parseForceDisposition(raw: unknown): ForceDisposition | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw === 0) return "friendly";
    if (raw === 1) return "hostile";
    if (raw === 2) return "own";
    if (raw === 3) return "neutral";
    if (raw === 4) return "unknown";
    return undefined;
  }
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  if (s === "0") return "friendly";
  if (s === "1") return "hostile";
  if (s === "2") return "own";
  if (s === "3") return "neutral";
  if (s === "4") return "unknown";
  if (s === "friendly") return "friendly";
  if (s === "hostile") return "hostile";
  if (s === "own") return "own";
  if (s === "neutral") return "neutral";
  if (s === "unknown") return "unknown";
  return undefined;
}

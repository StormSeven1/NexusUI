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
    /** 我方 / 友方：红（与 `factory.assetIcons.friendly` 默认一致） */
    friendly: "#ff0000",
    /** 中立：灰 */
    neutral: "#737378",
  },
} as const;

export type ForceDisposition =
  | "hostile"
  | "friendly"
  | "neutral";

export const FORCE_COLORS: Record<ForceDisposition, string> = {
  hostile: NEXUS_COLORS.force.hostile,
  friendly: NEXUS_COLORS.force.friendly,
  neutral: NEXUS_COLORS.force.neutral,
};

export const FORCE_LABELS: Record<ForceDisposition, string> = {
  hostile: "敌方",
  friendly: "友方",
  neutral: "中立",
};

/** 解析配置 / WS 中的敌我字段；无法识别时返回 `fallback`（静态资产默认友方）。 */
export function parseForceDisposition(raw: unknown, fallback: ForceDisposition = "friendly"): ForceDisposition {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim().toLowerCase();
  if (s === "hostile" || s === "enemy" || s === "敌方" || s === "敌") return "hostile";
  if (s === "friendly" || s === "ally" || s === "友方" || s === "我方") return "friendly";
  if (s === "neutral" || s === "中立") return "neutral";
  return fallback;
}

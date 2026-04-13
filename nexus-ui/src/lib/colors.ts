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
    hostile: "#3b82f6",
    friendly: "#ef4444",
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

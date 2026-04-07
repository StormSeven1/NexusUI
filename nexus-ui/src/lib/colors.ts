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
    hostile: "#e8724a",
    suspect: "#d4932a",
    unknown: "#c9a82b",
    friendly: "#5b9bd5",
    assumedFriend: "#3bb87a",
    neutral: "#737378",
  },
} as const;

export type ForceDisposition =
  | "hostile"
  | "suspect"
  | "unknown"
  | "friendly"
  | "assumed-friend"
  | "neutral";

export const FORCE_COLORS: Record<ForceDisposition, string> = {
  hostile: NEXUS_COLORS.force.hostile,
  suspect: NEXUS_COLORS.force.suspect,
  unknown: NEXUS_COLORS.force.unknown,
  friendly: NEXUS_COLORS.force.friendly,
  "assumed-friend": NEXUS_COLORS.force.assumedFriend,
  neutral: NEXUS_COLORS.force.neutral,
};

export const FORCE_LABELS: Record<ForceDisposition, string> = {
  hostile: "敌方",
  suspect: "可疑",
  unknown: "不明",
  friendly: "友方",
  "assumed-friend": "假定友方",
  neutral: "中立",
};

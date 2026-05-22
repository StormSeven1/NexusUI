/** 系统评估面板内四大评估域（右侧 Tab） */
export const SYSTEM_EVAL_SECTION_TABS = [
  { id: "system", label: "系统评估" },
  { id: "track", label: "航迹评估" },
  { id: "camera", label: "相机评估" },
  { id: "algorithm", label: "算法评估" },
] as const;

export type SystemEvalSectionId = (typeof SYSTEM_EVAL_SECTION_TABS)[number]["id"];

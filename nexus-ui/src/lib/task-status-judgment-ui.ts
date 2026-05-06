"use client";

import {
  glueJudgmentFragments,
  judgmentBodyEndsLikePathContinuation,
} from "@/lib/task-status-pathish";

export type TaskVerifyJudgmentState = {
  /** 已为该气泡展示过 【大模型研判结果】 */
  introShown: boolean;
  /** 研判段落（不含查证头） */
  body: string;
};

/** 整段合法 JSON（模型常见）时用代码块格式化，便于阅读 */
function judgmentFragmentForDisplay(fragment: string): string {
  const t = fragment.trim();
  if (t.length < 2 || !t.startsWith("{") || !t.endsWith("}")) return fragment;
  try {
    const j = JSON.parse(t) as unknown;
    return "\n```json\n" + JSON.stringify(j, null, 2) + "\n```\n";
  } catch {
    return fragment;
  }
}

export function mergeVerifyJudgmentState(
  prev: TaskVerifyJudgmentState | undefined,
  fragment: string,
): TaskVerifyJudgmentState {
  const s: TaskVerifyJudgmentState = prev ?? { introShown: false, body: "" };
  const f = fragment.trim();
  if (!f) return s;
  const disp = judgmentFragmentForDisplay(f);
  if (!s.introShown) {
    return { introShown: true, body: `\n\n【大模型研判结果】\n${disp}` };
  }
  const glue = glueJudgmentFragments(judgmentBodyEndsLikePathContinuation(s.body), f);
  return { introShown: true, body: s.body + glue + disp };
}

/**
 * 相机回调里 `description` 有时是 MinIO 对象路径分片（如 102926028/、20260506163045/），
 * 与中文研判正文区分，供服务端拼 key、客户端合并展示。
 */

const PATHISH_MAX = 200;

/** 无空格、无中文，多为数字/路径/扩展名片段 */
export function isPathishObjectKeyFragment(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > PATHISH_MAX) return false;
  if (/[\s\u3000]/.test(t)) return false;
  if (/[\u4e00-\u9fff]/.test(t)) return false;
  return /^[\w./\-]+$/.test(t);
}

/** 上一段若为路径末尾，本段若为路径片段，应紧 concat 不换行 */
export function glueJudgmentFragments(prevEndsPathish: boolean, nextFrag: string): "" | "\n" {
  if (!isPathishObjectKeyFragment(nextFrag)) return "\n";
  return prevEndsPathish ? "" : "\n";
}

export function judgmentBodyEndsLikePathContinuation(body: string): boolean {
  const t = body.trimEnd();
  if (!t) return false;
  const lastLine = (t.match(/[^\r\n]*$/) ?? [""])[0];
  if (!lastLine) return false;
  return /[/\w.\-]$/.test(lastLine) && isPathishObjectKeyFragment(lastLine);
}

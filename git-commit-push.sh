#!/usr/bin/env bash
# NexusUI 一键 git add → commit → push（在仓库根 NexusUI/ 执行）
#
# 用法:
#   chmod +x git-commit-push.sh
#   ./git-commit-push.sh -m "feat: 说明"
#   ./git-commit-push.sh -m "fix: xxx" -y          # 不询问直接提交并推送
#   ./git-commit-push.sh --no-push -m "wip"        # 只提交不推送
#   ./git-commit-push.sh --pull -m "sync" -y       # 先 git pull --ff-only 再提交推送
#
# 环境变量:
#   GIT_BIN   默认优先 /usr/bin/git（避免 shell 包装 git 导致 commit 报 trailer 错误）
#   GIT_REMOTE  默认 origin

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

GIT_BIN="${GIT_BIN:-}"
if [[ -z "$GIT_BIN" ]]; then
  if [[ -x /usr/bin/git ]]; then
    GIT_BIN=/usr/bin/git
  else
    GIT_BIN="$(command -v git)"
  fi
fi

GIT_REMOTE="${GIT_REMOTE:-origin}"
DO_PULL=0
DO_PUSH=1
SKIP_CONFIRM=0
COMMIT_MSG=""

# 默认不纳入提交的备份/副本（避免误提交 copy 文件）
EXCLUDE_PATHS=(
  "Custombackend/app/config copy.py"
  "nexus-ui/public/app-config copy.json"
)

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \?//'
  echo ""
  echo "选项:"
  echo "  -m, --message <msg>   提交说明（必填；未给则报错退出）"
  echo "  -y, --yes             跳过确认"
  echo "  --pull                提交前 git pull --ff-only"
  echo "  --no-push             只 commit，不 push"
  echo "  -h, --help            显示帮助"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      COMMIT_MSG="${2:-}"
      shift 2
      ;;
    -y|--yes) SKIP_CONFIRM=1; shift ;;
    --pull) DO_PULL=1; shift ;;
    --no-push) DO_PUSH=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$COMMIT_MSG" ]]; then
  echo "错误: 请用 -m 提供提交说明，例如:" >&2
  echo "  $0 -m \"feat: 光电与航迹更新\" -y" >&2
  exit 1
fi

if ! "$GIT_BIN" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误: $ROOT 不是 git 仓库" >&2
  exit 1
fi

BRANCH="$("$GIT_BIN" branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "错误: 无法获取当前分支" >&2
  exit 1
fi

echo "== NexusUI git-commit-push =="
echo "目录:   $ROOT"
echo "git:    $GIT_BIN"
echo "分支:   $BRANCH"
echo "远程:   $GIT_REMOTE"
echo "说明:   $COMMIT_MSG"
echo "推送:   $([[ "$DO_PUSH" -eq 1 ]] && echo 是 || echo 否)"
echo ""

if [[ "$DO_PULL" -eq 1 ]]; then
  echo "== git pull --ff-only =="
  "$GIT_BIN" pull --ff-only "$GIT_REMOTE" "$BRANCH" || "$GIT_BIN" pull --ff-only
  echo ""
fi

if "$GIT_BIN" diff --quiet && "$GIT_BIN" diff --cached --quiet && [[ -z "$("$GIT_BIN" ls-files --others --exclude-standard)" ]]; then
  echo "没有可提交的变更，已退出。"
  exit 0
fi

echo "== 变更摘要 =="
"$GIT_BIN" status -sb
echo ""

if [[ "$SKIP_CONFIRM" -ne 1 ]]; then
  read -r -p "确认 add + commit$([[ "$DO_PUSH" -eq 1 ]] && echo ' + push' || echo '')? [y/N] " ans
  case "${ans:-}" in
    y|Y|yes|YES) ;;
    *) echo "已取消。"; exit 0 ;;
  esac
fi

echo "== git add =="
"$GIT_BIN" add -A
for p in "${EXCLUDE_PATHS[@]}"; do
  if [[ -e "$p" ]] || "$GIT_BIN" ls-files --error-unmatch "$p" >/dev/null 2>&1; then
    "$GIT_BIN" reset HEAD -- "$p" 2>/dev/null || true
  fi
done

if "$GIT_BIN" diff --cached --quiet; then
  echo "暂存区为空（可能仅有已排除的 copy 文件），已退出。"
  exit 0
fi

echo "== git commit =="
MSG_FILE="$(mktemp)"
trap 'rm -f "$MSG_FILE"' EXIT
printf '%s\n' "$COMMIT_MSG" >"$MSG_FILE"
"$GIT_BIN" commit -F "$MSG_FILE"

echo ""
if [[ "$DO_PUSH" -eq 1 ]]; then
  echo "== git push =="
  if "$GIT_BIN" rev-parse --abbrev-ref "@{u}" >/dev/null 2>&1; then
    "$GIT_BIN" push "$GIT_REMOTE" "$BRANCH"
  else
    echo "当前分支未设置上游，使用: push -u $GIT_REMOTE $BRANCH"
    "$GIT_BIN" push -u "$GIT_REMOTE" "$BRANCH"
  fi
  echo ""
  echo "✅ 已提交并推送到 $GIT_REMOTE/$BRANCH"
else
  echo "✅ 已提交（未推送）。推送请执行:"
  echo "   $GIT_BIN push -u $GIT_REMOTE $BRANCH"
fi

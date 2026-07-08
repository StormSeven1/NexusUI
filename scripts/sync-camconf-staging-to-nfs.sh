#!/usr/bin/env bash
# 将 NexusUI/.camconf-staging 中暂存的 cam/cam*.txt 追加合并到 200T NFS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING="${NEXUS_EO_CALC_RECORD_STAGING_DIR:-${ROOT}/.camconf-staging}"
NFS_CAM="${NEXUS_EO_CALC_RECORD_CAM_CONF_DIR:-/mnt/nfs_200T/camconf}"

if [[ ! -d "$STAGING" ]]; then
  echo "无暂存目录: $STAGING"
  exit 0
fi

for sub in cam camsky; do
  src_dir="${STAGING}/${sub}"
  dst_dir="${NFS_CAM}/${sub}"
  [[ -d "$src_dir" ]] || continue
  mkdir -p "$dst_dir"
  shopt -s nullglob
  for f in "$src_dir"/cam*.txt; do
    base="$(basename "$f")"
    dst="${dst_dir}/${base}"
    if [[ ! -f "$dst" ]]; then
      cp "$f" "$dst"
      echo "已复制 $f -> $dst"
    else
      cat "$f" >> "$dst"
      echo "已追加 $f -> $dst"
    fi
    rm -f "$f"
  done
  shopt -u nullglob
done

echo "完成。请确认: ls -la ${NFS_CAM}/cam/cam4.txt"

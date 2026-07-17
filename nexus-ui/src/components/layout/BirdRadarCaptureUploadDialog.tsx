"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadBirdRadarCaptureCsv } from "@/lib/bird-radar-capture-upload";

type Props = {
  open: boolean;
  onClose: () => void;
  fileName: string;
  rowCount: number;
  blob: Blob | null;
  autoStopped?: boolean;
  onStatus?: (line: string) => void;
  onSuccess?: (repoPath: string) => void;
  onError?: (message: string) => void;
};

export function BirdRadarCaptureUploadDialog({
  open,
  onClose,
  fileName,
  rowCount,
  blob,
  autoStopped = false,
  onStatus,
  onSuccess,
  onError,
}: Props) {
  const [status, setStatus] = useState("状态：等待上传");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(autoStopped ? "状态：采集已自动结束，等待上传" : "状态：采集已结束，等待上传");
    setBusy(false);
    setFailed(false);
  }, [open, autoStopped, fileName]);

  if (!open) return null;

  const pushStatus = (line: string) => {
    setStatus(`状态：${line}`);
    onStatus?.(line);
  };

  const onUpload = async () => {
    if (busy || !fileName.trim()) return;
    setBusy(true);
    setFailed(false);
    pushStatus(`正在上传 ${fileName}（${rowCount} 行）…`);

    const result = await uploadBirdRadarCaptureCsv({
      fileName,
      blob,
      onStatus: pushStatus,
    });

    if (!result.ok) {
      setFailed(true);
      const msg = result.detail ? `${result.error}（${result.detail}）` : result.error;
      pushStatus(`上传失败！\n${msg}`);
      onError?.(msg);
      setBusy(false);
      return;
    }

    pushStatus(`上传成功！\n仓库路径：${result.repoPath}`);
    onSuccess?.(result.repoPath);
    setBusy(false);
    window.setTimeout(() => onClose(), 1500);
  };

  const dialog = (
    <div
      className="pointer-events-auto fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#1e2228] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-medium">上传探鸟雷达 CSV</h2>
          <button
            type="button"
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs text-white/75">
          <p>
            文件：<span className="text-white">{fileName}</span>
          </p>
          <p>行数：{rowCount}</p>
          {autoStopped ? (
            <p className="text-amber-200/90">超过 1 分钟未再出现「自报位+探鸟」融合航迹，采集已自动停止。</p>
          ) : null}
        </div>

        <pre
          className={cn(
            "mx-4 mb-4 min-h-[72px] whitespace-pre-wrap rounded border px-3 py-2 text-[11px] leading-relaxed",
            failed
              ? "border-red-500/40 bg-red-950/30 text-red-100"
              : status.includes("成功")
                ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-100"
                : busy
                  ? "border-amber-500/40 bg-amber-950/30 text-amber-100"
                  : "border-white/10 bg-black/25 text-white/80",
          )}
        >
          {!blob ? "状态：将使用服务端已采集 CSV 上传" : status}
        </pre>

        <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <Button type="button" size="sm" disabled={!fileName.trim() || busy} onClick={() => void onUpload()}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                上传中
              </>
            ) : (
              "上传到 DataLink"
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}

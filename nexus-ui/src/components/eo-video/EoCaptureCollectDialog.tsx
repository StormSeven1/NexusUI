"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  eoCollectUploadTypesForStream,
  uploadEoCaptureCollect,
  type EoCollectDataType,
  type EoCollectUploadType,
} from "@/lib/eo-video/eoCaptureCollectUpload";

type Props = {
  open: boolean;
  onClose: () => void;
  isUav: boolean;
  kind: "snapshot" | "record";
  blob: Blob | null;
  fileName: string;
  dataType: EoCollectDataType;
  onStatus?: (line: string) => void;
  onSuccess?: (repoPath: string) => void;
  onError?: (message: string) => void;   
};

export function EoCaptureCollectDialog({
  open,
  onClose,
  isUav,
  kind,
  blob,
  fileName,
  dataType,
  onStatus,
  onSuccess,
  onError,
}: Props) {
  const options = eoCollectUploadTypesForStream(isUav);
  const [uploadType, setUploadType] = useState<EoCollectUploadType>(options[0]);
  const [status, setStatus] = useState("状态：等待上传");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUploadType(eoCollectUploadTypesForStream(isUav)[0]);
    setStatus("状态：等待上传");
    setBusy(false);
    setFailed(false);
  }, [open, isUav, fileName]);

  if (!open) return null;

  const title = kind === "snapshot" ? "上传图片文件" : "上传视频文件";
  const canUpload = Boolean(blob) && !busy;

  const pushStatus = (line: string) => {
    setStatus(`状态：${line}`);
    onStatus?.(line);
  };

  const onUpload = async () => {
    if (!blob || busy) return;
    setBusy(true);
    setFailed(false);
    pushStatus(`正在上传…\n文件：${fileName}\n类型：${uploadType}`);

    const result = await uploadEoCaptureCollect({
      blob,
      fileName,
      uploadType,
      dataType,
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

    pushStatus(`上传成功！\n文件：${fileName}\n类型：${uploadType}`);
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
          <h2 className="text-sm font-medium">{title}</h2>
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

        <div className="space-y-4 px-4 py-4">
          <p className="text-xs text-white/70">请选择上传类型：</p>
          <div className="space-y-2">
            {options.map((opt) => (
              <label
                key={opt}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors",
                  uploadType === opt
                    ? "border-sky-500/60 bg-sky-950/40"
                    : "border-white/10 hover:border-white/25",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="eo-collect-upload-type"
                  className="accent-sky-500"
                  checked={uploadType === opt}
                  disabled={busy}
                  onChange={() => setUploadType(opt)}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>

          <pre
            className={cn(
              "min-h-[72px] whitespace-pre-wrap rounded border px-3 py-2 text-[11px] leading-relaxed",
              failed
                ? "border-red-500/40 bg-red-950/30 text-red-100"
                : status.includes("成功")
                  ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-100"
                  : busy
                    ? "border-amber-500/40 bg-amber-950/30 text-amber-100"
                    : "border-white/10 bg-black/25 text-white/80",
            )}
          >
            {!blob ? "状态：无文件数据，请关闭后重新截图/录像再采集" : status}
          </pre>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <Button type="button" size="sm" disabled={!canUpload} onClick={() => void onUpload()}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                上传中
              </>
            ) : (
              "开始上传"
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}

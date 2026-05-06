"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EoSnapshotPreviewPayload = {
  kind: "snapshot" | "record";
  objectUrl: string;
  blob: Blob;
  fileName: string;
};

type Props = {
  preview: EoSnapshotPreviewPayload;
  onDismiss: () => void;
  /** 打开文件路径（目录选择器定位到当前保存目录） */
  onOpen: () => void | Promise<void>;
  /** 采集：业务预留（录屏） */
  onCollect: () => void | Promise<void>;
  /** 分析：截图专用 */
  onAnalyze: () => void | Promise<void>;
};

/**
 * 贴在右侧截图工具列左侧的无边框小预览：从左侧滑入，下图「采集」「分析」。
 */
export function EoSnapshotPreviewPopout({ preview, onDismiss, onOpen, onCollect, onAnalyze }: Props) {
  const [entered, setEntered] = useState(false);
  const [busy, setBusy] = useState<"open" | "collect" | "analyze" | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const run = useCallback(
    async (kind: "open" | "collect" | "analyze") => {
      if (busy) return;
      setBusy(kind);
      try {
        if (kind === "open") await onOpen();
        else if (kind === "collect") await onCollect();
        else await onAnalyze();
      } finally {
        setBusy(null);
      }
    },
    [busy, onAnalyze, onCollect, onOpen],
  );

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-[min(46vw,200px)] shrink-0 flex-col gap-1.5 bg-black/60 py-1.5 pl-1.5 pr-1 shadow-[0_6px_28px_rgba(0,0,0,0.55)] backdrop-blur-[6px]",
        "transition-[transform,opacity] duration-300 ease-out",
        entered ? "translate-x-0 opacity-100" : "-translate-x-[110%] opacity-0",
      )}
      role="region"
      aria-label="截图预览"
    >
      <div className="relative min-h-0">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded text-white/45 transition-colors hover:bg-white/10 hover:text-white/90"
          title="关闭预览"
          aria-label="关闭预览"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
        {preview.kind === "snapshot" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.objectUrl}
            alt=""
            className="max-h-[min(22vh,140px)] w-full object-contain object-left"
          />
        ) : (
          <video
            src={preview.objectUrl}
            className="max-h-[min(22vh,140px)] w-full object-contain object-left"
            muted
            playsInline
            controls
          />
        )}
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="h-7 flex-1 rounded-none border-0 bg-white/15 text-[10px] text-white hover:bg-white/25"
          disabled={busy !== null}
          onClick={() => void run("open")}
        >
          {busy === "open" ? "…" : "打开"}
        </Button>
        <Button
          type="button"
          size="xs"
          className="h-7 flex-1 rounded-none border-0 bg-sky-600/80 text-[10px] text-white hover:bg-sky-500/90"
          disabled={busy !== null}
          onClick={() => void run(preview.kind === "snapshot" ? "analyze" : "collect")}
        >
          {busy === "collect" ? "…" : busy === "analyze" ? "…" : preview.kind === "snapshot" ? "分析" : "采集"}
        </Button>
      </div>
    </div>
  );
}

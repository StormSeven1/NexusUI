"use client";

/**
 * 告警行缩略图：按 unique_id 拉取最新查证图，点击放大预览。
 * - 以 trackId 为挂载 key，内部解析 uniqueId，避免航迹未就绪时反复卸载闪屏
 * - 模块级缓存 + 粘性 URL：已有图不因轮询失败或短暂空结果消失
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { subscribeTaskStatusChat } from "@/lib/task-status-chat-feed-bus";
import { pickTaskStatusImageUrl } from "@/lib/task-status-chat-format";
import { resolveVerifyUniqueId } from "@/lib/verified-track-from-task-status";
import { useTrackStore } from "@/stores/track-store";
import { resolveTrackFromAlarmTrackId } from "@/lib/run-gis-track-verification";
import { resolveUniqueIdFromTrack } from "@/lib/alarm-confirm-api";

const ALERT_THUMB_POLL_MS = 5000;

type ScreenshotItem = { url: string; sig: string };

/** 会话内缓存：uniqueId / trackId → 最近成功拉取的图 */
const screenshotCache = new Map<string, ScreenshotItem>();
const screenshotCacheByTrack = new Map<string, ScreenshotItem>();

function readCachedUrl(uniqueId: string | null, trackId: string | null): ScreenshotItem | null {
  const tid = trackId?.trim();
  if (tid && screenshotCacheByTrack.has(tid)) return screenshotCacheByTrack.get(tid)!;
  const uid = uniqueId?.trim();
  if (uid && screenshotCache.has(uid)) return screenshotCache.get(uid)!;
  return null;
}

function storeCached(item: ScreenshotItem, uniqueId: string, trackId: string | null) {
  screenshotCache.set(uniqueId, item);
  const tid = trackId?.trim();
  if (tid) screenshotCacheByTrack.set(tid, item);
}

function isDigitsUniqueId(s: string | null | undefined): s is string {
  const t = (s ?? "").trim();
  return t.length > 0 && /^\d+$/.test(t);
}

function itemSig(item: { bucket?: string; objectKey?: string; url?: string }): string {
  const b = item.bucket?.trim();
  const k = item.objectKey?.trim();
  if (b && k) return `${b}\0${k}`;
  return item.url?.trim() ?? "";
}

async function fetchLatestScreenshot(uniqueId: string): Promise<ScreenshotItem | null> {
  const q = new URLSearchParams();
  q.set("uniqueId", uniqueId);
  q.set("limit", "1");
  const res = await fetch(`/api/track-screenshots?${q.toString()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    items?: { url?: string; bucket?: string; objectKey?: string }[];
  };
  const raw = Array.isArray(j.items) ? j.items[0] : undefined;
  if (!raw) return null;
  const url = raw.url?.trim();
  if (!url) return null;
  const sig = itemSig(raw);
  if (!sig) return null;
  return { url, sig };
}

function resolveUniqueIdForThumb(
  trackId: string | null | undefined,
  preferredUniqueId: string | null | undefined,
  shadowTracks: ReadonlyMap<string, import("@/lib/map-entity-model").Track>,
): string | null {
  if (isDigitsUniqueId(preferredUniqueId)) return preferredUniqueId.trim();
  const tid = trackId?.trim();
  if (!tid) return null;
  const track = resolveTrackFromAlarmTrackId(tid, shadowTracks, undefined);
  if (!track) return null;
  const uid = resolveUniqueIdFromTrack(track);
  return uid != null ? String(uid) : null;
}

type Props = {
  /** 告警航迹 ID，用于组件稳定挂载与 uniqueId 回退解析 */
  trackId: string | null;
  /** 告警条目自带的 uniqueID（若有则优先） */
  preferredUniqueId?: string | null;
  className?: string;
};

export const AlertScreenshotThumb = memo(function AlertScreenshotThumb({
  trackId,
  preferredUniqueId,
  className,
}: Props) {
  const shadowTracks = useTrackStore((s) => s.shadowTracks);
  const uniqueId = useMemo(
    () => resolveUniqueIdForThumb(trackId, preferredUniqueId, shadowTracks),
    [trackId, preferredUniqueId, shadowTracks],
  );


  const [url, setUrl] = useState<string | null>(() => readCachedUrl(uniqueId, trackId)?.url ?? null);
  const sigRef = useRef<string | null>(readCachedUrl(uniqueId, trackId)?.sig ?? null);

  const urlRef = useRef(url);
  urlRef.current = url;

  const [previewOpen, setPreviewOpen] = useState(false);
  const [pollGen, setPollGen] = useState(0);

  /** uniqueId 变化时从缓存恢复，不主动清空已有图 */
  useEffect(() => {
    setPollGen(0);
    setPreviewOpen(false);
    const cached = readCachedUrl(uniqueId, trackId);
    if (cached) {
      sigRef.current = cached.sig;
      setUrl(cached.url);
    }
  }, [uniqueId, trackId]);

  /** 尚无图时定时轮询；已有图则仅 SSE 触发刷新 */
  useEffect(() => {
    if (urlRef.current) return;
    const id = setInterval(() => setPollGen((n) => n + 1), ALERT_THUMB_POLL_MS);
    return () => clearInterval(id);
  }, [uniqueId, trackId, url]);

  useEffect(() => {
    if (!isDigitsUniqueId(uniqueId)) return;
    return subscribeTaskStatusChat((payload) => {
      if (!pickTaskStatusImageUrl(payload)) return;
      const uid = resolveVerifyUniqueId(payload, useTrackStore.getState().tracks);
      if (uid && uid === uniqueId.trim()) {
        setPollGen((n) => n + 1);
      }
    });
  }, [uniqueId]);

  useEffect(() => {
    if (!isDigitsUniqueId(uniqueId)) return;

    let cancelled = false;
    const uid = uniqueId.trim();

    void fetchLatestScreenshot(uid)
      .then((next) => {
        if (cancelled) return;
        if (!next) return;
        if (next.sig === sigRef.current && next.url === urlRef.current) return;
        sigRef.current = next.sig;
        storeCached(next, uid, trackId);
        setUrl(next.url);
      })
      .catch(() => {
        /* 保留粘性 URL / 缓存，不因网络抖动清空 */
      });

    return () => {
      cancelled = true;
    };
  }, [uniqueId, trackId, pollGen]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  if (!url) return null;

  return (
    <>
      <button
        type="button"
        title="查看最新查证图"
        aria-label="查看最新查证图"
        className={cn(
          "relative size-6 shrink-0 overflow-hidden rounded border border-white/10 bg-black/40 transition-[border-color,box-shadow] hover:border-cyan-400/50 hover:ring-1 hover:ring-cyan-400/30",
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          setPreviewOpen(true);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          loading="eager"
          decoding="async"
        />
      </button>

      {previewOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-auto fixed inset-0 z-[10050] flex items-center justify-center bg-black/85 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="查证图片预览"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setPreviewOpen(false);
              }}
            >
              <button
                type="button"
                aria-label="关闭"
                className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white transition hover:bg-black/80"
                onClick={() => setPreviewOpen(false)}
              >
                <X className="size-5" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="查证图片"
                className="max-h-[90vh] max-w-[min(90vw,1200px)] object-contain shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
});

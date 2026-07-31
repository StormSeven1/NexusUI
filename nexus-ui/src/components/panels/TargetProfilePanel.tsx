"use client";

/**
 * 右侧栏「目标档案」：航迹快照 + 查证相册（仅按 unique_id 查库）。
 * 轮询：无航迹或无新图片时不更新界面；首查可显加载，后续静默拉取。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Crosshair } from "lucide-react";
import { TrackMarkerIcon } from "@/components/military/TrackMarkerIcon";
import { cn } from "@/lib/utils";
import { trackMapDisplayId, type Track } from "@/lib/map-entity-model";
import { subscribeTaskStatusChat } from "@/lib/task-status-chat-feed-bus";
import { pickTaskStatusImageUrl } from "@/lib/task-status-chat-format";
import { resolveVerifyUniqueId } from "@/lib/verified-track-from-task-status";
import { useTrackStore } from "@/stores/track-store";
import { useTargetProfileStore } from "@/stores/target-profile-store";
import { useAssetStore } from "@/stores/asset-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { resolveTrackLayerKey, TRACK_SUBTYPE_LABELS } from "@/lib/track-layer-visibility";
import { formatTrackSpeed } from "@/lib/track-speed-format";

const PROFILE_POLL_MS = 5000;

/** `camera_index` 存的是 entity_id，据此解析展示用相机名称 */
function resolveCameraSourceName(
  entityIdRaw: string,
  cameraRows: ReadonlyArray<{ entityId: string; label: string }>,
  assets: ReadonlyArray<{ id: string; name: string }>,
): string {
  const id = canonicalEntityId(entityIdRaw.trim());
  if (!id) return "";
  const fromMenu = cameraRows.find((r) => canonicalEntityId(r.entityId) === id)?.label?.trim();
  if (fromMenu) return fromMenu;
  const fromAsset = assets.find((a) => canonicalEntityId(a.id) === id)?.name?.trim();
  if (fromAsset) return fromAsset;
  return id;
}

function formatDistanceM(m: number | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function formatDeg(v: number | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)}°`;
}

function formatAlt(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(0)} m`;
}

function displayTitle(t: Track): string {
  return trackMapDisplayId(t);
}

function isDigitsUniqueId(s: string | undefined | null): boolean {
  const t = (s ?? "").trim();
  return t.length > 0 && /^\d+$/.test(t);
}

type ProfileShot = { url: string; cameraIndex: string; uploadedAt: string };

function shotsEqual(a: readonly ProfileShot[], b: readonly ProfileShot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.url === b[i]!.url &&
      s.cameraIndex === b[i]!.cameraIndex &&
      s.uploadedAt === b[i]!.uploadedAt,
  );
}

/** 库表 uploaded_at → 本地可读拍摄时间 */
function formatShotUploadedAt(iso: string | undefined): string {
  const raw = (iso ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 半宽一格：一行里展示「一项」信息（两列并排即一行两项） */
function PairCell({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded border border-white/[0.07] bg-white/[0.03] px-2 py-1",
        className,
      )}
    >
      <div className="text-[10px] font-medium leading-none text-nexus-text-muted">{k}</div>
      <div
        className="mt-1 line-clamp-2 break-all text-[11px] font-normal leading-snug text-nexus-text-primary [font-variant-numeric:tabular-nums]"
        title={v}
      >
        {v}
      </div>
    </div>
  );
}

export function TargetProfilePanel() {
  const focusedShowId = useTargetProfileStore((s) => s.focusedShowId);
  const liveTrack = useTrackStore((s) =>
    focusedShowId ? s.tracks.find((t) => t.showID === focusedShowId) : undefined,
  );
  const assets = useAssetStore((s) => s.assets);
  const cameraRows = useMapGisCameraMenuStore((s) => s.rows);

  useEffect(() => {
    void useMapGisCameraMenuStore.getState().ensureLoaded();
  }, []);

  const resolveSourceName = useCallback(
    (entityId: string) => resolveCameraSourceName(entityId, cameraRows, assets),
    [cameraRows, assets],
  );

  const [snapTrack, setSnapTrack] = useState<Track | null>(null);
  useEffect(() => {
    setSnapTrack(null);
  }, [focusedShowId]);
  useEffect(() => {
    if (liveTrack) setSnapTrack(liveTrack);
  }, [liveTrack]);

  const displayTrack = liveTrack ?? snapTrack;

  const [imagePollGen, setImagePollGen] = useState(0);
  useEffect(() => {
    setImagePollGen(0);
  }, [focusedShowId]);
  useEffect(() => {
    if (!focusedShowId) return;
    const id = setInterval(() => setImagePollGen((n) => n + 1), PROFILE_POLL_MS);
    return () => clearInterval(id);
  }, [focusedShowId]);

  /** 查证 SSE 落库后立刻刷新相册，不必等 5s 轮询 */
  useEffect(() => {
    if (!focusedShowId) return;
    return subscribeTaskStatusChat((payload) => {
      if (!pickTaskStatusImageUrl(payload)) return;
      const tracks = useTrackStore.getState().tracks;
      const uid = resolveVerifyUniqueId(payload, tracks);
      const focused = tracks.find((t) => t.showID === focusedShowId);
      const focusedUid = focused?.uniqueID?.trim() || focusedShowId.trim();
      if (uid && focusedUid && uid === focusedUid) {
        setImagePollGen((n) => n + 1);
      }
    });
  }, [focusedShowId]);

  const [shots, setShots] = useState<ProfileShot[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const shotsRef = useRef<ProfileShot[]>([]);
  shotsRef.current = shots;
  const touchStartX = useRef<number | null>(null);
  const thumbStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shots.length < 2) return;
    const strip = thumbStripRef.current;
    if (!strip) return;
    const el = strip.querySelector(`[data-thumb-idx="${imgIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [imgIdx, shots.length]);

  useEffect(() => {
    setShots([]);
    setImgIdx(0);
    setImgLoading(false);
  }, [focusedShowId]);

  const layerLabel = useMemo(() => {
    if (!displayTrack) return "—";
    const k = resolveTrackLayerKey(displayTrack);
    return TRACK_SUBTYPE_LABELS[k] ?? k;
  }, [displayTrack]);

  const sourceText = useMemo(() => {
    if (!displayTrack) return "—";
    return displayTrack.sensor?.trim() || displayTrack.dataSourceId?.trim() || "—";
  }, [displayTrack]);

  useEffect(() => {
    setImgIdx(0);
  }, [displayTrack?.showID, displayTrack?.uniqueID]);

  useEffect(() => {
    if (!focusedShowId || !displayTrack) return;

    const uid = displayTrack.uniqueID?.trim() ?? "";
    if (!isDigitsUniqueId(uid)) {
      setShots([]);
      return;
    }

    const silentPoll = imagePollGen > 0;
    let cancelled = false;

    if (!silentPoll) setImgLoading(true);

    const q = new URLSearchParams();
    q.set("uniqueId", uid);
    q.set("limit", "10");

    fetch(`/api/track-screenshots?${q.toString()}`, { cache: "no-store" })
      .then(
        (r) =>
          r.json() as Promise<{
            ok?: boolean;
            items?: { url?: string; cameraIndex?: string; uploadedAt?: string }[];
          }>,
      )
      .then((j) => {
        if (cancelled) return;
        const list: ProfileShot[] = Array.isArray(j.items)
          ? j.items
              .map((x) => ({
                url: (x.url ?? "").trim(),
                cameraIndex: (x.cameraIndex ?? "").trim(),
                uploadedAt: (x.uploadedAt ?? "").trim(),
              }))
              .filter((x) => Boolean(x.url))
          : [];
        if (shotsEqual(shotsRef.current, list)) {
          return;
        }
        setShots(list);
        setImgIdx((i) => (list.length === 0 ? 0 : Math.min(i, list.length - 1)));
      })
      .catch(() => {
        if (!cancelled && !silentPoll) setShots([]);
      })
      .finally(() => {
        if (!cancelled && !silentPoll) setImgLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [focusedShowId, displayTrack?.showID, displayTrack?.uniqueID, imagePollGen]);

  const prevPic = useCallback(() => {
    setImgIdx((i) => (shots.length ? (i <= 0 ? shots.length - 1 : i - 1) : 0));
  }, [shots.length]);

  const nextPic = useCallback(() => {
    setImgIdx((i) => (shots.length ? (i + 1 >= shots.length ? 0 : i + 1) : 0));
  }, [shots.length]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null || shots.length < 2) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    if (dx > 40) prevPic();
    else if (dx < -40) nextPic();
  };

  const currentShot = shots[imgIdx];
  const sourceEntityId = currentShot?.cameraIndex?.trim() || "";
  const sourceLabel = sourceEntityId ? resolveSourceName(sourceEntityId) : "";
  const shotTimeLabel = currentShot?.uploadedAt
    ? formatShotUploadedAt(currentShot.uploadedAt)
    : "";

  if (!focusedShowId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#0e1116] px-3 py-4 text-center">
        <Crosshair className="size-7 text-cyan-500/70" strokeWidth={1.25} />
        <p className="max-w-[200px] text-[12px] leading-relaxed text-nexus-text-muted">
          地图<strong className="text-nexus-text-secondary">双击</strong>航迹查看档案
        </p>
      </div>
    );
  }

  if (!displayTrack) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
        <p className="text-[12px] text-nexus-text-secondary">未找到航迹</p>
        <p className="font-mono text-[11px] text-nexus-text-muted">{focusedShowId}</p>
      </div>
    );
  }

  const t = displayTrack;
  const brg = t.course ?? t.heading;
  const spd = formatTrackSpeed(t.speed);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-[#0e1116]",
        "font-sans text-nexus-text-primary antialiased",
      )}
    >
      <div className="shrink-0 border-b border-white/10 px-2.5 py-1.5">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex shrink-0 items-center">
            <TrackMarkerIcon track={t} size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="shrink-0 truncate text-[13px] font-semibold tracking-tight text-nexus-text-primary">
                {displayTitle(t)}
              </span>
              {sourceText !== "—" ? (
                <span
                  className="min-w-0 max-w-full truncate text-[11px] font-medium leading-snug text-violet-300/95"
                  title={sourceText}
                >
                  <span className="text-nexus-text-muted/50" aria-hidden>
                    ·
                  </span>
                  {sourceText}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 font-mono text-[11px] leading-relaxed text-nexus-text-muted/95">
              <span className="text-nexus-text-muted/80">uniqueID</span> {t.uniqueID || "—"}
              {t.trackId && t.trackId !== t.uniqueID ? (
                <span className="ml-2 text-nexus-text-muted/70">trackId {t.trackId}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-white/[0.06] px-2.5 pb-1.5 pt-1">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <PairCell k="类型" v={layerLabel} />
          <PairCell k="距离" v={formatDistanceM(t.distance)} />
          <PairCell k="方位" v={formatDeg(t.azimuth)} />
          <PairCell k="速度" v={spd} />
          <PairCell k="航向" v={formatDeg(brg)} />
          <PairCell k="高度" v={formatAlt(t.altitude)} />
        </div>
      </div>

      <div className="relative flex min-h-[140px] flex-1 basis-0 flex-col px-2 pb-2 pt-1">
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-zinc-900/90 via-zinc-950/95 to-black shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {/* 左侧：主图 */}
          <div
            className="relative min-h-0 min-w-0 flex-1"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {shots.length > 0 ? (
              <>
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-8 bg-gradient-to-b from-black/45 to-transparent"
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-8 bg-gradient-to-t from-black/45 to-transparent"
                  aria-hidden
                />
              </>
            ) : null}

            {imgLoading ? (
              <div className="relative z-0 flex h-full items-center justify-center text-[11px] text-nexus-text-muted">
                加载中…
              </div>
            ) : shots.length === 0 ? (
              <div className="h-full w-full bg-black/25" aria-hidden />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={currentShot!.url}
                src={currentShot!.url}
                alt=""
                className="relative z-0 h-full w-full object-contain"
                draggable={false}
              />
            )}

            {sourceLabel || shotTimeLabel ? (
              <div
                className="pointer-events-none absolute left-2 top-2 z-[2] max-w-[calc(100%-4.5rem)] rounded border border-white/15 bg-black/55 px-1.5 py-1 text-[10px] font-medium leading-snug text-cyan-100/95 shadow-sm backdrop-blur-sm"
                title={[
                  sourceLabel
                    ? sourceEntityId && sourceEntityId !== sourceLabel
                      ? `来源 ${sourceLabel}（${sourceEntityId}）`
                      : `来源 ${sourceLabel}`
                    : "",
                  shotTimeLabel ? `拍摄时间 ${shotTimeLabel}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {sourceLabel ? (
                  <div className="truncate">
                    <span className="text-white/45">来源 </span>
                    {sourceLabel}
                  </div>
                ) : null}
                {shotTimeLabel ? (
                  <div className={cn("truncate [font-variant-numeric:tabular-nums]", sourceLabel && "mt-0.5")}>
                    <span className="text-white/45">拍摄时间 </span>
                    {shotTimeLabel}
                  </div>
                ) : null}
              </div>
            ) : null}

            {shots.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="上一张"
                  className="absolute left-2 top-1/2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-lg backdrop-blur-md transition hover:bg-white/20 hover:border-cyan-400/40"
                  onClick={prevPic}
                >
                  <ChevronLeft className="size-5 opacity-90" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label="下一张"
                  className="absolute right-2 top-1/2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-lg backdrop-blur-md transition hover:bg-white/20 hover:border-cyan-400/40"
                  onClick={nextPic}
                >
                  <ChevronRight className="size-5 opacity-90" strokeWidth={2} />
                </button>
              </>
            ) : null}
          </div>

          {/* 右侧：纵向缩略图 */}
          {shots.length > 1 ? (
            <div className="flex min-h-0 w-[52px] shrink-0 flex-col border-l border-white/[0.1] bg-black/50 backdrop-blur-sm">
              <div
                ref={thumbStripRef}
                className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden px-1 py-1.5 [scrollbar-width:thin]"
                style={{ scrollbarColor: "rgba(255,255,255,0.2) transparent" }}
              >
                {shots.map((shot, i) => {
                  const thumbSource = shot.cameraIndex
                    ? resolveSourceName(shot.cameraIndex)
                    : "";
                  return (
                  <button
                    key={`${i}:${shot.url}`}
                    type="button"
                    data-thumb-idx={i}
                    aria-label={
                      thumbSource
                        ? `查看第 ${i + 1} 张，来源 ${thumbSource}`
                        : `查看第 ${i + 1} 张`
                    }
                    title={thumbSource ? `来源 ${thumbSource}` : undefined}
                    aria-current={i === imgIdx ? "true" : undefined}
                    onClick={() => setImgIdx(i)}
                    className={cn(
                      "relative h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 transition-all duration-200",
                      i === imgIdx
                        ? "border-cyan-400/90 shadow-[0_0_10px_-2px_rgba(34,211,238,0.5)] ring-1 ring-cyan-400/30"
                        : "border-transparent opacity-75 hover:opacity-100 hover:ring-1 hover:ring-white/15",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.url} alt="" className="h-full w-full object-cover" draggable={false} />
                    {i === imgIdx ? (
                      <span className="pointer-events-none absolute inset-0 bg-cyan-400/10" aria-hidden />
                    ) : null}
                  </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

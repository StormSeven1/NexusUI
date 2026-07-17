"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Cloud,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Info,
  Loader2,
  Sun,
  Thermometer,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 与 Qt `TopInfoPanel` 定时器一致：每 10 分钟刷新 */
const WEATHER_POLL_MS = 600_000;

interface WeatherDisplay {
  weather: string;
  temperature: string;
  windSpeed: string;
  rainfall: string;
  rainfallSource?: string;
  fetchedAt?: string;
}

interface WeatherSourceField {
  label: string;
  value: string;
}

interface WeatherSourceCard {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  hint?: string;
  fields: WeatherSourceField[];
}

function pickWeatherIcon(weather: string): LucideIcon {
  const w = weather.trim();
  if (/多云/.test(w)) return CloudSun;
  if (/晴/.test(w)) return Sun;
  if (/雨|降水|雷/.test(w)) return CloudRain;
  if (/雪|冰雹/.test(w)) return CloudSnow;
  if (/雾|霾|阴/.test(w)) return CloudFog;
  if (/云/.test(w)) return Cloud;
  return Cloud;
}

function WeatherMetric({
  icon: Icon,
  value,
  label,
  iconClassName,
  className,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  iconClassName?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={label}
      aria-label={`${label} ${value}`}
    >
      <Icon size={14} className={cn("shrink-0 opacity-90", iconClassName)} aria-hidden />
      <span>{value}</span>
    </span>
  );
}

function formatFetchedAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function SourceCard({ card, active }: { card: WeatherSourceCard; active?: boolean }) {
  return (
    <section
      className={cn(
        "rounded-md border px-3 py-2.5",
        card.ok
          ? "border-white/10 bg-black/25"
          : "border-amber-500/25 bg-amber-500/5",
        active && "ring-1 ring-sky-400/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-nexus-text-primary">{card.title}</h3>
        <span
          className={cn(
            "text-[10px]",
            card.ok ? "text-emerald-400/90" : "text-amber-300/90",
          )}
        >
          {card.ok ? "在线" : "不可用"}
        </span>
      </div>
      {card.hint ? (
        <p className="mb-2 truncate font-mono text-[10px] text-nexus-text-muted" title={card.hint}>
          {card.hint}
        </p>
      ) : null}
      {card.error ? (
        <p className="text-[11px] text-amber-200/90">{card.error}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {card.fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[10px] text-nexus-text-muted">{f.label}</dt>
              <dd className="truncate text-[12px] tabular-nums text-nexus-text-secondary">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function TopNavWeatherStrip() {
  const [info, setInfo] = useState<WeatherDisplay | null>(null);
  const [sources, setSources] = useState<WeatherSourceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const panelId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePanelPos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(560, Math.max(320, window.innerWidth - 16));
    const left = Math.min(
      Math.max(8, r.right - width),
      Math.max(8, window.innerWidth - width - 8),
    );
    setPanelPos({ top: r.bottom + 8, left, width });
  }, []);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        weather?: string;
        temperature?: string;
        windSpeed?: string;
        rainfall?: string;
        rainfallSource?: string;
        fetchedAt?: string;
        sources?: WeatherSourceCard[];
      };
      if (Array.isArray(json.sources)) setSources(json.sources);
      if (!res.ok || !json.ok) return;
      setInfo({
        weather: json.weather ?? "—",
        temperature: json.temperature ?? "—",
        windSpeed: json.windSpeed ?? "—",
        rainfall: json.rainfall ?? "—",
        rainfallSource: json.rainfallSource,
        fetchedAt: json.fetchedAt,
      });
    } catch {
      /* 离线时不打断顶栏 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWeather();
    const timer = window.setInterval(() => void fetchWeather(), WEATHER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchWeather]);

  useEffect(() => {
    if (!detailsOpen) {
      setPanelPos(null);
      return;
    }
    updatePanelPos();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setDetailsOpen(false);
    };
    const onScroll = () => setDetailsOpen(false);
    const onResize = () => updatePanelPos();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [detailsOpen, updatePanelPos]);

  const WeatherIcon = info ? pickWeatherIcon(info.weather) : CloudSun;

  const detailsPanel =
    detailsOpen && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="三路气象详细信息"
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
            className={cn(
              "fixed z-[9999] rounded-lg border border-white/10 bg-[#0b1220]/96 p-3 shadow-xl backdrop-blur-md",
            )}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-nexus-text-primary">气象详细信息</p>
                <p className="mt-0.5 text-[10px] text-nexus-text-muted">
                  三路实时摘要 · 约每 10 分钟刷新
                  {info?.fetchedAt ? ` · ${formatFetchedAt(info.fetchedAt)}` : ""}
                  {info?.rainfallSource
                    ? ` · 顶栏降雨来自 ${
                        info.rainfallSource === "vaisala"
                          ? "气象站"
                          : info.rainfallSource === "buoy"
                            ? "浮标"
                            : info.rainfallSource === "airport"
                              ? "机场"
                              : "默认"
                      }`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-white/10 p-1 text-nexus-text-muted hover:text-nexus-text-primary"
                aria-label="关闭"
                onClick={() => setDetailsOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            {sources.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-nexus-text-muted">
                {loading ? "加载中…" : "暂无详细数据"}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {sources.map((card) => (
                  <SourceCard
                    key={card.id}
                    card={card}
                    active={info?.rainfallSource === card.id}
                  />
                ))}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={cn("topnav-weather hidden lg:flex items-center gap-4 whitespace-nowrap")}
      title="气象信息（Vaisala + 浮标降雨回退 + 机场）"
    >
      {loading && !info ? (
        <span className="inline-flex items-center gap-1.5 text-nexus-text-muted">
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          气象加载中…
        </span>
      ) : info ? (
        <>
          <WeatherMetric
            icon={WeatherIcon}
            value={info.weather}
            label="天气"
            iconClassName="text-amber-300"
          />
          <WeatherMetric
            icon={Thermometer}
            value={`${info.temperature}°`}
            label="气温"
            iconClassName="text-orange-300"
          />
          <WeatherMetric
            icon={Wind}
            value={`${info.windSpeed} m/s`}
            label="风速"
            iconClassName="text-cyan-300"
          />
          <WeatherMetric
            icon={Droplets}
            value={info.rainfall}
            label="降雨"
            iconClassName="text-sky-400"
            className="hidden xl:inline-flex"
          />
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-nexus-text-muted">
          <Cloud size={14} className="shrink-0 opacity-60" aria-hidden />
          气象不可用
        </span>
      )}

      <button
        ref={btnRef}
        type="button"
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded border border-white/10",
          "bg-black/20 text-nexus-text-muted hover:border-sky-400/40 hover:text-sky-300",
          detailsOpen && "border-sky-400/50 text-sky-300",
        )}
        title="详细气象信息"
        aria-label="详细气象信息"
        aria-expanded={detailsOpen}
        aria-controls={panelId}
        onClick={() => setDetailsOpen((v) => !v)}
      >
        <Info size={13} aria-hidden />
      </button>

      {detailsPanel}
    </div>
  );
}

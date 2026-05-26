"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Loader2,
  Sun,
  Thermometer,
  Wind,
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

export function TopNavWeatherStrip() {
  const [info, setInfo] = useState<WeatherDisplay | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        weather?: string;
        temperature?: string;
        windSpeed?: string;
        rainfall?: string;
      };
      if (!res.ok || !json.ok) return;
      setInfo({
        weather: json.weather ?? "—",
        temperature: json.temperature ?? "—",
        windSpeed: json.windSpeed ?? "—",
        rainfall: json.rainfall ?? "—",
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

  const WeatherIcon = info ? pickWeatherIcon(info.weather) : CloudSun;

  return (
    <div
      className={cn("topnav-weather hidden lg:flex items-center gap-4 whitespace-nowrap")}
      title="气象信息（TaskServer HTTP，与 Qt TopInfoPanel 一致）"
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
    </div>
  );
}

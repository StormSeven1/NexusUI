"use client";

import { NxCard } from "@/components/nexus";
import {
  Sun, Cloud, CloudRain, CloudDrizzle, CloudLightning, CloudFog, Wind,
  Thermometer, Droplets, Eye, Gauge,
} from "lucide-react";

const ICON_MAP: Record<string, typeof Sun> = {
  sunny: Sun,
  cloudy: Cloud,
  overcast: Cloud,
  light_rain: CloudDrizzle,
  rain: CloudRain,
  thunderstorm: CloudLightning,
  fog: CloudFog,
  windy: Wind,
};

interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  icon?: string;
  humidity?: number;
  wind?: string;
  visibilityKm?: number;
  pressureHpa?: number;
}

export function WeatherCard({ data }: { data: WeatherData }) {
  const WeatherIcon = ICON_MAP[data.icon ?? ""] ?? Cloud;

  return (
    <NxCard padding="sm" className="my-1.5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
          <WeatherIcon size={20} className="text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-nexus-text-primary">{data.temperature}°C</span>
            <span className="text-[10px] text-nexus-text-secondary">{data.condition}</span>
          </div>
          <p className="text-[10px] text-nexus-text-muted">{data.location}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {data.wind && (
          <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-secondary">
            <Wind size={10} className="text-nexus-text-muted" />
            <span>{data.wind}</span>
          </div>
        )}
        {data.humidity != null && (
          <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-secondary">
            <Droplets size={10} className="text-nexus-text-muted" />
            <span>湿度 {data.humidity}%</span>
          </div>
        )}
        {data.visibilityKm != null && (
          <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-secondary">
            <Eye size={10} className="text-nexus-text-muted" />
            <span>能见度 {data.visibilityKm}km</span>
          </div>
        )}
        {data.pressureHpa != null && (
          <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-secondary">
            <Gauge size={10} className="text-nexus-text-muted" />
            <span>{data.pressureHpa}hPa</span>
          </div>
        )}
      </div>
    </NxCard>
  );
}

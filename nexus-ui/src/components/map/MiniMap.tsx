"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";

export function MiniMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [-2.35, 51.35],
      zoom: 3,
      interactive: false,
      attributionControl: false,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="absolute bottom-3 right-3 z-10 h-[88px] w-[120px] overflow-hidden rounded-md border border-white/[0.08] bg-nexus-bg-surface/80 shadow-lg backdrop-blur-sm">
      <div ref={containerRef} className="h-full w-full" />
      {/* Viewport indicator */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-4 w-6 border border-nexus-accent/60" />
      </div>
    </div>
  );
}

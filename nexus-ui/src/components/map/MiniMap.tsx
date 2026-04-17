"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { getMaplibreBaseMapOptions } from "@/lib/map-2d-basemap";

export function MiniMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const { style, transformStyle, ...mapOpts } = getMaplibreBaseMapOptions("mini");
    const map = new maplibregl.Map({
      container: containerRef.current,
      ...mapOpts,
      zoom: 3,
      interactive: false,
      attributionControl: false,
    });
    map.setStyle(style, { transformStyle });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="absolute bottom-3 right-3 z-10 h-[88px] w-[120px] overflow-hidden rounded-md border border-white/[0.08] bg-nexus-bg-surface/80 shadow-lg backdrop-blur-sm">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-4 w-6 border border-white/30" />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { getMaplibreBaseMapOptions } from "@/lib/map-2d-basemap";
import { useAppConfigStore } from "@/stores/app-config-store";
import { bootstrapMapHomeSideEffects } from "@/lib/map-home-bootstrap";
import type { AppConfigMapHome } from "@/lib/map-home-config";

export function MiniMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapHomeBoot, setMapHomeBoot] = useState<AppConfigMapHome | null | undefined>(undefined);

  useEffect(() => {
    void useAppConfigStore
      .getState()
      .ensureLoaded()
      .then((cfg) => {
        bootstrapMapHomeSideEffects(cfg.mapHome);
        setMapHomeBoot(cfg.mapHome);
      })
      .catch(() => setMapHomeBoot(null));
  }, []);

  useEffect(() => {
    if (mapHomeBoot === undefined) return;
    if (!containerRef.current || mapRef.current) return;

    const { style, transformStyle, ...mapOpts } = getMaplibreBaseMapOptions("mini", mapHomeBoot);
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
  }, [mapHomeBoot]);

  return (
    <div className="absolute bottom-3 right-3 z-10 h-[88px] w-[120px] overflow-hidden rounded-md border border-white/[0.08] bg-nexus-bg-surface/80 shadow-lg backdrop-blur-sm">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-4 w-6 border border-white/30" />
      </div>
    </div>
  );
}

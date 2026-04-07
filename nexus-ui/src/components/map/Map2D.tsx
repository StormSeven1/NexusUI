"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAppStore } from "@/stores/app-store";
import { MOCK_TRACKS } from "@/lib/mock-data";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/colors";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const CENTER: [number, number] = [-2.35, 51.35];
const DEFAULT_ZOOM = 8.5;

export function Map2D() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const { setMouseCoords, setZoomLevel, selectTrack } = useAppStore();

  const createMarkerElement = useCallback(
    (disposition: ForceDisposition, type: string) => {
      const color = FORCE_COLORS[disposition];
      const el = document.createElement("div");
      el.style.cssText = `
      width: 24px; height: 24px; cursor: pointer; position: relative;
    `;

      const shapes: Record<string, string> = {
        air: `<polygon points="12,2 22,20 12,16 2,20" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5"/>`,
        ground: `<rect x="3" y="3" width="18" height="18" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>`,
        sea: `<polygon points="12,2 22,12 12,22 2,12" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>`,
        unknown: `<circle cx="12" cy="12" r="9" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>`,
      };

      el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${shapes[type] || shapes.unknown}</svg>`;
      return el;
    },
    []
  );

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");

    map.on("mousemove", (e) => {
      setMouseCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.on("zoomend", () => {
      setZoomLevel(Math.round(map.getZoom()));
    });

    map.on("load", () => {
      MOCK_TRACKS.forEach((track) => {
        const el = createMarkerElement(track.disposition, track.type);

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          selectTrack(track.id);
        });

        const popup = new maplibregl.Popup({
          offset: 16,
          closeButton: false,
          className: "nexus-popup",
        }).setHTML(`
          <div style="font-family: 'Inter', sans-serif; padding: 4px 0;">
            <div style="font-size: 11px; font-weight: 600; color: #d4d4d8;">${track.name}</div>
            <div style="font-size: 10px; color: #52525b; margin-top: 2px;">
              ${track.id} · ${track.speed} ${track.type === "ground" ? "mph" : "kn"} · 航向 ${track.heading}°
            </div>
          </div>
        `);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([track.lng, track.lat])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      });

      setZoomLevel(Math.round(map.getZoom()));
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [createMarkerElement, selectTrack, setMouseCoords, setZoomLevel]);

  return (
    <>
      <div ref={mapContainer} className="h-full w-full" />
      <style jsx global>{`
        .nexus-popup .maplibregl-popup-content {
          background: rgba(17, 17, 19, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          padding: 8px 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
        }
        .nexus-popup .maplibregl-popup-tip {
          border-top-color: rgba(17, 17, 19, 0.95);
        }
        .maplibregl-ctrl-group {
          background: rgba(17, 17, 19, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          border-radius: 6px !important;
          backdrop-filter: blur(8px);
        }
        .maplibregl-ctrl-group button {
          border-color: rgba(255, 255, 255, 0.06) !important;
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
        }
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
          filter: invert(0.5);
        }
        .maplibregl-ctrl-group button:hover .maplibregl-ctrl-icon {
          filter: invert(0.8);
        }
      `}</style>
    </>
  );
}

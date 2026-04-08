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

const TRACK_SOURCE_ID = "tracks-source";
const TRACK_CIRCLE_LAYER = "tracks-circle";
const TRACK_LABEL_LAYER = "tracks-label";
const HIGHLIGHT_CIRCLE_LAYER = "tracks-highlight";
const ROUTE_SOURCE_PREFIX = "route-source-";
const ROUTE_LAYER_PREFIX = "route-layer-";

function buildGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: MOCK_TRACKS.map((track) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [track.lng, track.lat],
      },
      properties: {
        id: track.id,
        name: track.name,
        type: track.type,
        disposition: track.disposition,
        speed: track.speed,
        heading: track.heading,
        altitude: track.altitude ?? null,
        color: FORCE_COLORS[track.disposition],
      },
    })),
  };
}

export function Map2D() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const routeIdsRef = useRef<string[]>([]);
  const { setMouseCoords, setZoomLevel, selectTrack } = useAppStore();

  const selectTrackRef = useRef(selectTrack);
  selectTrackRef.current = selectTrack;

  /* ── 初始化地图 ── */
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
      map.addSource(TRACK_SOURCE_ID, {
        type: "geojson",
        data: buildGeoJSON(),
      });

      /* 高亮脉冲外圈（在普通圆下面先添加，初始隐藏） */
      map.addLayer({
        id: HIGHLIGHT_CIRCLE_LAYER,
        type: "circle",
        source: TRACK_SOURCE_ID,
        filter: ["in", "id", ""],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, 10,
            10, 18,
            15, 28,
          ],
          "circle-color": "transparent",
          "circle-stroke-color": "#facc15",
          "circle-stroke-width": 2.5,
          "circle-stroke-opacity": 0.85,
        },
      });

      map.addLayer({
        id: TRACK_CIRCLE_LAYER,
        type: "circle",
        source: TRACK_SOURCE_ID,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, 4,
            10, 8,
            15, 14,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.25,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.9,
        },
      });

      map.addLayer({
        id: TRACK_LABEL_LAYER,
        type: "symbol",
        source: TRACK_SOURCE_ID,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.6],
          "text-anchor": "top",
          "text-max-width": 10,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#a1a1aa",
          "text-halo-color": "#09090b",
          "text-halo-width": 1.5,
        },
      });

      map.on("click", TRACK_CIRCLE_LAYER, (e) => {
        if (e.features && e.features.length > 0) {
          const id = e.features[0].properties?.id;
          if (id) selectTrackRef.current(id);
        }
      });

      map.on("mouseenter", TRACK_CIRCLE_LAYER, (e) => {
        map.getCanvas().style.cursor = "pointer";

        if (e.features && e.features.length > 0) {
          const f = e.features[0];
          const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
          const props = f.properties!;
          const typeLabel = props.type === "ground" ? "mph" : "kn";

          if (popupRef.current) popupRef.current.remove();

          popupRef.current = new maplibregl.Popup({
            offset: 12,
            closeButton: false,
            className: "nexus-popup",
          })
            .setLngLat(coords)
            .setHTML(`
              <div style="font-family: 'Inter', sans-serif; padding: 4px 0;">
                <div style="font-size: 11px; font-weight: 600; color: #d4d4d8;">${props.name}</div>
                <div style="font-size: 10px; color: #52525b; margin-top: 2px;">
                  ${props.id} · ${props.speed} ${typeLabel} · 航向 ${props.heading}°
                </div>
              </div>
            `)
            .addTo(map);
        }
      });

      map.on("mouseleave", TRACK_CIRCLE_LAYER, () => {
        map.getCanvas().style.cursor = "";
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      });

      setZoomLevel(Math.round(map.getZoom()));
    });

    mapRef.current = map;

    return () => {
      if (popupRef.current) popupRef.current.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [setMouseCoords, setZoomLevel]);

  /* ── 响应 flyToRequest ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const req = state.flyToRequest;
      if (!req || req.seq === lastFlySeqRef.current) return;
      lastFlySeqRef.current = req.seq;
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({
        center: [req.lng, req.lat],
        zoom: req.zoom ?? map.getZoom(),
        duration: 1800,
        essential: true,
      });
    });
    return unsub;
  }, []);

  /* ── 响应 highlightedTrackIds ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const map = mapRef.current;
      if (!map || !map.getLayer(HIGHLIGHT_CIRCLE_LAYER)) return;
      const ids = state.highlightedTrackIds;
      if (ids.length === 0) {
        map.setFilter(HIGHLIGHT_CIRCLE_LAYER, ["in", "id", ""]);
      } else {
        map.setFilter(HIGHLIGHT_CIRCLE_LAYER, ["in", "id", ...ids]);
      }
    });
    return unsub;
  }, []);

  /* ── 响应 routeLines ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;

      const current = state.routeLines;
      const currentIds = new Set(current.map((r) => r.id));

      // 移除已不存在的路线
      for (const oldId of routeIdsRef.current) {
        if (!currentIds.has(oldId)) {
          const layerId = ROUTE_LAYER_PREFIX + oldId;
          const sourceId = ROUTE_SOURCE_PREFIX + oldId;
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      }

      // 添加新路线
      for (const route of current) {
        const sourceId = ROUTE_SOURCE_PREFIX + route.id;
        const layerId = ROUTE_LAYER_PREFIX + route.id;
        if (map.getSource(sourceId)) continue;

        const coordinates = route.points.map((p) => [p.lng, p.lat]);
        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          },
        });
        map.addLayer(
          {
            id: layerId,
            type: "line",
            source: sourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": route.color,
              "line-width": 3,
              "line-opacity": 0.85,
              "line-dasharray": [2, 3],
            },
          },
          HIGHLIGHT_CIRCLE_LAYER,
        );
      }

      routeIdsRef.current = [...currentIds];
    });
    return unsub;
  }, []);

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

"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { MOCK_TRACKS } from "@/lib/mock-data";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/colors";
import { AlertTriangle } from "lucide-react";

export function Map3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);
  const cesiumRef = useRef<any>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const highlightEntitiesRef = useRef<any[]>([]);
  const routeEntitiesRef = useRef<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectTrack, setMouseCoords } = useAppStore();

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let viewer: any = null;
    let destroyed = false;

    const init = async () => {
      try {
        const Cesium = await import("cesium");
        cesiumRef.current = Cesium;

        if (typeof window !== "undefined") {
          (window as any).CESIUM_BASE_URL = "/cesium/";
        }

        if (destroyed || !containerRef.current) return;

        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          infoBox: false,
          timeline: false,
          animation: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          creditContainer: document.createElement("div"),
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              credit: "CartoDB",
              minimumLevel: 0,
              maximumLevel: 18,
            })
          ),
          terrainProvider: undefined,
          skyBox: false as any,
          skyAtmosphere: false as any,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
        });

        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#09090b");
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#111113");
        viewer.scene.globe.showGroundAtmosphere = false;
        viewer.scene.fog.enabled = false;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.highDynamicRange = false;

        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(-2.35, 51.35, 500000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
          },
          duration: 0,
        });

        MOCK_TRACKS.forEach((track) => {
          const color = Cesium.Color.fromCssColorString(
            FORCE_COLORS[track.disposition as ForceDisposition]
          );

          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              track.lng,
              track.lat,
              track.altitude || 0
            ),
            point: {
              pixelSize: 8,
              color: color.withAlpha(0.8),
              outlineColor: color,
              outlineWidth: 2,
            },
            label: {
              text: track.name,
              font: "11px Inter, sans-serif",
              fillColor: Cesium.Color.fromCssColorString("#d4d4d8"),
              outlineColor: Cesium.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -14),
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.4),
              translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 8e5, 0.2),
            },
            properties: {
              trackId: track.id,
            },
          });
        });

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((movement: any) => {
          const picked = viewer.scene.pick(movement.position);
          if (Cesium.defined(picked) && picked.id?.properties?.trackId) {
            selectTrack(picked.id.properties.trackId.getValue());
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement: any) => {
          const cartesian = viewer.camera.pickEllipsoid(
            movement.endPosition,
            viewer.scene.globe.ellipsoid
          );
          if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            setMouseCoords({
              lat: Cesium.Math.toDegrees(carto.latitude),
              lng: Cesium.Math.toDegrees(carto.longitude),
            });
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        viewerRef.current = viewer;
        setLoading(false);
      } catch (err) {
        console.error("CesiumJS initialization failed:", err);
        setError("3D view initialization failed. Please try again.");
        setLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerRef.current = null;
      cesiumRef.current = null;
    };
  }, [selectTrack, setMouseCoords]);

  /* ── 响应 flyToRequest ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const req = state.flyToRequest;
      if (!req || req.seq === lastFlySeqRef.current) return;
      lastFlySeqRef.current = req.seq;
      const viewer = viewerRef.current as any;
      const Cesium = cesiumRef.current;
      if (!viewer || !Cesium || viewer.isDestroyed()) return;

      const zoomToHeight = req.zoom ? zoomToAltitude(req.zoom) : 80000;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(req.lng, req.lat, zoomToHeight),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: 1.8,
      });
      viewer.scene.requestRender();
    });
    return unsub;
  }, []);

  /* ── 响应 highlightedTrackIds ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const viewer = viewerRef.current as any;
      const Cesium = cesiumRef.current;
      if (!viewer || !Cesium || viewer.isDestroyed()) return;

      // 移除旧高亮
      for (const ent of highlightEntitiesRef.current) {
        viewer.entities.remove(ent);
      }
      highlightEntitiesRef.current = [];

      const ids = new Set(state.highlightedTrackIds);
      if (ids.size === 0) {
        viewer.scene.requestRender();
        return;
      }

      for (const track of MOCK_TRACKS) {
        if (!ids.has(track.id)) continue;
        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
          ellipse: {
            semiMajorAxis: 2000,
            semiMinorAxis: 2000,
            material: Cesium.Color.YELLOW.withAlpha(0.15),
            outline: true,
            outlineColor: Cesium.Color.YELLOW.withAlpha(0.8),
            outlineWidth: 2,
            height: 0,
          },
          properties: { _highlight: true },
        });
        highlightEntitiesRef.current.push(ent);
      }
      viewer.scene.requestRender();
    });
    return unsub;
  }, []);

  /* ── 响应 routeLines ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const viewer = viewerRef.current as any;
      const Cesium = cesiumRef.current;
      if (!viewer || !Cesium || viewer.isDestroyed()) return;

      const currentIds = new Set(state.routeLines.map((r) => r.id));

      // 移除已不存在的路线
      for (const [id, ent] of routeEntitiesRef.current) {
        if (!currentIds.has(id)) {
          viewer.entities.remove(ent);
          routeEntitiesRef.current.delete(id);
        }
      }

      // 添加新路线
      for (const route of state.routeLines) {
        if (routeEntitiesRef.current.has(route.id)) continue;
        const positions = route.points.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0)
        );
        const ent = viewer.entities.add({
          polyline: {
            positions,
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString(route.color),
              dashLength: 16,
            }),
            clampToGround: true,
          },
          properties: { _routeId: route.id },
        });
        routeEntitiesRef.current.set(route.id, ent);
      }
      viewer.scene.requestRender();
    });
    return unsub;
  }, []);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-nexus-bg-base">
        <AlertTriangle size={24} className="text-amber-400" />
        <p className="text-sm text-nexus-text-secondary">3D 视图加载失败，请重试</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-white/[0.10] bg-white/[0.06] px-4 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-white/[0.10]"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-nexus-bg-base/90">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
          <span className="mt-3 text-xs text-nexus-text-muted">
            加载三维地球中...
          </span>
        </div>
      )}
    </div>
  );
}

/** 将 Web 地图 zoom level 粗略映射为 3D 相机高度（米） */
function zoomToAltitude(zoom: number): number {
  return Math.max(500, 40_000_000 / Math.pow(2, zoom));
}

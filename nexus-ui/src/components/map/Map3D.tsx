"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { useTrackStore } from "@/stores/track-store";
import { isVirtualFromProperties, normalizeAssetType } from "@/lib/map-entity-model";
import type { Asset, RestrictedZone, Track } from "@/lib/map-entity-model";
import { useZoneStore } from "@/stores/zone-store";
import { useAssetStore } from "@/stores/asset-store";
import type { ZoneData } from "@/stores/zone-store";
import type { AssetData } from "@/stores/asset-store";
import {
  dispositionFromAssetData,
  getTrackRenderingConfig,
  laserLabelStyleFromBundle,
  loadResolvedAppConfig,
} from "@/lib/map-app-config";
import type { AssetDispositionIconAccent } from "@/lib/map-icons";
import { trackMapDrawHistoryTrails } from "@/components/map/modules/tracks-maplibre";
import {
  assetMapLabelTextColor,
  buildMarkerSymbolDataUrl,
  buildAssetSymbolDataUrl,
  preloadPublicMapAssetFragments,
  geoCircleCoords,
  geoSectorCoords,
  geoRadarSweepCoords,
  resolveTrackMarkerFill,
  friendlyColorFromAssetProperties,
} from "@/lib/map-icons";
import { AlertTriangle } from "lucide-react";
import { TargetPlacard, type PlacardKind } from "@/components/map/TargetPlacard";
import { createCesiumBaseImageryProvider, getMap3DInitialViewFromEnv } from "@/lib/map-3d-config";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;
type PositionedEvent = import("cesium").ScreenSpaceEventHandler.PositionedEvent;
type MotionEvent = import("cesium").ScreenSpaceEventHandler.MotionEvent;

/**
 * RGBA 元组 [r,g,b,a]，用于 Cesium.Color，分量范围 0–1
 */
type RGBA = [number, number, number, number];

const ZONE_STYLES: Record<string, { fill: RGBA; line: RGBA }> = {
  "no-fly":  { fill: [0.94, 0.27, 0.27, 0.18], line: [0.94, 0.27, 0.27, 0.7] },
  exercise:  { fill: [0.23, 0.51, 0.96, 0.15], line: [0.23, 0.51, 0.96, 0.7] },
  warning:   { fill: [0.98, 0.75, 0.14, 0.15], line: [0.98, 0.75, 0.14, 0.7] },
};

const COVERAGE_STYLES: Record<string, { fill: RGBA; line: RGBA }> = {
  camera: { fill: [0.58, 0.2, 0.92, 0.12], line: [0.58, 0.2, 0.92, 0.4] },
  radar: { fill: [0.2, 0.83, 0.6, 0.06], line: [0.2, 0.83, 0.6, 0.25] },
  tower: { fill: [0.2, 0.83, 0.6, 0.08], line: [0.2, 0.83, 0.6, 0.3] },
  airport: { fill: [0.58, 0.64, 0.72, 0.1], line: [0.58, 0.64, 0.72, 0.35] },
  drone: { fill: [0.22, 0.74, 0.97, 0.1], line: [0.22, 0.74, 0.97, 0.35] },
  laser: { fill: [0.98, 0.55, 0.16, 0.1], line: [0.98, 0.55, 0.16, 0.38] },
  tdoa: { fill: [0.08, 0.72, 0.82, 0.1], line: [0.08, 0.72, 0.82, 0.38] },
};

const STATUS_RGBA: Record<string, RGBA> = {
  online:   [0.20, 0.83, 0.60, 0.22],
  degraded: [0.98, 0.75, 0.14, 0.18],
  offline:  [0.97, 0.44, 0.44, 0.12],
};

type GroupKey =
  | "tracks"
  | "trackTrails"
  | "assets"
  | "radarCoverage"
  | "optoFov"
  | "airportFov"
  | "droneFov"
  | "zones";

type DroneLabelStyleResolved = ReturnType<typeof laserLabelStyleFromBundle>;

function cesiumFontFromDroneLabelBundle(L: DroneLabelStyleResolved): string {
  const parts = L.textFont.map((f) => (/\s/.test(f) ? `"${f}"` : f));
  return `${L.fontSize}px ${parts.join(", ")}, "Noto Sans SC", sans-serif`;
}

/** 与 2D `text-offset`（em）大致对齐：`verticalOrigin: BOTTOM` 时 y 为负表示整体上移 */
function cesiumDroneLabelPixelOffset(Cesium: CesiumModule, L: DroneLabelStyleResolved) {
  const [ox, oy] = L.textOffset;
  const x = Math.round(L.fontSize * Number(ox) * 0.95);
  const y = -Math.round(4 + L.fontSize * Math.max(0.25, Number(oy)) * 1.45);
  return new Cesium.Cartesian2(x, y);
}

function adaptZones(zones: ZoneData[]): RestrictedZone[] {
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    type: z.zone_type as RestrictedZone["type"],
    coordinates: z.coordinates,
  }));
}

function adaptAssets(assets: AssetData[]): Asset[] {
  return assets.map((a) => {
    const p = a.properties as Record<string, unknown> | null | undefined;
    const isRadar = String(a.asset_type ?? "").toLowerCase() === "radar";
    let showRings: boolean | undefined;
    if (isRadar) {
      if (p && typeof p.showRings === "boolean") showRings = p.showRings;
      else showRings = true;
    }
    const centerIconVisible = p?.center_icon_visible === false ? false : undefined;
    let nameLabelVisible: boolean | undefined;
    if (!isRadar && p?.center_name_visible === false) nameLabelVisible = false;
    const showFov = p?.fov_sector_visible === false ? false : undefined;
    const friendlyMapColor = friendlyColorFromAssetProperties(p ?? null);
    return {
      id: a.id,
      name: a.name,
      type: normalizeAssetType(a.asset_type),
      status: a.status as Asset["status"],
      disposition: dispositionFromAssetData(a),
      lat: a.lat,
      lng: a.lng,
      range: a.range_km ?? undefined,
      heading: a.heading ?? undefined,
      fovAngle: a.fov_angle ?? undefined,
      isVirtual: isVirtualFromProperties(a.properties),
      ...(showRings !== undefined ? { showRings } : {}),
      ...(centerIconVisible === false ? { centerIconVisible: false } : {}),
      ...(nameLabelVisible === false ? { nameLabelVisible: false } : {}),
      ...(showFov === false ? { showFov: false } : {}),
      ...(friendlyMapColor ? { friendlyMapColor } : {}),
    };
  });
}

/** 与 Map2D 一致：store 全量画 billboard；折线仅在 `trackMapDrawHistoryTrails` 为真时画（超预算只跳过折线，不删 store） */
async function syncCesiumTrackBillboards(
  viewer: CesiumViewer,
  Cesium: CesiumModule,
  groups: { tracks: CesiumEntity[]; trackTrails: CesiumEntity[] },
  allTracks: Track[],
  accent: AssetDispositionIconAccent,
) {
  const drawTrails = trackMapDrawHistoryTrails(allTracks);
  const visibleIds = new Set(allTracks.map((t) => t.id));
  const fullMap = new Map(allTracks.map((t) => [t.id, t]));

  for (const ent of groups.trackTrails) {
    viewer.entities.remove(ent);
  }
  groups.trackTrails = [];

  const kept: CesiumEntity[] = [];
  for (const ent of groups.tracks) {
    const tid = ent.properties?.trackId?.getValue() as string | undefined;
    if (tid && visibleIds.has(tid)) kept.push(ent);
    else viewer.entities.remove(ent);
  }
  groups.tracks = kept;

  const existing = new Set(
    kept
      .map((e) => e.properties?.trackId?.getValue() as string | undefined)
      .filter((x): x is string => typeof x === "string" && x.length > 0),
  );

  const trCfg = getTrackRenderingConfig();
  for (const track of allTracks) {
    if (existing.has(track.id)) continue;
    const ts = trCfg.trackTypeStyles[track.type] ?? trCfg.trackTypeStyles.sea;
    const friendlyFill = track.disposition === "friendly" ? ts.idColor : undefined;
    const image = await buildMarkerSymbolDataUrl(
      track.type,
      track.disposition,
      accent,
      track.isVirtual === true,
      friendlyFill,
    );
    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
      billboard: {
        image,
        scale: 0.90,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        heightReference: Cesium.HeightReference.NONE,
        rotation: -Cesium.Math.toRadians(track.heading ?? 0),
        color: Cesium.Color.WHITE,
      },
      label: {
        text: track.name,
        font: '11px Roboto, "Noto Sans SC", sans-serif',
        fillColor: Cesium.Color.fromCssColorString(
          resolveTrackMarkerFill(track.disposition, accent, friendlyFill),
        ),
        outlineColor: Cesium.Color.fromCssColorString("#09090b"),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -26),
        scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.4),
        translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 8e5, 0.2),
      },
      properties: { trackId: track.id },
    });
    groups.tracks.push(ent);
    existing.add(track.id);
  }

  for (const ent of groups.tracks) {
    const tid = ent.properties?.trackId?.getValue() as string;
    const t = fullMap.get(tid);
    if (!t) continue;
    ent.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(t.lng, t.lat, t.altitude || 0),
    );
    if (ent.billboard) {
      ent.billboard.rotation = new Cesium.ConstantProperty(-Cesium.Math.toRadians(t.heading ?? 0));
    }
  }

  const alt = (z: number | undefined) => (Number.isFinite(z) ? (z as number) : 0);
  if (!drawTrails) return;
  for (const t of allTracks) {
    const trail = t.historyTrail;
    if (!trail || trail.length < 1) continue;
    const ts2 = trCfg.trackTypeStyles[t.type] ?? trCfg.trackTypeStyles.sea;
    const friendlyFill2 = t.disposition === "friendly" ? ts2.idColor : undefined;
    const positions = [...trail, [t.lng, t.lat] as [number, number]].map(([lng, lat]) =>
      Cesium.Cartesian3.fromDegrees(lng, lat, alt(t.altitude)),
    );
    const lineEnt = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.fromCssColorString(resolveTrackMarkerFill(t.disposition, accent, friendlyFill2)).withAlpha(0.48),
        clampToGround: true,
      },
      properties: { trackTrailFor: t.id },
    });
    groups.trackTrails.push(lineEnt);
  }
}

export function Map3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const placardEntityRef = useRef<CesiumEntity | null>(null);
  const placardPostRenderCleanupRef = useRef<(() => void) | null>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const highlightEntitiesRef = useRef<CesiumEntity[]>([]);
  const routeEntitiesRef = useRef<Map<string, CesiumEntity>>(new Map());
  const areaEntitiesRef = useRef<Map<string, CesiumEntity[]>>(new Map());
  const entityGroupsRef = useRef<Record<GroupKey, CesiumEntity[]>>({
    tracks: [],
    trackTrails: [],
    assets: [],
    radarCoverage: [],
    optoFov: [],
    airportFov: [],
    droneFov: [],
    zones: [],
  });
  /** 供 `syncCesiumTrackBillboards` 与订阅 flush 使用（`loadResolvedAppConfig` 的 `assetDispositionIconAccent`） */
  const cesiumTrackAccentRef = useRef<AssetDispositionIconAccent>({});
  const radarSweepRef = useRef<CesiumEntity[]>([]);
  const rafRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placard, setPlacard] = useState<{
    kind: PlacardKind;
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const { selectTrack, selectAsset } = useAppStore();

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let viewer: CesiumViewer | null = null;
    let destroyed = false;

    const init = async () => {
      try {
        const Cesium = await import("cesium");
        cesiumRef.current = Cesium;

        if (typeof window !== "undefined") {
          (window as typeof window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium/";
        }
        if (destroyed || !containerRef.current) return;

        const appCfg = await loadResolvedAppConfig();
        const droneLabelStyle = laserLabelStyleFromBundle(appCfg.drones);
        const assetIconAccent: AssetDispositionIconAccent = appCfg.assetDispositionIconAccent ?? {};
        await preloadPublicMapAssetFragments();

        const baseImagery = createCesiumBaseImageryProvider(Cesium);

        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker: false, geocoder: false, homeButton: false,
          sceneModePicker: false, selectionIndicator: false, infoBox: false,
          timeline: false, animation: false, navigationHelpButton: false,
          fullscreenButton: false,
          creditContainer: document.createElement("div"),
          baseLayer: new Cesium.ImageryLayer(baseImagery),
          terrainProvider: undefined,
          requestRenderMode: false,
        });

        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#09090b");
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#111113");
        viewer.scene.globe.showGroundAtmosphere = false;
        viewer.scene.fog.enabled = false;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.highDynamicRange = false;

        const { center, zoom } = getMap3DInitialViewFromEnv();
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(center[0], center[1], 0), 0),
          {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), zoomToAltitude(zoom)),
            duration: 0,
          },
        );

        const v = viewer;
        const groups = entityGroupsRef.current;

        /* 1) 限制区 */
        const rgba = (c: RGBA) => new Cesium.Color(c[0], c[1], c[2], c[3]);

        for (const zone of adaptZones(useZoneStore.getState().zones)) {
          const style = ZONE_STYLES[zone.type] ?? ZONE_STYLES["warning"];
          // 闭合多边形：去掉重复闭合点
          const coords = zone.coordinates.slice(0, -1);
          const positions = coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
          const centerLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

          const ent = v.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              material: rgba(style.fill),
              /* 贴地多边形 + outline 在 Cesium 地形上不支持描边，会触发 oneTimeWarning 且无轮廓 */
              outline: false,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: zone.name,
              font: '12px Roboto, "Noto Sans SC", sans-serif',
              fillColor: rgba(style.line),
              outlineColor: Cesium.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.4),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            position: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, 100),
            properties: { zoneId: zone.id },
          });
          groups.zones.push(ent);
        }

        /* 2) 雷达覆盖（圆/扫描）与光电 FOV（扇形/圆）分开展示，与 2D 图层面板两项一致 */
        const _assets = adaptAssets(useAssetStore.getState().assets);
        for (const asset of _assets) {
          if (!asset.range || asset.range <= 0) continue;
          const sweepColor = STATUS_RGBA[asset.status] ?? STATUS_RGBA["online"];
          const covStyle = COVERAGE_STYLES[asset.type] ?? COVERAGE_STYLES["tower"];

          if (asset.type === "radar") {
            const circleCoords = geoCircleCoords(asset.lng, asset.lat, asset.range);
            const positions = circleCoords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
            const rangeEnt = v.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: rgba(covStyle.fill),
                outline: false,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: { assetId: asset.id, _coverage: true },
            });
            groups.radarCoverage.push(rangeEnt);

            if (asset.status !== "offline") {
              const sweepCoords = geoRadarSweepCoords(asset.lng, asset.lat, asset.range, 0);
              const sweepPositions = sweepCoords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
              const sweepEnt = v.entities.add({
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(sweepPositions),
                  material: rgba(sweepColor),
                  outline: false,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: {
                  assetId: asset.id, _radarSweep: true,
                  _lng: asset.lng, _lat: asset.lat, _range: asset.range,
                  _status: asset.status,
                },
              });
              groups.radarCoverage.push(sweepEnt);
              radarSweepRef.current.push(sweepEnt);
            }
          } else {
            const isSector = asset.fovAngle !== undefined && asset.fovAngle < 360 && asset.heading !== undefined;
            const coords = isSector
              ? geoSectorCoords(asset.lng, asset.lat, asset.range, asset.heading!, asset.fovAngle!)
              : geoCircleCoords(asset.lng, asset.lat, asset.range);
            const positions = coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
            const ent = v.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: rgba(covStyle.fill),
                outline: false,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: { assetId: asset.id, _coverage: true },
            });
            if (asset.type === "airport") groups.airportFov.push(ent);
            else if (asset.type === "drone") groups.droneFov.push(ent);
            else groups.optoFov.push(ent);
          }
        }

        /* 3) 航迹：store 全量；折线受 `maxViewportPoints` 顶点预算（与 Map2D `buildTrackGeoJSON` 一致） */
        cesiumTrackAccentRef.current = assetIconAccent;
        await syncCesiumTrackBillboards(v, Cesium, groups, useTrackStore.getState().tracks, assetIconAccent);

        /* 4) 资产 billboard（无人机名称样式与 2D 一致：`drones.label` → `laserLabelStyleFromBundle`） */
        const defaultAssetLabelFont = '10px Roboto, "Noto Sans SC", sans-serif';
        for (const asset of _assets) {
          const disp = asset.disposition ?? "friendly";
          const isDrone = asset.type === "drone";
          const labelHex = assetMapLabelTextColor(
            disp,
            asset.status,
            assetIconAccent,
            disp === "friendly" ? asset.friendlyMapColor : undefined,
          );
          const assetImage = await buildAssetSymbolDataUrl(
            asset.type,
            asset.status,
            asset.isVirtual ?? false,
            disp,
            assetIconAccent,
            disp === "friendly" ? asset.friendlyMapColor : undefined,
          );
          const ent = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(asset.lng, asset.lat, 0),
            billboard: {
              image: assetImage,
              scale: 0.82,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: asset.name,
              show: asset.nameLabelVisible !== false,
              font: isDrone ? cesiumFontFromDroneLabelBundle(droneLabelStyle) : defaultAssetLabelFont,
              fillColor: Cesium.Color.fromCssColorString(labelHex),
              outlineColor: isDrone
                ? Cesium.Color.fromCssColorString(droneLabelStyle.haloColor)
                : Cesium.Color.fromCssColorString("#09090b"),
              outlineWidth: isDrone ? droneLabelStyle.haloWidth : 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: isDrone
                ? cesiumDroneLabelPixelOffset(Cesium, droneLabelStyle)
                : new Cesium.Cartesian2(0, -22),
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.35),
              translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 8e5, 0.2),
            },
            properties: { assetId: asset.id, assetType: asset.type },
          });
          groups.assets.push(ent);
        }

        /* 点击拾取航迹/资产；未命中则关标牌并清空 store 选中与高亮 */
        const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
        const clearMapSelection = () => {
          placardEntityRef.current = null;
          setPlacard(null);
          selectTrack(null);
          selectAsset(null);
          useAppStore.getState().setHighlightedTrackIds([]);
        };
        handler.setInputAction((movement: PositionedEvent) => {
          const picked = v.scene.pick(movement.position);
          if (Cesium.defined(picked) && picked.id?.properties) {
            const trackId = picked.id.properties.trackId?.getValue();
            const assetId = picked.id.properties.assetId?.getValue();
            if (trackId) {
              selectAsset(null);
              selectTrack(trackId);
              placardEntityRef.current = picked.id as CesiumEntity;
              setPlacard((prev) => (prev && prev.kind === "track" && prev.id === trackId ? prev : { kind: "track", id: trackId, x: movement.position.x, y: movement.position.y }));
            } else if (assetId) {
              selectTrack(null);
              selectAsset(assetId);
              placardEntityRef.current = picked.id as CesiumEntity;
              setPlacard((prev) => (prev && prev.kind === "asset" && prev.id === assetId ? prev : { kind: "asset", id: assetId, x: movement.position.x, y: movement.position.y }));
            } else {
              clearMapSelection();
            }
          } else {
            clearMapSelection();
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement: MotionEvent) => {
          const cartesian = v.camera.pickEllipsoid(movement.endPosition, v.scene.globe.ellipsoid);
          if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            useMapPointerStore.getState().setMouseCoords({
              lat: Cesium.Math.toDegrees(carto.latitude),
              lng: Cesium.Math.toDegrees(carto.longitude),
            });
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        viewerRef.current = v;

        /* 按 layerVisibility 设置各组 entity 显隐（资产 billboard 按 `assetType` 分键，与 Map2D 一致） */
        const layerVis = useAppStore.getState().layerVisibility;
        const layerOn = (k: string) => layerVis[k] !== false;
        for (const ent of groups.tracks) ent.show = layerOn("lyr-tracks");
        for (const ent of groups.trackTrails) ent.show = layerOn("lyr-tracks");
        for (const ent of groups.radarCoverage) ent.show = layerOn("lyr-radar-coverage");
        for (const ent of groups.optoFov) ent.show = layerOn("lyr-opto-fov");
        for (const ent of groups.airportFov) ent.show = layerOn("lyr-airport");
        for (const ent of groups.droneFov) ent.show = layerOn("lyr-drones");
        for (const ent of groups.zones) ent.show = layerOn("lyr-zones");
        for (const ent of groups.assets) {
          const at = ent.properties?.assetType?.getValue() as string | undefined;
          const layerKey =
            at === "radar"
              ? "lyr-radar-coverage"
              : at === "laser"
                ? "lyr-laser"
                : at === "tdoa"
                  ? "lyr-tdoa"
                  : at === "airport"
                    ? "lyr-airport"
                    : at === "drone"
                      ? "lyr-drones"
                      : "lyr-opto-fov";
          ent.show = layerOn(layerKey);
        }

        /* 雷达扫描扇动画 */
        let sweepAngle = 0;
        const animate = () => {
          if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
          const C = cesiumRef.current!;
          sweepAngle = (sweepAngle + 0.8) % 360;
          for (const ent of radarSweepRef.current) {
            if (!ent.show) continue;
            const props = ent.properties!;
            const lng = props._lng?.getValue() as number;
            const lat = props._lat?.getValue() as number;
            const range = props._range?.getValue() as number;
            if (lng == null || lat == null || range == null) continue;
            const coords = geoRadarSweepCoords(lng, lat, range, sweepAngle);
            const positions = coords.map(([ln, la]) => C.Cartesian3.fromDegrees(ln, la));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ent.polygon as any).hierarchy = new C.ConstantProperty(
              new C.PolygonHierarchy(positions)
            );
          }
          rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);

        setLoading(false);
      } catch (err) {
        console.error("CesiumJS initialization failed:", err);
        setError("3D view initialization failed.");
        setLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      cesiumRef.current = null;
      radarSweepRef.current = [];
      entityGroupsRef.current = {
        tracks: [],
        trackTrails: [],
        assets: [],
        radarCoverage: [],
        optoFov: [],
        airportFov: [],
        droneFov: [],
        zones: [],
      };
    };
  }, [selectTrack, selectAsset]);

  /**
   * 将选中 entity 的世界坐标投影到屏幕，驱动标牌 DOM 位置
   */
  useEffect(() => {
    const v = viewerRef.current;
    const C = cesiumRef.current;
    if (!v || !C || v.isDestroyed()) return;

    if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
    placardPostRenderCleanupRef.current = null;

    if (!placard || !placardEntityRef.current) return;

    const onPostRender = () => {
      const ent = placardEntityRef.current;
      if (!ent || !placard) return;
      const time = v.clock.currentTime;
      const pos = ent.position?.getValue(time);
      if (!pos) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = (C.SceneTransforms as any).wgs84ToWindowCoordinates(v.scene, pos);
      if (!win) return;
      setPlacard((p) => (p ? { ...p, x: win.x, y: win.y } : p));
    };

    v.scene.postRender.addEventListener(onPostRender);
    placardPostRenderCleanupRef.current = () => {
      v.scene.postRender.removeEventListener(onPostRender);
    };

    return () => {
      if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
      placardPostRenderCleanupRef.current = null;
    };
  }, [placard]);

  /* flyTo：flyToBoundingSphere 与 zoom→高度 */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const req = state.flyToRequest;
      if (!req || req.seq === lastFlySeqRef.current) return;
      lastFlySeqRef.current = req.seq;
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      const target = C.Cartesian3.fromDegrees(req.lng, req.lat, 0);
      const range = req.zoom ? zoomToAltitude(req.zoom) : 80000;
      v.camera.flyToBoundingSphere(
        new C.BoundingSphere(target, 0),
        {
          offset: new C.HeadingPitchRange(0, C.Math.toRadians(-45), range),
          duration: 1.8,
        },
      );
    });
    return unsub;
  }, []);

  /* 高亮：highlightedTrackIds */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      for (const ent of highlightEntitiesRef.current) v.entities.remove(ent);
      highlightEntitiesRef.current = [];

      const ids = new Set(state.highlightedTrackIds);
      if (ids.size === 0) return;

      const trackList = useTrackStore.getState().tracks;
      for (const track of trackList) {
        if (!ids.has(track.id)) continue;
        const ent = v.entities.add({
          position: C.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
          ellipse: {
            semiMajorAxis: 2000, semiMinorAxis: 2000,
            material: C.Color.YELLOW.withAlpha(0.15),
            outline: true, outlineColor: C.Color.YELLOW.withAlpha(0.8), outlineWidth: 2, height: 0,
          },
          properties: { _highlight: true },
        });
        highlightEntitiesRef.current.push(ent);
      }
    });
    return unsub;
  }, []);

  /* 同步 routeLines */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      const currentIds = new Set(state.routeLines.map((r) => r.id));

      for (const [id, ent] of routeEntitiesRef.current) {
        if (!currentIds.has(id)) { v.entities.remove(ent); routeEntitiesRef.current.delete(id); }
      }
      for (const route of state.routeLines) {
        if (routeEntitiesRef.current.has(route.id)) continue;
        const positions = route.points.map((p) => C.Cartesian3.fromDegrees(p.lng, p.lat, 0));
        const ent = v.entities.add({
          polyline: {
            positions, width: 3,
            material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString(route.color), dashLength: 16 }),
            clampToGround: true,
          },
          properties: { _routeId: route.id },
        });
        routeEntitiesRef.current.set(route.id, ent);
      }
    });
    return unsub;
  }, []);

  /* 订阅 layerVisibility（与 Map2D `ALL_DATA_LAYER_IDS` 一致；资产 billboard 按 `assetType` 分键） */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const layerVis = state.layerVisibility;
      const layerOn = (k: string) => layerVis[k] !== false;
      const g = entityGroupsRef.current;
      for (const ent of g.tracks) ent.show = layerOn("lyr-tracks");
      for (const ent of g.trackTrails) ent.show = layerOn("lyr-tracks");
      for (const ent of g.radarCoverage) ent.show = layerOn("lyr-radar-coverage");
      for (const ent of g.optoFov) ent.show = layerOn("lyr-opto-fov");
      for (const ent of g.airportFov) ent.show = layerOn("lyr-airport");
      for (const ent of g.droneFov) ent.show = layerOn("lyr-drones");
      for (const ent of g.zones) ent.show = layerOn("lyr-zones");
      for (const ent of g.assets) {
        const at = ent.properties?.assetType?.getValue() as string | undefined;
        const layerKey =
          at === "radar"
            ? "lyr-radar-coverage"
            : at === "laser"
              ? "lyr-laser"
              : at === "tdoa"
                ? "lyr-tdoa"
                : at === "airport"
                  ? "lyr-airport"
                  : at === "drone"
                    ? "lyr-drones"
                    : "lyr-opto-fov";
        ent.show = layerOn(layerKey);
      }
    });
    return unsub;
  }, []);

  /* 选中放大：selectedAssetId */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedAssetId;
      for (const ent of entityGroupsRef.current.assets) {
        const aid = ent.properties?.assetId?.getValue();
        if (ent.billboard) {
          ent.billboard.scale = new (cesiumRef.current!.ConstantProperty)(aid === id ? 1.05 : 0.82);
        }
      }
    });
    return unsub;
  }, []);

  /* 选中放大：selectedTrackId */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedTrackId;
      for (const ent of entityGroupsRef.current.tracks) {
        const tid = ent.properties?.trackId?.getValue();
        if (ent.billboard) {
          ent.billboard.scale = new (cesiumRef.current!.ConstantProperty)(tid === id ? 1.12 : 0.90);
        }
      }
    });
    return unsub;
  }, []);

  /* 航迹：store 全量 → billboard；折线按 `trackMapDrawHistoryTrails`（异步 flush） */
  useEffect(() => {
    let cancelled = false;
    let flushRunning = false;
    let flushAgain = false;

    const flush = async () => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed() || cancelled) return;
      if (flushRunning) {
        flushAgain = true;
        return;
      }
      flushRunning = true;
      try {
        do {
          flushAgain = false;
          const snap = useTrackStore.getState().tracks;
          await syncCesiumTrackBillboards(v, C, entityGroupsRef.current, snap, cesiumTrackAccentRef.current);
        } while (flushAgain && !cancelled);
      } finally {
        flushRunning = false;
      }
      if (flushAgain && !cancelled) void flush();
    };

    const unsub = useTrackStore.subscribe(() => {
      void flush();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  /* 同步 drawnAreas */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      const currentIds = new Set(state.drawnAreas.map((a) => a.id));
      for (const [id, ents] of areaEntitiesRef.current) {
        if (!currentIds.has(id)) {
          for (const e of ents) v.entities.remove(e);
          areaEntitiesRef.current.delete(id);
        }
      }
      for (const area of state.drawnAreas) {
        if (areaEntitiesRef.current.has(area.id)) continue;
        const positions = area.points.map((p) => C.Cartesian3.fromDegrees(p.lng, p.lat));
        const ents: CesiumEntity[] = [];
        const polyEnt = v.entities.add({
          polygon: {
            hierarchy: new C.PolygonHierarchy(positions),
            material: C.Color.fromCssColorString(area.fillColor).withAlpha(area.fillOpacity),
            outline: false,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
          },
          properties: { _areaId: area.id },
        });
        ents.push(polyEnt);
        if (area.label) {
          const cLng = area.points.reduce((s, p) => s + p.lng, 0) / area.points.length;
          const cLat = area.points.reduce((s, p) => s + p.lat, 0) / area.points.length;
          const lblEnt = v.entities.add({
            position: C.Cartesian3.fromDegrees(cLng, cLat, 100),
            label: {
              text: area.label,
              font: '12px Roboto, "Noto Sans SC", sans-serif',
              fillColor: C.Color.fromCssColorString(area.color),
              outlineColor: C.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: C.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          ents.push(lblEnt);
        }
        areaEntitiesRef.current.set(area.id, ents);
      }
    });
    return unsub;
  }, []);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-nexus-bg-base">
        <AlertTriangle size={24} className="text-amber-400" />
        <p className="text-sm text-nexus-text-secondary">3D 视图初始化失败，请刷新重试</p>
        <button onClick={() => window.location.reload()} className="rounded-md border border-white/[0.10] bg-white/[0.06] px-4 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-white/[0.10]">
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
          <span className="mt-3 text-xs text-nexus-text-muted">正在加载三维场景…</span>
        </div>
      )}
      {placard && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+14px)]"
          style={{ left: placard.x, top: placard.y }}
        >
          <TargetPlacard
            kind={placard.kind}
            id={placard.id}
            onClose={() => {
              setPlacard(null);
              placardEntityRef.current = null;
            }}
            className="pointer-events-auto"
          />
          <div
            className="pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[12px] border-x-transparent border-t-[#0c0c0e]/95"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

function zoomToAltitude(zoom: number): number {
  return Math.max(500, 40_000_000 / Math.pow(2, zoom));
}

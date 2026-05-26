"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { metersPerPixelCesium } from "@/lib/map-scale-bar";
import { useTrackStore, getTrackDispositionForRendering } from "@/stores/track-store";
import { useVerifiedTrackStore } from "@/stores/verified-track-store";
import { shouldApplyVerifiedTrackGreen } from "@/lib/verified-track-color";
import {
  useTrackDisplayStore,
  neutralFusionColorForTrack,
  trailLengthSecondsForTrack,
  vectorLengthSecondsForTrack,
} from "@/stores/track-display-store";
import { trimHistoryTrailForDisplay, velocityVectorEndLngLat } from "@/lib/track-display-trail";
import {
  LYR_DB_AREAS,
  LYR_DISTANCE_RINGS,
  LYR_OPTO_FOV,
  LYR_TRACKS,
  type Asset,
  type RestrictedZone,
  type Track,
} from "@/lib/map-entity-model";
import { pickDistanceRingSettings } from "@/lib/distance-ring-settings";
import { useDistanceRingStore } from "@/stores/distance-ring-store";
import {
  syncCesiumDistanceRings,
  type CesiumDistanceRingGroups,
} from "@/components/map/modules/distance-rings-cesium";
import {
  shouldRenderOptoCameraFov,
  shouldRenderOptoCameraIcon,
  type OptoDeviceVisibilityMap,
} from "@/lib/opto-device-layer-visibility";
import { useOptoDeviceLayerStore } from "@/stores/opto-device-layer-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import { mergeZoneFillColor } from "@/components/map/modules/polygon-draw-maplibre";
import { useZoneStore } from "@/stores/zone-store";
import { useDbAreaStore } from "@/stores/db-area-store";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import {
  areaRowToPolygonRing,
  circleLabelLngLatNorth,
  dbAreaFeatureId,
  dbAreaVisibilityKey,
  parseAreaLineColor,
} from "@/lib/area-table-geometry";
import { ringSouthEastLabelLngLat } from "@/lib/build-db-areas-geojson";
import {
  DEFAULT_AREA_LAYER_LINE_COLOR,
  pickSituationAreaLayerStyle,
} from "@/lib/distance-ring-settings";
import { mapAreaFallbackLabel } from "@/lib/area-table-serialize";
import { useAssetStore } from "@/stores/asset-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import type { ZoneData } from "@/stores/zone-store";
import {
  getTrackRenderingConfig,
  laserLabelStyleFromBundle,
} from "@/lib/map-app-config";
import type { AssetDispositionIconAccent } from "@/lib/map-icons";
import { trackMapDrawHistoryTrails } from "@/components/map/modules/tracks-maplibre";
import {
  filterTracksForMapRender,
  isDotTrackLayerKey,
  resolveTrackLayerKey,
} from "@/lib/track-layer-visibility";
import { isTrackVirtualTroop } from "@/lib/track-reality-type";
import {
  assetMapLabelTextColor,
  buildMarkerSymbolDataUrl,
  buildAssetSymbolDataUrl,
  preloadPublicMapAssetFragments,
  geoCircleCoords,
  geoSectorCoords,
  geoRadarSweepCoords,
  resolveTrackPointFill,
  isAirTrackBirdGlyph,
} from "@/lib/map-icons";
import { resolveVerifiedTrackPointFill } from "@/lib/verified-track-color";
import { adaptAssetsForMap } from "@/lib/map-asset-adapter";
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

function trackBillboardRotationRad(track: Pick<Track, "heading" | "trackLayerKey" | "ddsSourceId" | "dataSourceId" | "sensor" | "targetType" | "name" | "isAirTrack" | "type" | "trackCategoryId" | "isUav">, Cesium: CesiumModule): number {
  const noRotateBirdOnFuseAir =
    resolveTrackLayerKey(track) === "fuse_air" && isAirTrackBirdGlyph(track);
  if (noRotateBirdOnFuseAir) return 0;
  return -Cesium.Math.toRadians(track.heading ?? 0);
}

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
  | "zones"
  | "dbAreas";

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
    fillColor: z.fill_color,
    lineColor: z.color,
    fillOpacity: z.fill_opacity,
  }));
}

/**
 * 说明：
 * 资产 `AssetData -> Asset` 统一适配已迁移到 `src/lib/map-asset-adapter.ts`（`adaptAssetsForMap`）。
 * 本文件是 3D 编排层，负责：
 * - Cesium 生命周期
 * - 3D 资产/航迹/区域实体同步
 * - 3D 交互与层显隐
 */

/** 批量创建/刷新 3D 区域实体（先清旧再建新） */
function syncCesiumZones(
  viewer: CesiumViewer,
  C: CesiumModule,
  groups: { zones: CesiumEntity[] },
  zones: RestrictedZone[],
) {
  for (const e of groups.zones) viewer.entities.remove(e);
  groups.zones.length = 0;

  const rgba = (c: RGBA) => new C.Color(c[0], c[1], c[2], c[3]);
  for (const zone of zones) {
    const style = ZONE_STYLES[zone.type] ?? ZONE_STYLES["warning"];
    const coords = zone.coordinates.slice(0, -1);
    const positions = coords.map(([lng, lat]) => C.Cartesian3.fromDegrees(lng, lat));
    const centerLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

    const hasWsFill = zone.fillColor != null && String(zone.fillColor).trim() !== "";
    const fillMat = hasWsFill
      ? C.Color.fromCssColorString(mergeZoneFillColor(zone.fillColor, zone.fillOpacity ?? 0.25))
      : rgba(style.fill);
    const lineCss = zone.lineColor?.trim();
    const labelFill = lineCss ? C.Color.fromCssColorString(lineCss) : rgba(style.line);

    const ent = viewer.entities.add({
      polygon: {
        hierarchy: new C.PolygonHierarchy(positions),
        material: fillMat,
        outline: false,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: zone.name,
        font: '12px Roboto, "Noto Sans SC", sans-serif',
        fillColor: labelFill,
        outlineColor: C.Color.fromCssColorString("#09090b"),
        outlineWidth: 2,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: C.VerticalOrigin.CENTER,
        scaleByDistance: new C.NearFarScalar(1e4, 1, 5e5, 0.4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      position: C.Cartesian3.fromDegrees(centerLng, centerLat, 100),
      properties: { zoneId: zone.id },
    });
    groups.zones.push(ent);
  }
}

/** Postgres `area_table` → 3D 多边形（与 `lyr-db-areas` 显隐一致） */
function syncCesiumDbAreas(
  viewer: CesiumViewer,
  C: CesiumModule,
  groups: { dbAreas: CesiumEntity[] },
  rows: AreaTableRow[],
  areaVisibility: Record<string, boolean>,
  layerMasterOn: boolean,
  areaStyle: ReturnType<typeof pickSituationAreaLayerStyle>,
) {
  for (const e of groups.dbAreas) viewer.entities.remove(e);
  groups.dbAreas.length = 0;

  for (const row of rows) {
    if (!layerMasterOn) continue;
    if (areaVisibility[dbAreaVisibilityKey(row.group_id, row.area_id)] === false) continue;
    const ring = areaRowToPolygonRing(row);
    if (!ring || ring.length < 4) continue;
    const coords = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
    const positions = coords.map(([lng, lat]) => C.Cartesian3.fromDegrees(lng, lat));
    const ringClosed: [number, number][] = [...coords.map(([lng, lat]) => [lng, lat] as [number, number]), coords[0]];
    const northLbl =
      row.area_type === 2 ? circleLabelLngLatNorth(row.start_point, row.end_point) : null;
    const [labelLng, labelLat] = northLbl ?? ringSouthEastLabelLngLat(ringClosed);

    const lineCss = parseAreaLineColor(row.line_color, areaStyle.lineColor || DEFAULT_AREA_LAYER_LINE_COLOR);
    const outlineCol = C.Color.fromCssColorString(lineCss).withAlpha(areaStyle.lineOpacity);
    const labelFill = C.Color.fromCssColorString(lineCss).withAlpha(areaStyle.labelOpacity);
    const outlineW = areaStyle.lineWidth;

    const name =
      (row.area_name && String(row.area_name).trim()) ||
      mapAreaFallbackLabel(row.group_id, row.area_id, row.area_type);
    const id = dbAreaFeatureId(row);

    const ent = viewer.entities.add({
      polygon: {
        hierarchy: new C.PolygonHierarchy(positions),
        material: C.Color.TRANSPARENT,
        outline: true,
        outlineColor: outlineCol,
        outlineWidth: outlineW,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: name,
        font: '11px Roboto, "Noto Sans SC", sans-serif',
        fillColor: labelFill,
        outlineColor: C.Color.fromCssColorString("#09090b"),
        outlineWidth: 2,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        /** 与 2D `text-anchor: bottom-right` 一致：锚点为字块东南角，向西北铺开 */
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        horizontalOrigin: C.HorizontalOrigin.RIGHT,
        pixelOffset: new C.Cartesian2(0, 0),
        scaleByDistance: new C.NearFarScalar(1e4, 1, 5e5, 0.4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      position: C.Cartesian3.fromDegrees(labelLng, labelLat, 120),
      properties: { dbAreaId: id },
    });
    groups.dbAreas.push(ent);
  }
}

/**
 * 光电/机场/无人机等**非雷达**覆盖扇区：与 Map2D `OptoelectronicFovModule.setFromAssets` 一样需随 asset-store 刷新。
 * 初始化只跑一次会在长时间 `await` 后仍停留在首帧朝向；故 init 末尾与 `useAssetStore.subscribe` 都要调用。
 */
function cameraFovMapEligible(
  asset: Asset,
  perDevice: Readonly<OptoDeviceVisibilityMap>,
  panelIds: ReadonlySet<string> | null,
): boolean {
  if (asset.type !== "camera") return true;
  if (asset.showFov === false) return false;
  if (!asset.range || asset.range <= 0) return false;
  return shouldRenderOptoCameraFov(asset.id, perDevice, panelIds);
}

function resolveOptoPanelCameraIds(): ReadonlySet<string> | null {
  const cam = useMapGisCameraMenuStore.getState();
  return cam.loaded ? new Set(cam.rows.map((r) => r.entityId)) : null;
}

function applyCesiumOptoPerDeviceShow(
  groups: { optoFov: CesiumEntity[]; assets: CesiumEntity[] },
  layerMasterOn: boolean,
  perDevice: Readonly<OptoDeviceVisibilityMap>,
  panelIds: ReadonlySet<string> | null,
) {
  for (const ent of groups.optoFov) {
    const aid = ent.properties?.assetId?.getValue() as string | undefined;
    ent.show =
      layerMasterOn && (aid ? shouldRenderOptoCameraFov(aid, perDevice, panelIds) : true);
  }
  for (const ent of groups.assets) {
    const at = ent.properties?.assetType?.getValue() as string | undefined;
    if (at !== "camera") continue;
    const aid = ent.properties?.assetId?.getValue() as string | undefined;
    ent.show =
      layerMasterOn && (aid ? shouldRenderOptoCameraIcon(aid, perDevice, panelIds) : true);
  }
}

function syncCesiumNonRadarCoverageFov(
  viewer: CesiumViewer,
  C: CesiumModule,
  groups: { optoFov: CesiumEntity[]; airportFov: CesiumEntity[]; droneFov: CesiumEntity[] },
  assets: Asset[],
  perDevice: Readonly<OptoDeviceVisibilityMap> = {},
  panelIds: ReadonlySet<string> | null = null,
) {
  const rgba = (c: RGBA) => new C.Color(c[0], c[1], c[2], c[3]);
  for (const ent of groups.optoFov) viewer.entities.remove(ent);
  for (const ent of groups.airportFov) viewer.entities.remove(ent);
  for (const ent of groups.droneFov) viewer.entities.remove(ent);
  groups.optoFov.length = 0;
  groups.airportFov.length = 0;
  groups.droneFov.length = 0;

  for (const asset of assets) {
    if (asset.type === "radar") continue;
    if (!asset.range || asset.range <= 0) continue;
    if (!cameraFovMapEligible(asset, perDevice, panelIds)) continue;
    const covStyle = COVERAGE_STYLES[asset.type] ?? COVERAGE_STYLES["tower"];
    const isSector = asset.fovAngle !== undefined && asset.fovAngle < 360 && asset.heading !== undefined;
    const coords = isSector
      ? geoSectorCoords(asset.lng, asset.lat, asset.range, asset.heading!, asset.fovAngle!)
      : geoCircleCoords(asset.lng, asset.lat, asset.range);
    const positions = coords.map(([lng, lat]) => C.Cartesian3.fromDegrees(lng, lat));
    const ent = viewer.entities.add({
      polygon: {
        hierarchy: new C.PolygonHierarchy(positions),
        material: rgba(covStyle.fill),
        outline: false,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
      properties: { assetId: asset.id, _coverage: true },
    });
    if (asset.type === "airport") groups.airportFov.push(ent);
    else if (asset.type === "drone") groups.droneFov.push(ent);
    else groups.optoFov.push(ent);
  }
}

function applyNonRadarFovLayerVisibility(
  groups: { optoFov: CesiumEntity[]; airportFov: CesiumEntity[]; droneFov: CesiumEntity[] },
  layerOn: (k: string) => boolean,
) {
  for (const ent of groups.optoFov) ent.show = layerOn("lyr-opto-fov");
  for (const ent of groups.airportFov) ent.show = layerOn("lyr-airport");
  for (const ent of groups.droneFov) ent.show = layerOn("lyr-drones");
}

/** 与 Map2D 一致：store 全量画航迹 billboard（最新位置）；折线仅在 `trackMapDrawHistoryTrails` 为真时画；超预算整批不画尾迹线，仅保留最新点实体（不删 store） */
async function syncCesiumTrackBillboards(
  viewer: CesiumViewer,
  Cesium: CesiumModule,
  groups: { tracks: CesiumEntity[]; trackTrails: CesiumEntity[] },
  allTracks: Track[],
  accent: AssetDispositionIconAccent,
) {
  const td = useTrackDisplayStore.getState();
  const drawTrails = trackMapDrawHistoryTrails(allTracks);
  const visibleIds = new Set(allTracks.map((t) => t.id));
  const fullMap = new Map(allTracks.map((t) => [t.id, t]));

  const pickTrackPointCss = (t: Track, eff: ReturnType<typeof getTrackDispositionForRendering>, friendlyFill?: string) => {
    const base =
      eff === "neutral"
        ? neutralFusionColorForTrack(t, td.seaFusionColor, td.airFusionColor)
        : resolveTrackPointFill(t, eff, accent, friendlyFill);
    return resolveVerifiedTrackPointFill(t, base);
  };

  for (const ent of groups.trackTrails) {
    viewer.entities.remove(ent);
  }
  groups.trackTrails = [];

  const kept: CesiumEntity[] = [];
  for (const ent of groups.tracks) {
    const tid = ent.properties?.trackId?.getValue() as string | undefined;
    if (!tid || !visibleIds.has(tid)) {
      viewer.entities.remove(ent);
      continue;
    }
    const tr = fullMap.get(tid);
    if (!tr) {
      viewer.entities.remove(ent);
      continue;
    }
    const wantDot = isDotTrackLayerKey(resolveTrackLayerKey(tr));
    const hasDot = Boolean(ent.point);
    if (wantDot !== hasDot) {
      viewer.entities.remove(ent);
      continue;
    }
    kept.push(ent);
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
    const eff = getTrackDispositionForRendering(track);
    const friendlyFill = eff === "friendly" ? ts.idColor : undefined;
    const fusionTint =
      eff === "neutral" ? neutralFusionColorForTrack(track, td.seaFusionColor, td.airFusionColor) : undefined;
    const wantDot = isDotTrackLayerKey(resolveTrackLayerKey(track));
    const opticallyVerified = shouldApplyVerifiedTrackGreen(track);
    const labelCommon = {
      text: track.name,
      font: '11px Roboto, "Noto Sans SC", sans-serif',
      fillColor: Cesium.Color.fromCssColorString(pickTrackPointCss(track, eff, friendlyFill)),
      outlineColor: Cesium.Color.fromCssColorString("#09090b"),
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, wantDot ? -22 : -26),
      scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.4),
      translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 8e5, 0.2),
    };
    const ent = wantDot
      ? viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString(pickTrackPointCss(track, eff, friendlyFill)).withAlpha(0.92),
            outlineColor: Cesium.Color.fromCssColorString("#09090b"),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.NONE,
          },
          label: labelCommon,
          properties: { trackId: track.id },
        })
      : viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
          billboard: {
            image: await buildMarkerSymbolDataUrl(
              track.type,
              eff,
              accent,
              isTrackVirtualTroop(track),
              friendlyFill,
              fusionTint,
              isAirTrackBirdGlyph(track),
              resolveTrackLayerKey(track) === "fuse_air" && isAirTrackBirdGlyph(track),
              opticallyVerified,
            ),
            scale: 0.90,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.NONE,
            rotation: trackBillboardRotationRad(track, Cesium),
            color: Cesium.Color.WHITE,
          },
          label: labelCommon,
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
    const ts = trCfg.trackTypeStyles[t.type] ?? trCfg.trackTypeStyles.sea;
    const eff = getTrackDispositionForRendering(t);
    const friendlyFill = eff === "friendly" ? ts.idColor : undefined;
    const pc = pickTrackPointCss(t, eff, friendlyFill);
    const fusionTint =
      eff === "neutral" ? neutralFusionColorForTrack(t, td.seaFusionColor, td.airFusionColor) : undefined;
    const opticallyVerified = shouldApplyVerifiedTrackGreen(t);
    if (ent.point) {
      ent.point.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(pc).withAlpha(0.92));
      if (ent.label) {
        ent.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(pc));
        ent.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(0, -22));
      }
    } else if (ent.billboard) {
      const image = await buildMarkerSymbolDataUrl(
        t.type,
        eff,
        accent,
        isTrackVirtualTroop(t),
        friendlyFill,
        fusionTint,
        isAirTrackBirdGlyph(t),
        resolveTrackLayerKey(t) === "fuse_air" && isAirTrackBirdGlyph(t),
        opticallyVerified,
      );
      ent.billboard.image = new Cesium.ConstantProperty(image);
      ent.billboard.rotation = new Cesium.ConstantProperty(trackBillboardRotationRad(t, Cesium));
      if (ent.label) {
        ent.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(pc));
        ent.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(0, -26));
      }
    }
  }

  const alt = (z: number | undefined) => (Number.isFinite(z) ? (z as number) : 0);

  if (drawTrails) {
    for (const t of allTracks) {
      const trail = trimHistoryTrailForDisplay(t.historyTrail, trailLengthSecondsForTrack(t, td));
      if (!trail || trail.length < 1) continue;
      const ts2 = trCfg.trackTypeStyles[t.type] ?? trCfg.trackTypeStyles.sea;
      const eff = getTrackDispositionForRendering(t);
      const friendlyFill2 = eff === "friendly" ? ts2.idColor : undefined;
      const positions = [...trail, [t.lng, t.lat] as [number, number]].map(([lng, lat]) =>
        Cesium.Cartesian3.fromDegrees(lng, lat, alt(t.altitude)),
      );
      const lineEnt = viewer.entities.add({
        polyline: {
          positions,
          width: 2,
          material: Cesium.Color.fromCssColorString(pickTrackPointCss(t, eff, friendlyFill2)).withAlpha(0.48),
          clampToGround: true,
        },
        properties: { trackTrailFor: t.id },
      });
      groups.trackTrails.push(lineEnt);
    }
  }

  for (const t of allTracks) {
    const vecEnd = velocityVectorEndLngLat(t, vectorLengthSecondsForTrack(t, td));
    if (!vecEnd) continue;
    const lineEnt = viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(t.lng, t.lat, alt(t.altitude)),
          Cesium.Cartesian3.fromDegrees(vecEnd[0], vecEnd[1], alt(t.altitude)),
        ],
        width: 4,
        /** 与 2D MapLibre `tracks-vector` 一致：红色速度矢量，便于辨认 */
        material: Cesium.Color.fromCssColorString("#ff2222").withAlpha(0.92),
        clampToGround: true,
      },
      properties: { trackVectorFor: t.id },
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
  const distanceRingGroupsRef = useRef<CesiumDistanceRingGroups>({ rings: [], labels: [] });
  const entityGroupsRef = useRef<Record<GroupKey, CesiumEntity[]>>({
    tracks: [],
    trackTrails: [],
    assets: [],
    radarCoverage: [],
    optoFov: [],
    airportFov: [],
    droneFov: [],
    zones: [],
    dbAreas: [],
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
    let cesiumScalePush: (() => void) | null = null;

    const init = async () => {
      try {
        const Cesium = await import("cesium");
        cesiumRef.current = Cesium;

        if (typeof window !== "undefined") {
          (window as typeof window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium/";
        }
        if (destroyed || !containerRef.current) return;

        const appCfg = await useAppConfigStore.getState().ensureLoaded();
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

        viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        const v = viewer;
        const groups = entityGroupsRef.current;

        /* 1) 限制区 */
        const rgba = (c: RGBA) => new Cesium.Color(c[0], c[1], c[2], c[3]);
        syncCesiumZones(v, Cesium, groups, adaptZones(useZoneStore.getState().zones));
        syncCesiumDbAreas(
          v,
          Cesium,
          groups,
          useDbAreaStore.getState().rows,
          useDbAreaStore.getState().areaVisibility,
          useAppStore.getState().layerVisibility[LYR_DB_AREAS] !== false,
          pickSituationAreaLayerStyle(useDistanceRingStore.getState()),
        );

        /* 2) 雷达覆盖（圆/扫描）与光电 FOV（扇形/圆）分开展示，与 2D 图层面板两项一致 */
        const _assets = adaptAssetsForMap(useAssetStore.getState().assets);
        const optoPerDevice = useOptoDeviceLayerStore.getState().deviceVisibility;
        const optoPanelIds = resolveOptoPanelCameraIds();
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
          } else if (cameraFovMapEligible(asset, optoPerDevice, optoPanelIds)) {
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

        /* 3) 航迹：store 全量；`historyTrail` 条数由 `maxHistoryPointsPerTrack` 裁剪；折线是否绘制受 `maxViewportPoints` 预算（与 Map2D 一致） */
        cesiumTrackAccentRef.current = assetIconAccent;
        await syncCesiumTrackBillboards(v, Cesium, groups, useTrackStore.getState().tracks, assetIconAccent);

        /* 4) 资产 billboard（无人机名称样式与 2D 一致：`drones.label` → `laserLabelStyleFromBundle`） */
        const defaultAssetLabelFont = '10px Roboto, "Noto Sans SC", sans-serif';
        for (const asset of _assets) {
          if (
            asset.type === "camera" &&
            (asset.centerIconVisible === false ||
              !shouldRenderOptoCameraIcon(asset.id, optoPerDevice, optoPanelIds))
          ) {
            continue;
          }
          const disp = asset.disposition ?? "friendly";
          const isDrone = asset.type === "drone";
          const labelHex = assetMapLabelTextColor(
            disp,
            asset.status,
            assetIconAccent,
            disp === "friendly" ? asset.labelFontColor : undefined,
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

        cesiumScalePush = () => {
          const mpp = metersPerPixelCesium(
            v as import("@/lib/map-scale-bar").CesiumScaleViewer,
            Cesium,
          );
          useMapPointerStore.getState().setMetersPerPixel(mpp);
        };
        cesiumScalePush();
        v.camera.moveEnd.addEventListener(cesiumScalePush);

        /* init 内有 await：用最新 asset-store 再刷一遍扇区，避免仍停在配置/首帧朝向 */
        syncCesiumNonRadarCoverageFov(
          v,
          Cesium,
          groups,
          adaptAssetsForMap(useAssetStore.getState().assets),
          optoPerDevice,
          optoPanelIds,
        );

        viewerRef.current = v;

        syncCesiumDistanceRings(
          v,
          Cesium,
          distanceRingGroupsRef.current,
          pickDistanceRingSettings(useDistanceRingStore.getState()),
          useAppStore.getState().layerVisibility[LYR_DISTANCE_RINGS] !== false,
        );

        /* 按 layerVisibility 设置各组 entity 显隐（资产 billboard 按 `assetType` 分键，与 Map2D 一致） */
        const layerVis = useAppStore.getState().layerVisibility;
        const layerOn = (k: string) => layerVis[k] !== false;
        const optoMasterOn = layerOn(LYR_OPTO_FOV);
        for (const ent of groups.tracks) ent.show = layerOn("lyr-tracks");
        for (const ent of groups.trackTrails) ent.show = layerOn("lyr-tracks");
        for (const ent of groups.radarCoverage) ent.show = layerOn("lyr-radar-coverage");
        applyNonRadarFovLayerVisibility(groups, layerOn);
        for (const ent of groups.zones) ent.show = layerOn("lyr-zones");
        for (const ent of groups.dbAreas) ent.show = layerOn("lyr-db-areas");
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
        applyCesiumOptoPerDeviceShow(groups, optoMasterOn, optoPerDevice, optoPanelIds);

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
      if (viewer && !viewer.isDestroyed()) {
        if (cesiumScalePush) {
          viewer.camera.moveEnd.removeEventListener(cesiumScalePush);
        }
        viewer.destroy();
      }
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
        dbAreas: [],
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

  /** 显示控制 · 距离环：参数变化时重建 Cesium 实体 */
  useEffect(() => {
    const flush = () => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      const s = useDistanceRingStore.getState();
      syncCesiumDistanceRings(
        v,
        C,
        distanceRingGroupsRef.current,
        pickDistanceRingSettings(s),
        useAppStore.getState().layerVisibility[LYR_DISTANCE_RINGS] !== false,
      );
    };
    return useDistanceRingStore.subscribe(flush);
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
      for (const ent of g.dbAreas) ent.show = layerOn("lyr-db-areas");
      const drVis = layerOn(LYR_DISTANCE_RINGS);
      for (const ent of distanceRingGroupsRef.current.rings) ent.show = drVis;
      for (const ent of distanceRingGroupsRef.current.labels) ent.show = drVis;
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
      applyCesiumOptoPerDeviceShow(
        g,
        layerOn(LYR_OPTO_FOV),
        useOptoDeviceLayerStore.getState().deviceVisibility,
        resolveOptoPanelCameraIds(),
      );
    });
    return unsub;
  }, []);

  /* 光电装备：按设备视场 / GIS 图标 + 面板白名单 */
  useEffect(() => {
    const flush = () => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      const perDevice = useOptoDeviceLayerStore.getState().deviceVisibility;
      const panelIds = resolveOptoPanelCameraIds();
      const layerOn = useAppStore.getState().layerVisibility[LYR_OPTO_FOV] !== false;
      syncCesiumNonRadarCoverageFov(
        v,
        C,
        entityGroupsRef.current,
        adaptAssetsForMap(useAssetStore.getState().assets),
        perDevice,
        panelIds,
      );
      applyCesiumOptoPerDeviceShow(entityGroupsRef.current, layerOn, perDevice, panelIds);
    };
    const unsubVis = useOptoDeviceLayerStore.subscribe(flush);
    const unsubCam = useMapGisCameraMenuStore.subscribe(flush);
    const unsubMaster = useAppStore.subscribe((s, p) => {
      if ((s.layerVisibility[LYR_OPTO_FOV] ?? true) === (p.layerVisibility[LYR_OPTO_FOV] ?? true)) return;
      flush();
    });
    void useMapGisCameraMenuStore.getState().ensureLoaded();
    return () => {
      unsubVis();
      unsubCam();
      unsubMaster();
    };
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

  /* 区域：响应式同步（WS 推送新区域时自动刷新） */
  useEffect(() => {
    const unsub = useZoneStore.subscribe((s) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      syncCesiumZones(v, C, entityGroupsRef.current, adaptZones(s.zones));
    });
    return unsub;
  }, []);

  /* 数据库区域图层：子项显隐 / 总开关 → Cesium 实体 */
  useEffect(() => {
    const flush = () => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      const da = useDbAreaStore.getState();
      syncCesiumDbAreas(
        v,
        C,
        entityGroupsRef.current,
        da.rows,
        da.areaVisibility,
        useAppStore.getState().layerVisibility[LYR_DB_AREAS] !== false,
        pickSituationAreaLayerStyle(useDistanceRingStore.getState()),
      );
    };
    const unsub1 = useDbAreaStore.subscribe(flush);
    const unsub2 = useAppStore.subscribe((s, p) => {
      if ((s.layerVisibility[LYR_DB_AREAS] ?? true) === (p.layerVisibility[LYR_DB_AREAS] ?? true)) return;
      flush();
    });
    const unsub3 = useDistanceRingStore.subscribe(flush);
    flush();
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
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
          const vis = useAppStore.getState().layerVisibility;
          const sub = useTrackDisplayStore.getState().trackSubtypeVisible;
          const airSub = useTrackDisplayStore.getState().airFusionSubtypeVisible;
          const snap = filterTracksForMapRender(useTrackStore.getState().tracks, vis, sub, airSub);
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
    const unsubDisplay = useTrackDisplayStore.subscribe(() => {
      void flush();
    });
    const unsubLayerVis = useAppStore.subscribe((s, p) => {
      if (
        (s.layerVisibility[LYR_TRACKS] !== false) === (p.layerVisibility[LYR_TRACKS] !== false)
      ) {
        return;
      }
      void flush();
    });
    const unsubVerified = useVerifiedTrackStore.subscribe((s, p) => {
      if (s.mapVerifiedRev === p.mapVerifiedRev) return;
      void flush();
    });
    return () => {
      cancelled = true;
      unsub();
      unsubDisplay();
      unsubLayerVis();
      unsubVerified();
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

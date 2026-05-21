import maplibregl, {
  type GeoJSONSourceSpecification,
  type LngLat,
  type LngLatBoundsLike,
  type LngLatLike,
  type Map,
  type MapGeoJSONFeature,
  type PaddingOptions,
  type PointLike,
} from "maplibre-gl";
import {
  convertGeoJsonToGcj,
  gcj02ToWgs84,
  type LngLatPoint,
  wgs84ToGcj02,
} from "@/lib/gcj";

type FlyToLike = {
  center?: LngLatLike;
};

type EaseToLike = {
  center?: LngLatLike;
};

type JumpToLike = {
  center?: LngLatLike;
};

type FitBoundsLike = {
  padding?: number | PaddingOptions;
  maxZoom?: number;
  linear?: boolean;
  duration?: number;
  essential?: boolean;
  offset?: PointLike;
};

type MapWithPatchedGeoJson = Map & {
  __gcjGeoJsonPatched?: boolean;
};

type PatchableGeoJsonSource = {
  __gcjSetDataPatched?: boolean;
  setData: (data: GeoJSON.GeoJSON | string) => unknown;
};

function toWgsPoint(value: LngLatLike): LngLatPoint {
  const ll = maplibregl.LngLat.convert(value);
  return { lng: ll.lng, lat: ll.lat };
}

function toGcjLngLatLike(value: LngLatLike): LngLatLike {
  const converted = wgs84ToGcj02(toWgsPoint(value));
  return [converted.lng, converted.lat];
}

function toWgsLngLat(value: LngLat): LngLat {
  const converted = gcj02ToWgs84({ lng: value.lng, lat: value.lat });
  return new maplibregl.LngLat(converted.lng, converted.lat);
}

function patchGeoJsonSourceInstance(source: unknown): void {
  if (!source || typeof source !== "object") return;
  const patchable = source as PatchableGeoJsonSource;
  if (patchable.__gcjSetDataPatched || typeof patchable.setData !== "function") {
    return;
  }

  const original = patchable.setData.bind(source);
  patchable.setData = (data: GeoJSON.GeoJSON | string) => {
    if (typeof data === "string") {
      return original(data);
    }
    return original(convertGeoJsonToGcj(data));
  };
  patchable.__gcjSetDataPatched = true;
}

function patchMapAddSource(map: MapWithPatchedGeoJson): void {
  if (map.__gcjGeoJsonPatched) return;
  const original = map.addSource.bind(map);
  map.addSource = ((id: string, source: GeoJSONSourceSpecification | unknown) => {
    if (
      source &&
      typeof source === "object" &&
      (source as { type?: string }).type === "geojson" &&
      "data" in (source as Record<string, unknown>)
    ) {
      const geo = source as GeoJSONSourceSpecification;
      if (geo.data && typeof geo.data !== "string") {
        const result = original(id, {
          ...geo,
          data: convertGeoJsonToGcj(geo.data),
        });
        patchGeoJsonSourceInstance(map.getSource(id));
        return result;
      }
    }
    const result = original(id, source as never);
    patchGeoJsonSourceInstance(map.getSource(id));
    return result;
  }) as typeof map.addSource;
  map.__gcjGeoJsonPatched = true;
}

function patchMapCameraAndProjection(map: Map): void {
  const originalFlyTo = map.flyTo.bind(map);
  map.flyTo = ((options) => {
    const next = options as FlyToLike;
    if (next?.center) {
      return originalFlyTo({
        ...options,
        center: toGcjLngLatLike(next.center),
      });
    }
    return originalFlyTo(options);
  }) as typeof map.flyTo;

  const originalEaseTo = map.easeTo.bind(map);
  map.easeTo = ((options) => {
    const next = options as EaseToLike;
    if (next?.center) {
      return originalEaseTo({
        ...options,
        center: toGcjLngLatLike(next.center),
      });
    }
    return originalEaseTo(options);
  }) as typeof map.easeTo;

  const originalJumpTo = map.jumpTo.bind(map);
  map.jumpTo = ((options) => {
    const next = options as JumpToLike;
    if (next?.center) {
      return originalJumpTo({
        ...options,
        center: toGcjLngLatLike(next.center),
      });
    }
    return originalJumpTo(options);
  }) as typeof map.jumpTo;

  const originalSetCenter = map.setCenter.bind(map);
  map.setCenter = ((center) => originalSetCenter(toGcjLngLatLike(center))) as typeof map.setCenter;

  const originalFitBounds = map.fitBounds.bind(map);
  map.fitBounds = ((bounds: LngLatBoundsLike, options?: FitBoundsLike) => {
    const b = maplibregl.LngLatBounds.convert(bounds);
    const sw = wgs84ToGcj02({ lng: b.getWest(), lat: b.getSouth() });
    const ne = wgs84ToGcj02({ lng: b.getEast(), lat: b.getNorth() });
    return originalFitBounds(
      [
        [sw.lng, sw.lat],
        [ne.lng, ne.lat],
      ],
      options,
    );
  }) as typeof map.fitBounds;

  const originalGetCenter = map.getCenter.bind(map);
  map.getCenter = (() => toWgsLngLat(originalGetCenter())) as typeof map.getCenter;

  const originalProject = map.project.bind(map);
  map.project = ((lnglat) => originalProject(toGcjLngLatLike(lnglat))) as typeof map.project;

  const originalUnproject = map.unproject.bind(map);
  map.unproject = ((point) => toWgsLngLat(originalUnproject(point))) as typeof map.unproject;
}

function patchFeatureCoordinates(
  feature: MapGeoJSONFeature,
): MapGeoJSONFeature {
  const geometry = feature.geometry;
  if (!geometry) return feature;
  return {
    ...feature,
    geometry: convertGeoJsonToWgs84(geometry),
  };
}

function patchMapQueryMethods(map: Map): void {
  const originalQueryRenderedFeatures = map.queryRenderedFeatures.bind(map);
  map.queryRenderedFeatures = ((geometryOrOptions?: PointLike | [PointLike, PointLike] | maplibregl.QueryRenderedFeaturesOptions, options?: maplibregl.QueryRenderedFeaturesOptions) => {
    const result = originalQueryRenderedFeatures(
      geometryOrOptions as never,
      options,
    );
    return result.map((feature) => patchFeatureCoordinates(feature));
  }) as typeof map.queryRenderedFeatures;

  const originalQuerySourceFeatures = map.querySourceFeatures.bind(map);
  map.querySourceFeatures = ((sourceId, parameters) => {
    const result = originalQuerySourceFeatures(sourceId, parameters);
    return result.map((feature) => patchFeatureCoordinates(feature));
  }) as typeof map.querySourceFeatures;
}

export function applyGcjMapAdapter(map: Map): Map {
  patchMapAddSource(map as MapWithPatchedGeoJson);
  patchMapCameraAndProjection(map);
  patchMapQueryMethods(map);
  return map;
}

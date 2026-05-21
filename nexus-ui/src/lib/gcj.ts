export type LngLatPoint = {
  lng: number;
  lat: number;
};

type Position = number[];

type SupportedGeometry =
  | GeoJSON.Point
  | GeoJSON.MultiPoint
  | GeoJSON.LineString
  | GeoJSON.MultiLineString
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon
  | GeoJSON.GeometryCollection;

const PI = Math.PI;
const AXIS = 6378245.0;
const OFFSET = 0.006693421622965943;

export function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number): number {
  let value =
    -100 +
    2 * lng +
    3 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  value +=
    ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  value +=
    ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3;
  value +=
    ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) /
    3;
  return value;
}

function transformLng(lng: number, lat: number): number {
  let value =
    300 +
    lng +
    2 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  value +=
    ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  value +=
    ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3;
  value +=
    ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) /
    3;
  return value;
}

export function wgs84ToGcj02(point: LngLatPoint): LngLatPoint {
  if (outOfChina(point.lng, point.lat)) {
    return point;
  }

  let dLat = transformLat(point.lng - 105, point.lat - 35);
  let dLng = transformLng(point.lng - 105, point.lat - 35);
  const radLat = (point.lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - OFFSET * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat =
    (dLat * 180) /
    (((AXIS * (1 - OFFSET)) / (magic * sqrtMagic)) * PI);
  dLng =
    (dLng * 180) /
    ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);

  return {
    lng: point.lng + dLng,
    lat: point.lat + dLat,
  };
}

export function gcj02ToWgs84(point: LngLatPoint): LngLatPoint {
  if (outOfChina(point.lng, point.lat)) {
    return point;
  }
  const gcj = wgs84ToGcj02(point);
  return {
    lng: point.lng * 2 - gcj.lng,
    lat: point.lat * 2 - gcj.lat,
  };
}

function convertPosition(position: Position, convert: (point: LngLatPoint) => LngLatPoint): Position {
  const [lng, lat, ...rest] = position;
  if (typeof lng !== "number" || typeof lat !== "number") {
    return position;
  }
  const converted = convert({ lng, lat });
  return [converted.lng, converted.lat, ...rest];
}

function convertCoordinates(
  coordinates: unknown,
  convert: (point: LngLatPoint) => LngLatPoint,
): unknown {
  if (!Array.isArray(coordinates)) {
    return coordinates;
  }
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return convertPosition(coordinates as Position, convert);
  }
  return coordinates.map((item) => convertCoordinates(item, convert));
}

export function convertGeometryCoordinates<T extends SupportedGeometry>(
  geometry: T,
  convert: (point: LngLatPoint) => LngLatPoint,
): T {
  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map((item) =>
        convertGeometryCoordinates(item as SupportedGeometry, convert),
      ),
    } as T;
  }

  return {
    ...geometry,
    coordinates: convertCoordinates(
      geometry.coordinates,
      convert,
    ) as T["coordinates"],
  };
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  return !!value && typeof value === "object" && (value as { type?: string }).type === "FeatureCollection";
}

function isFeature(value: unknown): value is GeoJSON.Feature {
  return !!value && typeof value === "object" && (value as { type?: string }).type === "Feature";
}

function isGeometry(value: unknown): value is SupportedGeometry {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: string }).type;
  return (
    type === "Point" ||
    type === "MultiPoint" ||
    type === "LineString" ||
    type === "MultiLineString" ||
    type === "Polygon" ||
    type === "MultiPolygon" ||
    type === "GeometryCollection"
  );
}

export function convertGeoJsonToGcj<T>(data: T): T {
  return convertGeoJson(data, wgs84ToGcj02);
}

export function convertGeoJsonToWgs84<T>(data: T): T {
  return convertGeoJson(data, gcj02ToWgs84);
}

function convertGeoJson<T>(
  data: T,
  convert: (point: LngLatPoint) => LngLatPoint,
): T {
  if (isFeatureCollection(data)) {
    return {
      ...data,
      features: data.features.map((feature) => convertGeoJson(feature, convert)),
    } as T;
  }

  if (isFeature(data)) {
    if (!data.geometry) return data;
    return {
      ...data,
      geometry: convertGeometryCoordinates(
        data.geometry as SupportedGeometry,
        convert,
      ),
    } as T;
  }

  if (isGeometry(data)) {
    return convertGeometryCoordinates(data, convert) as T;
  }

  return data;
}

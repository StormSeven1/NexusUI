import type { AreaDrawShape } from "@/lib/area-table-serialize";
import type { LngLat } from "@/lib/area-table-serialize";
import { areaEntityId } from "@/lib/area-entity-id";
import { ringFromAreaRect, ringFromCircle } from "@/lib/area-table-geometry";
import { serializeAreaRect, serializeCircle } from "@/lib/area-table-serialize";
import { addYears, haversineMeters, isoUtc } from "@/lib/entity-publish-time";

export type AreaEntityGeometry =
  | { type: "Polygon"; coordinates: number[][]; altitude?: { min: number; max: number } }
  | { type: "Circle"; coordinates: number[][]; radius: number; altitude?: { min: number; max: number } };

/** 地图 [lng,lat] 环 → 实体 [lat,lng][]（可闭合） */
function ringLngLatToEntityCoords(ring: [number, number][], close = true): number[][] {
  const open =
    ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]
      ? ring.slice(0, -1)
      : ring;
  const coords = open.map(([lng, lat]) => [lat, lng]);
  if (close && coords.length >= 3) {
    const f = coords[0]!;
    const l = coords[coords.length - 1]!;
    if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0], f[1]]);
  }
  return coords;
}

export function buildAreaEntityGeometry(shape: AreaDrawShape, points: LngLat[]): AreaEntityGeometry | null {
  if (shape === "route") return null;

  const alt = { min: 0, max: 1000 };

  if (shape === "circle" && points.length >= 2) {
    const c = points[0]!;
    const e = points[1]!;
    const { start_point, end_point } = serializeCircle(c, e);
    const radius = haversineMeters(c.lat, c.lng, e.lat, e.lng);
    if (!(radius > 0)) return null;
    return {
      type: "Circle",
      coordinates: [[c.lat, c.lng]],
      radius,
      altitude: alt,
    };
  }

  let ring: [number, number][] | null = null;
  if (shape === "rect" && points.length >= 2) {
    ring = ringFromAreaRect(serializeAreaRect(points[0]!, points[1]!));
  } else if (shape === "polygon" && points.length >= 3) {
    const coords = points.map((p) => [p.lat, p.lng]);
    const f = coords[0]!;
    const l = coords[coords.length - 1]!;
    if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0]!, f[1]!]);
    return { type: "Polygon", coordinates: coords, altitude: alt };
  }

  if (!ring || ring.length < 3) return null;
  return { type: "Polygon", coordinates: ringLngLatToEntityCoords(ring, true), altitude: alt };
}

export type BuildAreaPublishEntityInput = {
  groupId: number;
  areaId: number;
  areaName: string;
  shape: AreaDrawShape;
  points: LngLat[];
  lineColor?: string;
  lineWidth?: number;
};

/** 按 `区域实体.json` 组包；不含 `geoShape` */
export function buildAreaPublishEntity(input: BuildAreaPublishEntityInput): Record<string, unknown> | null {
  const { groupId, areaId, areaName, shape, points } = input;
  if (shape === "route") return null;

  const geometry = buildAreaEntityGeometry(shape, points);
  if (!geometry) return null;

  const now = new Date();
  const createdTime = isoUtc(now);
  const expiryTime = isoUtc(addYears(now, 3));
  const lineColor = input.lineColor ?? "#3b82f6";
  const lineWidth = input.lineWidth ?? 2;

  return {
    entityId: areaEntityId(groupId, areaId),
    isLive: true,
    createdTime,
    expiryTime,
    noExpiry: true,
    aliases: {
      name: areaName,
      alternateIds: [
        {
          type: "ALT_ID_TYPE_ZONE",
          id: `ZONE${groupId}${areaId}`,
        },
      ],
    },
    ontology: {
      template: "TEMPLATE_AREA",
      platformType: "PLATFORM_TYPE_FIXED_GROUND",
      specificType: "SURVEILLANCE_AREA",
    },
    milView: {
      disposition: "DISPOSITION_FRIENDLY",
      environment: "ENVIRONMENT_LAND",
    },
    health: {
      healthStatus: "HEALTH_STATUS_HEALTHY",
      components: [],
    },
    areaParameters: {
      groupId: String(groupId),
      areaId: String(areaId),
      type: "AREA_TYPE_CUSTOM",
      geometry,
      properties: {
        priority: 1,
        validTime: { start: createdTime, end: expiryTime },
        accessLevel: "UNRESTRICTED",
        tags: ["custom"],
        description: areaName,
        alertLevel: 0,
        display: {
          lineWidth,
          lineColor,
          fillColor: `${lineColor}33`,
          isSelected: false,
        },
      },
      status: "AREA_STATUS_ACTIVE",
      geoDetails: {
        type: "GEO_TYPE_INVALID",
        controlArea: { type: "CONTROL_AREA_TYPE_INVALID" },
        acm: { acmType: "ACM_DETAIL_TYPE_INVALID", acmDescription: "" },
      },
      schedules: { schedules: [] },
    },
  };
}

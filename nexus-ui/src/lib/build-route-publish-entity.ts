import type { LngLat } from "@/lib/area-table-serialize";
import { routeEntityId } from "@/lib/area-entity-id";
import { addYears, isoUtc, polylineLengthMeters } from "@/lib/entity-publish-time";

export type BuildRoutePublishEntityInput = {
  groupId: number;
  areaId: number;
  routeName: string;
  points: LngLat[];
};

/** 按 `航线实体.json` 组包（`TEMPLATE_ROUTE` + `routeParameters`） */
export function buildRoutePublishEntity(input: BuildRoutePublishEntityInput): Record<string, unknown> | null {
  const { groupId, areaId, routeName, points } = input;
  if (points.length < 2) return null;

  const now = new Date();
  const createdTime = isoUtc(now);
  const expiryTime = isoUtc(addYears(now, 3));
  const routeCreatedMs = now.getTime();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const totalDistance = Math.round(polylineLengthMeters(points));
  const waypointCount = points.length;
  const estimatedTime = Math.max(60, Math.round(totalDistance / 5));

  return {
    entityId: routeEntityId(groupId, areaId),
    routeId: `${groupId}_${areaId}`,
    isLive: true,
    createdTime,
    expiryTime,
    noExpiry: true,
    routeCreatedTime: routeCreatedMs,
    aliases: {
      name: routeName,
      alternateIds: [
        {
          type: "ALT_ID_TYPE_ROUTE",
          id: `ROUTE${groupId}${areaId}`,
        },
      ],
    },
    ontology: {
      template: "TEMPLATE_ROUTE",
      platformType: "PLATFORM_TYPE_FIXED_GROUND",
      specificType: "PATROL_ROUTE",
    },
    milView: {
      disposition: "DISPOSITION_FRIENDLY",
      environment: "ENVIRONMENT_MARITIME",
    },
    health: {
      healthStatus: "HEALTH_STATUS_HEALTHY",
      components: [],
    },
    routeParameters: {
      djiRouteFileId: "",
      updateTime: routeCreatedMs,
      summary: {
        startPoint: {
          latitude: first.lat,
          longitude: first.lng,
          height: 0,
        },
        endPoint: {
          latitude: last.lat,
          longitude: last.lng,
          height: 0,
        },
        waypointCount,
        estimatedTime,
        totalDistance,
        maxHeight: 0,
      },
      routeDetails: {
        destinationName: routeName,
        estimatedArrivalTime: expiryTime,
      },
    },
  };
}

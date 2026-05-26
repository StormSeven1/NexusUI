import {
  formatRingLabelNm,
  NM_TO_METERS,
  type DistanceRingSettings,
} from "@/lib/distance-ring-settings";
import { geodesicCircleLngLatRing } from "@/lib/geodesic-circle";
import { pointAtBearingMeters } from "@/components/map/modules/radar-range-rings-maplibre";

import type { Entity, Viewer } from "cesium";

type CesiumModule = typeof import("cesium");

export type CesiumDistanceRingGroups = {
  rings: Entity[];
  labels: Entity[];
};

function clearEntities(viewer: Viewer, list: Entity[]) {
  for (const e of list) viewer.entities.remove(e);
  list.length = 0;
}

export function syncCesiumDistanceRings(
  viewer: Viewer,
  Cesium: CesiumModule,
  groups: CesiumDistanceRingGroups,
  settings: DistanceRingSettings,
  visible: boolean,
): void {
  clearEntities(viewer, groups.rings);
  clearEntities(viewer, groups.labels);
  if (!visible) return;

  const { ringCount, spacingNm, centerLat, centerLng, ringColor, ringOpacity, labelOpacity } =
    settings;
  const lineColor = Cesium.Color.fromCssColorString(ringColor).withAlpha(ringOpacity);
  const labelFill = Cesium.Color.fromCssColorString(ringColor).withAlpha(labelOpacity);
  const spacingM = spacingNm * NM_TO_METERS;

  for (let i = 1; i <= ringCount; i++) {
    const radiusM = i * spacingM;
    const ring = geodesicCircleLngLatRing(centerLng, centerLat, radiusM);
    groups.rings.push(
      viewer.entities.add({
        polyline: {
          positions: ring.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat)),
          width: 1.5,
          material: lineColor,
          clampToGround: true,
        },
      }),
    );

    const [labelLng, labelLat] = pointAtBearingMeters(centerLng, centerLat, radiusM, 0);
    groups.labels.push(
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(labelLng, labelLat),
        label: {
          text: formatRingLabelNm(i * spacingNm),
          font: '11px "Open Sans", "Noto Sans SC", sans-serif',
          fillColor: labelFill,
          outlineColor: Cesium.Color.fromCssColorString("#0a0a0f"),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
  }
}

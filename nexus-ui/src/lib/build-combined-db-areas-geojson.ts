import type { AreaTableRow } from "@/lib/area-table-geometry";
import { buildDbAreasFeatureCollection } from "@/lib/build-db-areas-geojson";
import {
  isDbAreaTargetLeafVisible,
  isDbAreaTargetListable,
  targetRowToAreaRow,
} from "@/lib/db-area-target-geometry";
import { isDbAreaLeafVisible } from "@/lib/db-area-panel-helpers";
import type { SituationAreaLayerStyle } from "@/lib/distance-ring-settings";
import type { AreaTableTargetRow } from "@/stores/db-area-target-store";

/** 合并 `area_table` + `area_table_target` 为同一 MapLibre source 的 GeoJSON */
export function buildCombinedDbAreasFeatureCollection(
  areaRows: AreaTableRow[],
  areaVisibility: Readonly<Record<string, boolean>>,
  targetRows: AreaTableTargetRow[],
  targetVisibility: Readonly<Record<string, boolean>>,
  layerMasterOn: boolean,
  style?: SituationAreaLayerStyle,
): GeoJSON.FeatureCollection {
  const areas = buildDbAreasFeatureCollection(
    areaRows,
    (row) => {
      if (!layerMasterOn) return false;
      return isDbAreaLeafVisible(row.group_id, row.area_id, areaVisibility);
    },
    style,
  );
  const asAreaRows = targetRows.filter(isDbAreaTargetListable).map(targetRowToAreaRow);
  const idByAreaId = new Map<number, string>();
  for (const t of targetRows) {
    if (isDbAreaTargetListable(t)) idByAreaId.set(t.target_id, t.id);
  }
  const targets = buildDbAreasFeatureCollection(
    asAreaRows,
    (row) => {
      if (!layerMasterOn) return false;
      const tid = idByAreaId.get(row.area_id);
      if (!tid) return false;
      return isDbAreaTargetLeafVisible(tid, targetVisibility);
    },
    style,
  );
  return {
    type: "FeatureCollection",
    features: [...areas.features, ...targets.features],
  };
}

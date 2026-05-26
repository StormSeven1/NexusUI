import { CameraManagementClient } from "@/lib/camera-management-client";
import type { CameraManagementConfig } from "@/lib/map-app-config";
import {
  ensureEntitiesTrackTaskCache,
  listHasPtzCameraEntityIds,
  listHasPtzCameraRows,
} from "@/lib/entities-track-task-cache";

export type StopAllPtzCameraTasksResult = {
  total: number;
  ok: number;
  fail: number;
  errors: string[];
};

/**
 * WatchSys `on_action_stopcamera_triggered` → `CAMERA_STOP_ALL` → `CancelAllMetaTasksTask`。
 * Web 端对实体快照中 **hasPtz=true** 的全部相机逐台下发（非硬编码 1/2/4/5）。
 */
export async function stopAllPtzCameraTasks(
  cm: CameraManagementConfig,
  opts?: { refreshEntities?: boolean },
): Promise<StopAllPtzCameraTasksResult> {
  const client = CameraManagementClient.fromConfig(cm);
  if (!client) {
    return { total: 0, ok: 0, fail: 0, errors: ["CameraManagementClient 未创建"] };
  }

  await ensureEntitiesTrackTaskCache(opts?.refreshEntities === true);

  const rows = listHasPtzCameraRows();
  const owners = listHasPtzCameraEntityIds();
  if (owners.length === 0) {
    return { total: 0, ok: 0, fail: 0, errors: [] };
  }

  const labelById = new Map(rows.map((r) => [r.entityId, r.label]));

  let ok = 0;
  let fail = 0;
  const errors: string[] = [];

  for (const entityId of owners) {
    const res = await client.cancelAllMetaTasks(entityId);
    const label = labelById.get(entityId) ?? entityId;
    if (res.ok && !res.networkError) {
      ok++;
      console.info("[stop-all-camera-tasks] 已停止", label, entityId);
    } else {
      fail++;
      const msg = res.errorMessage || res.networkError || `HTTP ${res.status}`;
      errors.push(`${label} (${entityId}): ${msg}`);
      console.warn("[stop-all-camera-tasks] 失败", label, entityId, res);
    }
  }

  return { total: owners.length, ok, fail, errors };
}

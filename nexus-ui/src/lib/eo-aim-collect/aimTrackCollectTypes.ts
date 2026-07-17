/** 开始采集 */
export const AIM_TRACK_COLLECT_TRIGGER_START = 1;
/** 结束采集 */
export const AIM_TRACK_COLLECT_TRIGGER_END = 2;
/** 态势双击航迹（手动干预点） */
export const AIM_TRACK_COLLECT_TRIGGER_MAP_DBLCLICK = 3;

/** 相机对准采集服务 TrackRequest（与后端 proto 字段对齐，JSON 驼峰） */
export interface AimTrackCollectRequest {
  cameraIndex: number;
  aimType: number;
  aimPath: string;
  triggerType: number;
  trackStatus: number;
  trackPoints: string[];
  interventionStatus: string;
  backupField: string;
}

export type AimTrackCollectBlockReason = "not_single_track" | "no_target" | "invalid_camera";

/**
 * 与 Qt `MainWindowPrivate::InitTaskStatusHttp` 中
 * `PUT /api/alarms/:alarmId/task-status` 请求体对齐。
 */
export type TaskStatusRequestBody = {
  taskStatus: number;
  taskID?: string;
  /** 上报方实体 id（`EntityId` / `entityId`），如 `camera_004`、`uav-007` */
  entityId?: string;
  /** legacy：标准光电序号；可由 `entityId` 推导，库表查图仍依赖此字段 */
  cameraIndex?: number;
  trackID?: number;
  /** 航迹唯一 ID（与 `minio_multi_metadata.unique_id`、报文 uniqueID 对齐） */
  uniqueId?: number;
  /** taskStatus 为 5/6/7 时由相机/后端填入（如模型研判结果） */
  description?: string;
  /**
   * MinIO 预签名或 HTTP 直链；与 Qt `MinioMultiMetadata::downloadUrl` 一致。
   * Body 无直链时可由服务端用库表字段 `minioBucket`/`bucket` + `minioObjectKey`/`objectKey` 与 TASK_STATUS_MINIO_* 凭证拼出。
   * 请求体也可用 `imageUrl` / `minioDownloadUrl` / `picUrl` / `snapshotUrl`，服务端会归一到此字段。
   */
  downloadUrl?: string;
  /** 可选，缺省则根据 URL 后缀推测 */
  imageMediaType?: string;
  /** 可选展示文件名 */
  imageFileName?: string;
  /** 与 Qt 查证文案「正在查证ID为 x 的目标」一致；缺省用 trackID */
  verifyTargetId?: number;
  /** 东经、北纬（度），用于「位置：东经…°，北纬…°」 */
  longitudeDeg?: number;
  latitudeDeg?: number;
  /** 海里 */
  distanceNm?: number;
  /** 方位角（度） */
  azimuthDegrees?: number;
  /** 速度 m/s */
  speedMps?: number;
  /** 船舶档案摘要；缺省展示「无」 */
  shipArchiveInfo?: string;
};

/** 推送到前端 SSE / 对话气泡 */
export type TaskStatusChatPayload = TaskStatusRequestBody & {
  alarmId: string;
  receivedAt: string;
};

# 相机 / 无人机查证上报 HTTP API

NexusUI 在 **独立 TCP 端口** 上接收相机管理、无人机检测等上游的查证状态与图片信息，与 Next 主站端口（如 3000）无关。

| 环境 | 端口 | 配置 |
|------|------|------|
| **生产** | **7775** | 部署时设置 `TASK_STATUS_HTTP_PORT=7775` |
| 开发 | 7774 | `next dev` 时 `.env.development.local` 可设为 7774，避免与生产同机冲突 |

**Base URL（生产示例）**

```
http://<NexusUI主机IP>:7775
```

将 `<NexusUI主机IP>` 换为实际部署 NexusUI 的服务器地址（如 `192.168.18.141`）。

---

## 1. 查证状态上报（主入口）

相机、无人机查证结果均使用 **同一路径**，与历史 Qt `TaskStatusHttp` 对齐。

### 1.1 基本信息

| 项 | 值 |
|----|-----|
| 路径 | `/api/alarms/{alarmId}/task-status` |
| 方法 | `PUT` 或 `POST`（等价） |
| Content-Type | `application/json; charset=utf-8` |
| 鉴权 | 可选，见 [§5](#5-鉴权可选) |

**完整 URL 示例**

```
PUT http://192.168.18.141:7775/api/alarms/ALM-20250601-001/task-status
```

`{alarmId}` 为态势系统当前处置告警 ID（字符串，需 URL 编码；含特殊字符时用 `encodeURIComponent`）。

### 1.2 请求体字段

#### 必填

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskStatus` | number | 任务状态码，见 [§1.4](#14-taskstatus-状态码) |

也接受 snake_case 别名：`task_status`（与 `taskStatus` 二选一即可）。

#### 查证过程常用（强烈建议填写）

| 字段 | 类型 | 别名 | 说明 |
|------|------|------|------|
| **`EntityId`** | string | `entityId`, `ownerEntityId`, `cameraEntityId` | **上报方实体 id**（与 entities / 任务 `owner.entityId` 一致），如 `camera_004`、`uav-007`。服务端据此识别设备、合并查证会话 |
| `taskID` | string | `task_id` | 上游任务 UUID / 业务任务号 |
| `trackID` | number | `track_id`, `trackId` | **融合航迹业务 ID**（非 showID 字符串） |
| `uniqueId` | number | `unique_id`, `uniqueID` | 航迹唯一 ID，与 WebSocket 报文、库表 `minio_multi_metadata.unique_id` 对齐 |
| `cameraIndex` | number | `camera_index`, `CameraIndex` | **可选 / legacy**。标准光电可由 `EntityId`（如 `camera_004`）自动推导为 `4`；仅带序号、不带 EntityId 时仍兼容 |

**实体识别规则（服务端）**

1. 优先读 **`EntityId`**（及别名），规范化后写入内部 `entityId`。
2. `camera_004` 等形式 → 推导 `cameraIndex=4`，用于 `minio_multi_metadata` 查图（`screenshot_0_4_%`）。
3. `uav-007` 等非 `camera_NNN` 实体 → 仅按 `entityId` 分组会话（`{trackID}_uav-007`），**不**推导 `cameraIndex`；图片请传 `downloadUrl` 或库表按实体规则写入。
4. 未带 `EntityId` 但带 `cameraIndex` → 回退为 `camera_{序号三位}`（如 `1` → `camera_001`）。

查证会话 key：**`{trackID}_{EntityId}`**（优先）或 legacy **`{trackID}_{cameraIndex}`**。

#### 图片地址（至少一种方式）

| 字段 | 类型 | 说明 |
|------|------|------|
| `downloadUrl` | string | **推荐**。MinIO 预签名 URL 或 HTTP(S) 直链 |
| `imageUrl` | string | 与 `downloadUrl` 等价别名 |
| `minioDownloadUrl` | string | 同上 |
| `picUrl` / `snapshotUrl` | string | 同上 |
| `minioBucket` / `bucket` | string | MinIO 桶名；与 `objectKey` 组合使用 |
| `minioObjectKey` / `objectKey` | string | MinIO 对象键 |

若 **未带任何图片 URL**，服务端会尝试从 PostgreSQL 表 `minio_multi_metadata` 按 `uniqueId`（优先）或 `trackID` + `cameraIndex` 查询最近截图（文件名模式 `screenshot_0_{cameraIndex}_%`）。截图写入库后约有 **2 秒** 延迟（`TASK_STATUS_METADATA_QUERY_DELAY_MS`），建议上游稍晚上报或直传 `downloadUrl`。

#### 航迹展示（可选，taskStatus=4 时用于智能助手文案）

| 字段 | 类型 | 别名 | 说明 |
|------|------|------|------|
| `verifyTargetId` | number | `verify_target_id`, `targetId`, `target_id` | 展示用目标 ID；缺省用 `trackID` |
| `longitudeDeg` | number | `longitude_deg`, `lon`, `longitude` | 东经（度） |
| `latitudeDeg` | number | `latitude_deg`, `lat`, `latitude` | 北纬（度） |
| `distanceNm` | number | `distance_nm` | 距离（海里） |
| `azimuthDegrees` | number | `azimuth_degrees`, `azimuth`, `bearing`, `course` | 方位角（度） |
| `speedMps` | number | `speed_mps` | 速度（m/s） |
| `shipArchiveInfo` | string | `ship_archive_info`, `aisInfo`, `ais_info` | 船舶档案摘要；缺省展示「无」 |

#### 研判 / 来访文本（taskStatus 为 5 / 6 / 7 / 8 时）

| 字段 | 类型 | 说明 |
|------|------|------|
| `description` | string | 大模型研判结论、MinIO 分片、知识库来访记录等 |

#### 图片元数据（可选）

| 字段 | 类型 | 说明 |
|------|------|------|
| `imageMediaType` | string | 如 `image/jpeg` |
| `imageFileName` / `fileName` | string | 展示文件名 |

### 1.3 请求示例

#### 相机 — 开始查证（taskStatus = 4）

```bash
curl -sS -X PUT "http://192.168.18.141:7775/api/alarms/ALM-20250601-001/task-status" \
  -H "Content-Type: application/json" \
  -d '{
    "taskStatus": 4,
    "taskID": "cam-verify-uuid-001",
    "EntityId": "camera_004",
    "trackID": 12345,
    "uniqueId": 67890,
    "longitudeDeg": 122.0890,
    "latitudeDeg": 37.5450,
    "distanceNm": 2.5,
    "azimuthDegrees": 135.0,
    "speedMps": 5.2,
    "shipArchiveInfo": "目标类型：货船；船长：120m",
    "downloadUrl": "http://192.168.18.141:9900/verify-bucket/screenshot_0_1_20250601.jpg"
  }'
```

#### 相机 — 研判结果（taskStatus = 5）

```bash
curl -sS -X PUT "http://192.168.18.141:7775/api/alarms/ALM-20250601-001/task-status" \
  -H "Content-Type: application/json" \
  -d '{
    "taskStatus": 5,
    "taskID": "cam-verify-uuid-001",
    "EntityId": "camera_004",
    "trackID": 12345,
    "description": "研判：疑似渔船，置信度 0.92，建议继续跟踪"
  }'
```

#### 无人机 — 开始查证（字段与相机相同）

```bash
curl -sS -X POST "http://192.168.18.141:7775/api/alarms/ALM-20250601-002/task-status" \
  -H "Content-Type: application/json" \
  -d '{
    "taskStatus": 4,
    "taskID": "uav-verify-001",
    "EntityId": "uav-007",
    "trackID": 23456,
    "uniqueId": 78901,
    "downloadUrl": "http://192.168.18.141:9900/verify-bucket/uav/snap_001.jpg",
    "longitudeDeg": 122.10,
    "latitudeDeg": 37.55
  }'
```

> **说明**：无人机务必带 **`EntityId`**（与 8090 实体列表一致）。无需再填 `cameraIndex`；图片建议直传 `downloadUrl`。

#### 仅 MinIO 桶 + 键（无直链）

```bash
curl -sS -X PUT "http://192.168.18.141:7775/api/alarms/ALM-20250601-001/task-status" \
  -H "Content-Type: application/json" \
  -d '{
    "taskStatus": 4,
    "trackID": 12345,
    "cameraIndex": 1,
    "bucket": "verify-images",
    "objectKey": "2025/06/01/track_12345.jpg"
  }'
```

### 1.4 taskStatus 状态码

| 值 | 响应字符串 | 含义 | 典型场景 |
|----|------------|------|----------|
| 0 | PENDING | 待处理 | 任务排队 |
| 1 | COMPLETED | 已完成 | 查证流程结束 |
| 2 | FAILED | 失败 | 查证失败 |
| **4** | **VERIFYING** | **查证中** | 开始查证；推送航迹信息 + 首图 |
| **5** | **MODEL_REPLY** | **研判结果** | 大模型 / 人工研判文本（`description`） |
| 6 | EXT_6 | 扩展状态 6 | 需 `description` |
| 7 | EXT_7 | 扩展状态 7 | MinIO 路径分片等 |
| **8** | **KB_VISIT** | **来访记录** | 知识库 `user_context.image_urls` 查询结果（`description`） |

**推荐上报顺序（一次完整查证）**

1. `taskStatus: 4` — 带 `trackID`、`cameraIndex`、图片 URL 或库表可查的截图  
2. `taskStatus: 5` — 带 `description` 研判结论  
3. `taskStatus: 8` — （可选）知识库来访记录 `description`  
4. （可选）`taskStatus: 1` — 流程结束  

### 1.5 成功响应

**HTTP 200**

```json
{
  "code": 200,
  "message": "修改任务状态成功",
  "data": {
    "alarmId": "ALM-20250601-001",
    "taskStatus": "VERIFYING",
    "updateTime": "2026-06-01 14:30:00"
  }
}
```

`data.taskStatus` 为英文字符串枚举；`updateTime` 为服务器本地时间（`zh-CN`，24 小时制）。

### 1.6 错误响应

| HTTP | code | message 示例 | 原因 |
|------|------|--------------|------|
| 400 | 400 | 缺少taskStatus字段 | 未传 `taskStatus` |
| 400 | 400 | taskStatus 无效 | 非数字 |
| 400 | 400 | 请求体必须是JSON对象 | Body 非 JSON 对象 |
| 400 | 400 | JSON格式不正确 | JSON 解析失败 |
| 400 | 400 | invalid alarmId | 路径中 alarmId 为空 |
| 401 | 401 | unauthorized | 配置了密钥但未携带 Header |
| 404 | 404 | 请求的资源不存在 | 路径错误（非 `/api/alarms/.../task-status`） |
| 405 | 405 | Method Not Allowed | 使用了 GET 等不支持的方法 |

错误体统一形如：

```json
{
  "code": 400,
  "message": "缺少taskStatus字段",
  "data": null
}
```

### 1.7 上游处理说明

- 服务端收到合法请求后，通过 **SSE** 推送到 NexusUI 前端（智能助手查证会话、告警关联展示等）。
- 若配置了 MinIO 与 PostgreSQL，会自动解析图片 URL（预签名 / 同源代理 `/api/task-status-image-proxy`）。
- **地图航迹挂图**不经过本端口：前端另向 Custombackend 轮询 `GET /api/image/{uniqueID}`（见 [§6](#6-相关接口非本端口)）。

---

## 2. 系统工作模式（同端口扩展）

与查证回调 **共用 7775 端口**，供上游查询 / 切换系统模式（可选集成）。

### 2.1 查询

```http
GET /api/system/status HTTP/1.1
Host: 192.168.18.141:7775
```

```bash
curl -sS "http://192.168.18.141:7775/api/system/status"
```

**成功响应（200）**

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "work_mode": "normal",
    "work_mode_enum": 2,
    "dds_work_mode_enabled": true
  },
  "server_time": "2026-06-01T06:00:00.000Z"
}
```

| work_mode | work_mode_enum |
|-----------|----------------|
| emergency | 0 |
| debug | 1 |
| normal | 2 |
| wartime | 3 |

### 2.2 设置

```http
PUT /api/system/status HTTP/1.1
Content-Type: application/json

{"work_mode":"wartime"}
```

也支持字段 `mode`。若配置了 `TASK_STATUS_INGEST_SECRET`，PUT/POST 需带鉴权 Header（GET 不需要）。

更多示例见同目录 [`http-system-status-examples.md`](./http-system-status-examples.md)（将文中端口 7774 换为 **7775** 即可）。

---

## 3. CORS 与 OPTIONS

服务端对查证路径支持跨域预检：

```http
OPTIONS /api/alarms/{alarmId}/task-status
```

响应含 `Access-Control-Allow-Origin`（默认 `*`，可通过 `TASK_STATUS_CORS_ORIGIN` 限制）。

---

## 4. 相机 vs 无人机差异

| 项目 | 相机 | 无人机 |
|------|------|--------|
| 上报路径 | 相同 | 相同 |
| **实体标识** | **`EntityId`: `camera_004` 等** | **`EntityId`: `uav-007` 等** |
| `cameraIndex` | 可由 `camera_NNN` 自动推导；legacy 可只报数字 | 一般**不需要**；无法从 `uav-*` 推导 |
| 图片 `modal`（库表） | 建议 `0`（Camera） | 建议 `1`（UAV） |
| 历史 Qt 专用路径 | — | `/api/uav/takephoto`、`/api/uav/expel/{id}` **当前 NexusUI 未实现**；上报查证请仅用 `task-status` |

---

## 5. 鉴权（可选）

环境变量 **`TASK_STATUS_INGEST_SECRET`** 非空时，**查证上报**与 **系统模式 PUT/POST** 须携带以下 Header 之一：

```http
X-Task-Status-Secret: <密钥>
```

或

```http
Authorization: Bearer <密钥>
```

示例：

```bash
curl -sS -X PUT "http://192.168.18.141:7775/api/alarms/ALM-001/task-status" \
  -H "Content-Type: application/json" \
  -H "X-Task-Status-Secret: your-secret" \
  -d '{"taskStatus":4,"trackID":12345,"cameraIndex":1}'
```

未配置该环境变量时，**不校验** Header。

---

## 6. 相关接口（非本端口）

本 API **只负责上报**；以下能力在其它服务，供联调参考：

| 能力 | 方法 | 地址 | 说明 |
|------|------|------|------|
| 地图查证挂图 | GET | `http://<Custombackend>:27004/api/image/{uniqueID}` | 返回 base64 标注图；查 `minio_multi_metadata` |
| 处置结束 / 告警过滤 | POST | `http://<AlarmSys>:8019/api/alarm_filter` | 与查证上报无关 |
| 下发相机跟踪任务 | POST | `http://<相机管理>:8088/api/v1/tasks` | 任务下发，非回调 |

Custombackend 地址以 `app-config.json` 中 `http.backendUrl` 为准。

---

## 7. 联调检查清单

1. NexusUI 进程已启动，且 `TASK_STATUS_HTTP_PORT=7775` 监听成功（日志含 `[task-status] 查证回调 HTTP 已监听 0.0.0.0:7775`）。
2. 防火墙放行 **7775/TCP**。
3. `{alarmId}` 与当前告警列表中的 ID 一致。
4. **`EntityId` 与 entities / 下发任务时的 `owner.entityId` 一致**；`trackID` 为业务航迹 ID，地图匹配常用 `uniqueId`。
5. 图片：优先传 `downloadUrl`；光电若走库表，须 `camera_004` 等可推导 `cameraIndex` 且文件名符合 `screenshot_0_{index}_%`。
6. 生产与开发同机部署时，开发用 **7774**、生产用 **7775**，避免端口冲突。

---

## 8. 实现参考（维护人员）

| 模块 | 路径 |
|------|------|
| 独立端口 HTTP 服务 | `src/server/task-status-http-listener.ts` |
| 请求解析与 MinIO/库表 | `src/lib/task-status-ingest-handler.ts` |
| EntityId 解析 / 会话 key | `src/lib/task-status-verify-entity-ref.ts` |
| 类型定义 | `src/lib/task-status-types.ts` |
| Next 同源路由 | `src/app/api/alarms/[alarmId]/task-status/route.ts` |
| 环境变量说明 | `.env.local`、`.env.example` 中 `TASK_STATUS_*` |

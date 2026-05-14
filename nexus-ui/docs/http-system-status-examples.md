# 系统状态 HTTP 调用示例（端口 7774）

独立监听端口由环境变量 **`TASK_STATUS_HTTP_PORT`** 指定（默认 **7774**），与 Next 主端口无关。路径前缀：`/api/system/status`。

后端实际读写仍由 Custombackend 完成；本服务通过 **`BACKEND_URL`**（默认 `http://127.0.0.1:27003`）转发。

---

## 1. 查询当前系统工作模式

**请求**

```http
GET /api/system/status HTTP/1.1
Host: <运行 NexusUI 的主机>:7774
```

**curl**

```bash
curl -sS "http://127.0.0.1:7774/api/system/status"
```

局域网其它机器将 `127.0.0.1` 换成 NexusUI 所在主机 IP。

**成功响应示例（200）**

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "work_mode": "wartime",
    "work_mode_enum": 3,
    "dds_work_mode_enabled": true
  },
  "server_time": "2026-05-11T12:00:00.000Z"
}
```

**枚举对照**

| work_mode   | work_mode_enum |
|-------------|----------------|
| emergency   | 0              |
| debug       | 1              |
| normal      | 2              |
| wartime     | 3              |

若尚未成功发布过 DDS，`work_mode` / `work_mode_enum` 可能为 `null`。

---

## 2. 设置系统工作模式

**请求**

```http
PUT /api/system/status HTTP/1.1
Host: <主机>:7774
Content-Type: application/json

{"work_mode":"normal"}
```

也支持字段 **`mode`**（与 Custombackend 一致）：

```json
{"mode":"wartime"}
```

**curl（无密钥）**

```bash
curl -sS -X PUT "http://127.0.0.1:7774/api/system/status" \
  -H "Content-Type: application/json" \
  -d '{"work_mode":"normal"}'
```

**curl（POST，等价）**

```bash
curl -sS -X POST "http://127.0.0.1:7774/api/system/status" \
  -H "Content-Type: application/json" \
  -d '{"work_mode":"wartime"}'
```

### 配置了 `TASK_STATUS_INGEST_SECRET` 时

需在 Header 携带密钥（任选一种）：

```bash
curl -sS -X PUT "http://127.0.0.1:7774/api/system/status" \
  -H "Content-Type: application/json" \
  -H "X-Task-Status-Secret: <你的密钥>" \
  -d '{"work_mode":"debug"}'
```

```bash
curl -sS -X PUT "http://127.0.0.1:7774/api/system/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的密钥>" \
  -d '{"work_mode":"emergency"}'
```

**成功响应示例（200）**

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "work_mode": "normal",
    "work_mode_enum": 2
  },
  "server_time": "2026-05-11T12:00:00.000Z"
}
```

---

## 3. 常见错误

| 情况           | HTTP | 说明 |
|----------------|------|------|
| 无法连上 Custombackend | 503 | 检查 `BACKEND_URL`、防火墙及后端是否监听 |
| 未授权（写了密钥但未带 Header） | 401 | 仅 **PUT/POST** 受影响；**GET** 不要求密钥 |
| 非法 `work_mode` | 400 | 只能是 `emergency`、`debug`、`normal`、`wartime` |

---

## 4. 与查证回调共用端口

同端口仍存在相机查证路径（不变）：

`PUT|POST /api/alarms/<告警ID>/task-status`

详见项目内 `task-status-http-listener` 与 `.env.local` 中 `TASK_STATUS_*` 说明。

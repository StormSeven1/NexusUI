# 航迹数据中继服务 (Track Relay Service)

精简的航迹数据接收和转发服务，支持多种数据源接入，统一格式后通过WebSocket批量广播。

## 功能特性

- **多数据源支持**：UDP组播/单播/广播、TCP客户端、MQTT、DDS、HTTP轮询
- **统一航迹格式**：自动解析并转换为标准航迹格式
- **WebSocket广播**：批量发送航迹数据，支持心跳保活
- **HTTP API**：提供REST接口查询状态和区域数据
- **数据库查询**：连接后自动发送区域表数据

## 目录结构

```
track_relay/
├── config.py           # 配置文件（数据源配置）
├── main.py             # 主程序入口
├── database.py         # 数据库管理（仅查询）
├── websocket_manager.py # WebSocket管理
├── receiver_manager.py # 接收器管理
├── track_parser.py     # 航迹数据解析
├── http_api.py         # HTTP API接口
├── receivers/          # 数据接收器
│   ├── udp_receiver.py
│   ├── tcp_client.py
│   ├── mqtt_receiver.py
│   ├── dds_receiver.py
│   └── http_poller.py
├── logs/               # 日志目录
└── requirements.txt    # 依赖
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 修改配置

编辑 `config.py`，配置：
- 服务器地址和端口
- 数据库连接信息
- UDP/TCP/MQTT/DDS/HTTP数据源

### 3. 启动服务

```bash
python main.py
```

## 配置说明

### 服务配置

```python
HOST = "0.0.0.0"          # 监听地址
PORT = 5000               # HTTP/WebSocket端口
LOCAL_INTERFACE = "192.168.18.141"  # 本机IP（组播需要）
```

### UDP接收器配置

```python
UDP_RECEIVERS = [
    {
        "id": "ais_multicast",
        "name": "AIS组播",
        "type": "multicast",  # multicast/unicast/broadcast
        "host": "239.192.50.81",
        "port": 5081,
        "enabled": True,
        "data_format": "AIS"
    },
]
```

### TCP客户端配置

```python
TCP_CLIENTS = [
    {
        "id": "tcp_client_1",
        "host": "192.168.18.100",
        "port": 4377,
        "enabled": False,
        "data_format": "FusionTrack",
        "reconnect_interval": 5
    },
]
```

### MQTT配置

```python
MQTT_CONFIG = {
    "enabled": False,
    "broker": "192.168.18.141",
    "port": 1883,
    "username": "admin",
    "password": "admin",
    "topics": [
        {"topic": "drone/+/telemetry", "data_format": "DroneTelemetry"},
    ]
}
```

## API接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/test` | GET | 测试接口 |
| `/api/health` | GET | 健康检查 |
| `/api/areas` | GET | 获取区域数据 |
| `/api/status` | GET | 获取服务状态 |

## WebSocket

连接地址：`ws://{HOST}:{PORT}/ws`

### 消息格式

**航迹批量数据**：
```json
{
    "type": "trackBatch",
    "timestamp": "2025-01-04T09:00:00",
    "data": [
        {
            "type": "Track",
            "data": {
                "track_id": "12345",
                "latitude": 39.9,
                "longitude": 116.4,
                "altitude": 100,
                "speed": 10.5,
                "course": 45.0,
                "timestamp": "2025-01-04T09:00:00",
                "source": "ais_multicast",
                "target_type": "AIS"
            }
        }
    ]
}
```

**区域数据**（连接后自动发送）：
```json
{
    "type": "AreaData",
    "timestamp": "2025-01-04T09:00:00",
    "data": [...]
}
```

**心跳**：
```json
{"type": "heartbeat", "data": {"message": "ping"}}
```

## 数据格式支持

- `FusionTrack` - 融合航迹
- `AIS` - AIS数据
- `JSON` - 通用JSON
- `DroneTelemetry` - 无人机遥测

## 日志

日志文件位于 `logs/` 目录，按天自动轮转，保留7天。

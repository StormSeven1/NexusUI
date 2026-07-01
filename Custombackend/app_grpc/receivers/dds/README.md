# DDS (Data Distribution Service) 模块

本模块提供了基于FastDDS的航迹数据接收和发送功能，**完全保留了ddsdemo中TrackSubscriber和TrackPublisher的原有逻辑**，仅添加了动态配置支持。

---

## 📌 目录

- [概述](#概述)
- [文件结构](#文件结构)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [代码示例](#代码示例)
- [数据流程](#数据流程)
- [API参考](#api参考)
- [故障排查](#故障排查)
- [注意事项](#注意事项)

---

## 概述

### 集成状态

- ✅ **状态**: 已完成并可用
- ✅ **兼容性**: 100%保留原有TrackSubscriber和TrackPublisher逻辑
- ✅ **集成日期**: 2024-12-10

### 核心特性

1. **完全保留原有逻辑**: TrackSubscriber和TrackPublisher的核心代码100%未修改
2. **动态配置**: 所有参数可通过配置文件设置
3. **自动XML生成**: 无需手动创建XML配置文件
4. **无缝集成**: 与UDP/TCP接收器统一管理
5. **线程安全**: 每个DDS接收器运行在独立线程中

### 关键改动

#### dds_receiver.py vs TrackSubscriber.py

**完全保留**:
- ✅ `TrackReaderListener` 类逻辑
- ✅ `on_subscription_matched` 方法
- ✅ `on_data_available` 方法核心逻辑
- ✅ DDS初始化流程
- ✅ `delete` 资源清理方法
- ✅ `DESCRIPTION` 和 `USAGE` 常量

**新增功能**:
- ✅ 构造函数支持动态配置参数
- ✅ 自动生成XML配置文件
- ✅ 数据回调机制
- ✅ 异常处理和日志记录

---

## 目录结构

```
app/dds/
├── __init__.py                    # 模块初始化
├── dds_receiver.py                # DDS接收器（基于TrackSubscriber）
├── dds_publisher.py               # DDS发布器（基于TrackPublisher）
├── xml_config_generator.py        # XML配置文件生成器
├── TrackRealTimeStatus.py         # DDS数据类型定义（自动生成）
├── TrackRealTimeStatus*.hpp/cxx   # DDS支持文件
└── README.md                      # 本文档
```

## 功能特性

### 1. DDS接收器 (DDSReceiver)

- ✅ 支持动态配置（域ID、主题名、发现服务器等）
- ✅ 自动生成XML配置文件
- ✅ 数据回调机制
- ✅ 完整保留TrackSubscriber原有逻辑
- ✅ 线程安全

### 2. DDS发布器 (DDSPublisher)

- ✅ 支持动态配置
- ✅ 自动生成XML配置文件
- ✅ 支持发送完整航迹数据
- ✅ 完整保留TrackPublisher原有逻辑
- ✅ 订阅者发现机制

### 3. XML配置生成器 (DDSXMLConfigGenerator)

- ✅ 动态生成订阅者配置
- ✅ 动态生成发布者配置
- ✅ 支持自定义IP和端口

## 配置说明

### 数据源配置 (dataSources)

在 `default_process_config.json` 中配置DDS数据源：

```json
{
  "id": "dui_hai_rong_he",
  "name": "对海融合",
  "host": "239.128.43.96",
  "port": 4397,
  "data_format": "DDS",
  "databaseType": 5,
  "network_protocol": "dds",
  "timeout": 30,
  "type": "input",
  "dds_config": {
    "domain_id": 142,
    "topic_name": "TrackDataClassTopic_FuseTrack",
    "profile_name": "track_subscriber_dui_hai",
    "discovery_server_ip": "192.168.18.141",
    "discovery_server_port": 11611,
    "multicast_ip": "239.255.0.1",
    "multicast_port": 12359
  }
}
```

### 转发配置 (forwardRules)

在 `default_process_config.json` 中配置DDS转发：

```json
{
  "reid_duihai": {
    "description": "ReID对海融合",
    "inputIds": ["dui_hai_rong_he"],
    "forwardingTargets": [
      {
        "host": "127.0.0.1",
        "port": 9090,
        "network_protocol": "dds",
        "data_format": "DDS",
        "enabled": true,
        "description": "ReID转发，以DDS格式发送融合航迹",
        "dds_config": {
          "domain_id": 142,
          "topic_name": "TrackDataClassTopic_ReIDForward",
          "profile_name": "track_publisher_reid_forward",
          "discovery_server_ip": "192.168.18.141",
          "discovery_server_port": 11611,
          "multicast_ip": "239.255.0.1",
          "multicast_port": 12359
        }
      }
    ]
  }
}
```

### 配置参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `domain_id` | DDS域ID | 142 |
| `topic_name` | DDS主题名称 | TrackDataClassTopic_FuseTrack |
| `profile_name` | XML配置文件中的profile名称 | track_subscriber_client |
| `discovery_server_ip` | 发现服务器IP地址 | 192.168.18.141 |
| `discovery_server_port` | 发现服务器端口 | 11611 |
| `multicast_ip` | 组播IP地址 | 239.255.0.1 |
| `multicast_port` | 组播端口 | 12359 |

## 使用示例

### 1. 接收器示例

```python
from app.dds.dds_receiver import DDSReceiver

# 定义数据回调函数
def on_data_received(data: dict):
    print(f"接收到航迹: trackId={data.get('trackId')}")

# 创建接收器
receiver = DDSReceiver(
    domain_id=142,
    topic_name="TrackDataClassTopic_FuseTrack",
    profile_name="track_subscriber_test",
    discovery_server_ip="192.168.18.141",
    discovery_server_port=11611,
    multicast_ip="239.255.0.1",
    multicast_port=12359,
    data_callback=on_data_received
)

# 接收器会自动在后台运行
# 使用完毕后清理资源
receiver.delete()
```

### 2. 发布器示例

```python
from app.dds.dds_publisher import DDSPublisher

# 创建发布器
publisher = DDSPublisher(
    domain_id=142,
    topic_name="TrackDataClassTopic_FuseTrack",
    profile_name="track_publisher_test",
    discovery_server_ip="192.168.18.141",
    discovery_server_port=11611,
    multicast_ip="239.255.0.1",
    multicast_port=12359
)

# 等待发现订阅者
publisher.wait_discovery(timeout=10.0)

# 发送数据
track_data = {
    'trackId': 1001,
    'longitude': 116.391,
    'latitude': 39.907,
    'speed': 10.0,
    # ... 其他字段
}
publisher.write(track_data)

# 使用完毕后清理资源
publisher.delete()
```

## 测试

### 运行接收器测试

```bash
# 使用配置参数测试
python test_dds_receiver.py

# 使用默认配置测试
python test_dds_receiver.py simple
```

### 运行发布器测试

```bash
# 使用配置参数测试
python test_dds_publisher.py

# 使用默认配置测试
python test_dds_publisher.py simple
```

## 集成到系统

DDS接收器已集成到 `TrackReceiverManager` 中，系统启动时会自动根据配置文件创建DDS接收器。

### 自动启动流程

1. 系统读取 `default_process_config.json`
2. 识别 `network_protocol: "dds"` 的数据源
3. 提取 `dds_config` 配置
4. 创建DDS接收器并在独立线程中运行
5. 接收到的数据自动入库并转发

### 数据流程

```
DDS发布者 → DDS接收器 → 数据解析 → 入库 → WebSocket推送 → 前端显示
                                    ↓
                                  转发器 → DDS发布器 → 下游系统
```

## 依赖项

- **FastDDS**: eProsima Fast DDS库
- **Python绑定**: fastdds Python包

### 安装FastDDS

请参考官方文档安装FastDDS及其Python绑定：
https://fast-dds.docs.eprosima.com/

## 注意事项

1. **XML配置文件**: 系统会自动在临时目录生成XML配置文件，无需手动创建
2. **线程安全**: 所有DDS操作都在独立线程中运行，不会阻塞主线程
3. **资源清理**: 系统关闭时会自动清理所有DDS资源
4. **错误处理**: 如果FastDDS库未安装，系统会优雅降级，不影响其他功能

## 数据结构

DDS使用 `TrackDataClass` 数据类型，包含以下字段：

- `trackId`: 航迹ID
- `mmsi`: MMSI号
- `uniqueId`: 唯一ID
- `longitude`: 经度
- `latitude`: 纬度
- `course`: 航向
- `speed`: 速度
- `height`: 高度
- `azimuth`: 方位角
- `range`: 距离
- 更多字段请参考 `TrackRealTimeStatus.idl`

## 故障排查

### 问题1: FastDDS库未安装

**症状**: 启动时提示 "FastDDS库未安装"

**解决**: 安装FastDDS及其Python绑定

### 问题2: 无法发现订阅者/发布者

**症状**: 发布器或订阅器无法匹配

**解决**: 
- 检查网络连接
- 确认发现服务器IP和端口正确
- 确认域ID和主题名称一致

### 问题3: XML配置文件错误

**症状**: 启动时提示XML配置错误

**解决**: 检查配置文件中的IP和端口参数是否正确

## 更新日志

- **2024-12-10**: 初始版本，集成DDS接收和发送功能

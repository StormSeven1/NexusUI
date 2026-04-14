# NexusUI 工具体系架构文档

> 最后更新：2026-04-14

## 概述

NexusUI 采用 **LLM Function Calling** 机制实现 AI Agent 与系统的交互。用户用自然语言下达指令，LLM 自主选择并调用工具，工具在后端执行业务逻辑，返回结果后前端进行 UI 渲染或副作用操作。

## 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  用户输入（自然语言）                                               │
└──────────┬───────────────────────────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  LLM（OpenAI 兼容 API）                                          │
│  ┌─────────────────────────────────┐                             │
│  │  System Prompt（llm.py）         │  包含能力描述、决策框架、     │
│  │  + tools.yaml → OpenAI Schema   │  空间推理规则、操作示例       │
│  └─────────────────────────────────┘                             │
│  根据 tools.yaml 中的工具定义，决定调用哪个工具、传什么参数          │
└──────────┬───────────────────────────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  后端工具执行层                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ToolRegistry（tool_registry.py）                            │ │
│  │  - 加载 tools.yaml 生成 OpenAI function schema              │ │
│  │  - @registry.handler("工具名") 将 handler 函数注册到路由表    │ │
│  │  - dispatch(tool_name, args) → dict 执行并返回结果           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Tool Handlers（tool_handlers/*.py）                         │ │
│  │  每个文件实现一组相关工具的业务逻辑                              │ │
│  │  访问 DB (SQLAlchemy)、SimulationEngine、外部 API 等          │ │
│  │  返回 dict，必须包含 action 字段供前端路由                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────┬───────────────────────────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  前端处理层（两条并行路径）                                         │
│                                                                  │
│  路径 A: tool-bridge.ts（UI 副作用）                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  根据 action 字段执行：                                       │ │
│  │  - 地图飞行 / 选中目标 / 高亮                                  │ │
│  │  - 操作 Zustand store（资产刷新、面板切换等）                   │ │
│  │  - 添加地图标绘（路线、区域）                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  路径 B: ChatMessage.tsx（卡片渲染）                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  根据 action 字段渲染专属组件：                                 │ │
│  │  - show_chart      → ChartCard（柱状图/饼图）                 │ │
│  │  - show_weather     → WeatherCard（天气信息）                  │ │
│  │  - show_threats     → ThreatCard（威胁评估）                   │ │
│  │  - show_task        → TaskCard（任务进度）                     │ │
│  │  - show_sensor_feed → SurveillanceFeedCard（传感器画面）       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  注意：两条路径不互斥，同一个工具可以同时触发副作用 + 卡片渲染        │
└──────────────────────────────────────────────────────────────────┘
```

## 添加新工具的标准流程

### 第 1 步：声明工具（`config/tools.yaml`）

定义工具的名称、描述、参数 Schema。LLM 依据此文件决定何时调用该工具。

```yaml
- name: my_new_tool
  description: "工具的功能描述，LLM 据此判断何时调用"
  enabled: true
  parameters:
    type: object
    properties:
      param1:
        type: string
        description: "参数说明"
    required: ["param1"]
```

### 第 2 步：实现后端逻辑（`tool_handlers/xxx_tools.py`）

用 `@registry.handler` 装饰器注册 handler 函数，在 `__init__.py` 中导入模块。

```python
from app.services.tool_registry import registry

@registry.handler("my_new_tool")
def handle_my_new_tool(args: dict[str, Any]) -> dict[str, Any]:
    # 业务逻辑：查询 DB、调用 SimulationEngine、计算等
    result = do_something(args["param1"])
    return {
        "action": "show_my_result",  # 前端路由 key
        "success": True,
        "data": result,
        "message": "操作完成",
    }
```

**返回值约定**：
- `action`：必须字段，前端根据此值路由到对应的处理逻辑
- `success`：布尔值，标识操作是否成功
- `message`：人类可读的操作结果描述
- 其余字段为工具特定的数据

### 第 3 步：前端处理

#### 3a. UI 副作用（`src/lib/tool-bridge.ts`）

如果工具需要操作地图、刷新 store 等：

```typescript
const sideEffects: Record<string, (output: ToolOutput) => void> = {
  // ...
  show_my_result: (output) => {
    if (!output.success) return;
    useAppStore.getState().doSomething(output.data);
  },
};
```

#### 3b. 卡片渲染（`src/components/chat/ChatMessage.tsx`）

如果工具需要在聊天中渲染富媒体卡片：

1. 在 `TOOL_META` 中添加图标和标签：
```typescript
const TOOL_META = {
  my_new_tool: { icon: SomeIcon, label: "工具名称", color: "text-sky-400" },
};
```

2. 在 `ToolCallCard` 中添加渲染分支：
```typescript
if (isDone && output?.action === "show_my_result" && output.data) {
  return <MyResultCard data={output.data} />;
}
```

3. 创建对应的 Card 组件（`src/components/chat/MyResultCard.tsx`）。

### 第 4 步（可选）：更新 System Prompt

在 `llm.py` 的 `_SYSTEM_PROMPT_TEMPLATE` 中添加新工具的能力描述和使用示例，帮助 LLM 正确决策何时调用。

---

## 全部工具清单

### 🗺️ 地图操作（6 个）

前端处理方式：`tool-bridge.ts` → UI 副作用

| 工具名 | 后端文件 | action | 前端副作用 |
|---|---|---|---|
| `navigate_to_location` | `map_tools.py` | `navigate_to_location` | 地图飞行到坐标 |
| `select_track` | `track_tools.py` | `select_track` | 选中目标 + 地图飞行 |
| `switch_map_mode` | `map_tools.py` | `switch_map_mode` | 切换 2D/3D 视图 |
| `open_panel` | `map_tools.py` | `open_panel` | 打开指定面板 |
| `highlight_tracks` | `track_tools.py` | `highlight_tracks` | 高亮指定目标 |
| `fly_to_track` | `track_tools.py` | `fly_to_track` | 选中 + 飞行到目标位置 |

### 📑 标绘与测量（4 个）

前端处理方式：`tool-bridge.ts` → 地图标绘操作

| 工具名 | 后端文件 | action | 前端副作用 |
|---|---|---|---|
| `draw_route` | `route_tools.py` | `draw_route` | 在地图上画路线 |
| `draw_area` | `map_tools.py` | `draw_area` | 在地图上画多边形区域 |
| `plan_route` | `route_tools.py` | `draw_route` | 智能航路规划 → 画路线 |
| `clear_annotations` | `map_tools.py` | `clear_annotations` | 清除所有标绘 |

### 📊 数据查询与图表（5 个）

| 工具名 | 后端文件 | action | 前端渲染 |
|---|---|---|---|
| `query_tracks` | `track_tools.py` | — | 纯数据，LLM 文字总结 |
| `query_data_chart` | `chart_tools.py` | `show_chart` | **ChartCard**（柱状图/饼图） |
| `get_weather` | `weather_tools.py` | `show_weather` | **WeatherCard**（天气卡片） |
| `query_map_context` | `map_tools.py` | — | 纯数据，供 LLM 空间推理 |
| `measure_distance` | `map_tools.py` | — | 纯数据，LLM 回复距离 |

### ⚔️ 威胁评估（1 个）

前端处理方式：`tool-bridge.ts` 高亮 + `ChatMessage.tsx` 渲染卡片（**双路径**）

| 工具名 | 后端文件 | action | 前端渲染 |
|---|---|---|---|
| `assess_threats` | `threat_tools.py` | `show_threats` | **ThreatCard** + 高亮高危目标 |

### 🚁 资产管理（4 个）

| 工具名 | 后端文件 | action | 前端副作用 |
|---|---|---|---|
| `query_assets` | `asset_tools.py` | — | 纯数据，供 LLM 查询 |
| `assign_asset` | `assignment_tools.py` | `assign_asset` | 刷新资产 store + 战术通知 |
| `recall_asset` | `assignment_tools.py` | `recall_asset` | 刷新资产 store |
| `command_asset` | `command_tools.py` | `command_asset` | 刷新资产 store |

### 📋 任务管理（3 个）

前端处理方式：`ChatMessage.tsx` → 卡片渲染

| 工具名 | 后端文件 | action | 前端渲染 |
|---|---|---|---|
| `create_task` | `task_tools.py` | `show_task` | **TaskCard**（进度条/步骤列表） |
| `update_task` | `task_tools.py` | `show_task` | **TaskCard** |
| `get_task_status` | `task_tools.py` | `show_task` | **TaskCard** |

### 📹 传感器画面（1 个）

前端处理方式：`ChatMessage.tsx` → 卡片渲染

| 工具名 | 后端文件 | action | 前端渲染 |
|---|---|---|---|
| `get_sensor_feed` | `sensor_tools.py` | `show_sensor_feed` | **SurveillanceFeedCard** |

SurveillanceFeedCard 支持三种画面类型：

| feedType | 画面内容 | 渲染方式 |
|---|---|---|
| `video` | 相机/无人机视频画面：天空海面场景、飞机/舰船/潜艇轮廓、锁定框 HUD | Canvas 动画模拟（可扩展为真实视频流） |
| `sonar` | 声呐探测：圆形扫描、接触点标记、音频波形 | Canvas 动画模拟 |
| `radar` | 雷达扫描：PPI 圆形雷达、旋转扫描线、光点衰减 | Canvas 动画模拟 |

---

## 关键文件索引

### 后端（`nexus-backend/`）

```
config/tools.yaml                          # 工具声明（名称/描述/参数 Schema）
app/services/tool_registry.py              # 工具注册中心（加载 YAML + handler 路由）
app/services/llm.py                        # LLM 客户端 + System Prompt + 工具循环
app/services/tool_handlers/
  ├── __init__.py                          # 导入所有 handler 模块触发注册
  ├── _geo.py                              # 地理计算辅助（haversine 等）
  ├── map_tools.py                         # 地图导航/面板/标绘/测距/上下文查询
  ├── track_tools.py                       # 目标查询/选中/高亮/飞行
  ├── chart_tools.py                       # 数据统计图表
  ├── weather_tools.py                     # 天气查询
  ├── route_tools.py                       # 路线绘制/航路规划
  ├── asset_tools.py                       # 资产查询
  ├── threat_tools.py                      # 威胁评估
  ├── assignment_tools.py                  # 资产分配/召回
  ├── command_tools.py                     # 资产指令（移动/瞄准/巡逻）
  ├── task_tools.py                        # 任务创建/更新/查询
  └── sensor_tools.py                      # 传感器画面（视频/声呐/雷达）
```

### 前端（`nexus-ui/src/`）

```
lib/tool-bridge.ts                         # 工具副作用路由（地图操作/store 刷新）
components/chat/
  ├── ChatMessage.tsx                      # 消息渲染 + 工具卡片路由（TOOL_META + ToolCallCard）
  ├── ChartCard.tsx                        # 柱状图/饼图渲染（Recharts）
  ├── WeatherCard.tsx                      # 天气信息卡片
  ├── ThreatCard.tsx                       # 威胁评估卡片
  ├── TaskCard.tsx                         # 任务进度卡片
  └── SurveillanceFeedCard.tsx             # 传感器画面卡片（Canvas 动画）
```

---

## 扩展：对接真实传感器设备

当前所有传感器画面为 Canvas 动画模拟。对接真实设备时只需两处改动：

### 后端：返回真实流地址

```python
# sensor_tools.py — handle_get_sensor_feed 中
feed = {
    "feedType": "video",
    "streamUrl": "webrtc://10.0.1.50:8554/drone-006",  # 真实设备流地址
    "streamType": "webrtc",  # webrtc | hls | mjpeg
    # ...其余元数据不变
}
```

### 前端：优先播放真实流

```tsx
// SurveillanceFeedCard.tsx — VideoFeed 组件中
if (data.streamUrl) {
  // 真实视频流
  if (data.streamType === "hls") return <HlsPlayer src={data.streamUrl} />;
  if (data.streamType === "webrtc") return <WebRTCPlayer src={data.streamUrl} />;
  return <img src={data.streamUrl} alt="feed" />;  // MJPEG
}
// 无真实流 → 降级为 Canvas 模拟
return <canvas ... />;
```

常见传输协议：

| 协议 | 适用场景 | 延迟 | 前端技术 |
|---|---|---|---|
| WebRTC | 低延迟实时视频 | <500ms | RTCPeerConnection |
| HLS/DASH | 大规模分发 | 2-10s | video.js / hls.js |
| MJPEG | 简单 IP 相机 | 1-3s | `<img>` 标签刷新 |
| WebSocket Binary | 音频/自定义数据 | <200ms | Web Audio API |

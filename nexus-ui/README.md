# NexusUI — Military Command & Control Prototype

基于 Anduril Lattice 风格的军事指挥信息系统前端原型框架。

## 技术栈

- **Next.js 16** (App Router, Turbopack)
- **Tailwind CSS 4** (暗色军事主题)
- **shadcn/ui** (深度定制组件库)
- **MapLibre GL JS** (二维暗色地图)
- **CesiumJS** (三维地球引擎)
- **Zustand** (状态管理)
- **Lucide React** (图标)

## 快速开始

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`

## 后端（FastAPI）启动方式

本仓库的后端在 `../nexus-backend/`，默认由前端通过 `/api/chat`（Next.js 代理）转发到后端 `http://localhost:8001`。

### 1) 安装依赖

```bash
cd ../nexus-backend
uv sync --extra dev
```

### 2) 启动服务（开发模式）

```bash
cd ../nexus-backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### 3) 健康检查

```bash
curl http://localhost:8001/health
```

预期返回：

```json
{"status":"ok"}
```

### 4) 常用环境变量（可选）

后端使用 OpenAI 兼容接口（默认可配置为 OpenRouter 等）。常见配置项在 `nexus-backend/app/core/config.py` 中定义，你可以通过环境变量覆盖：

- `OPENAI_API_KEY`: LLM 调用密钥
- `OPENAI_BASE_URL`: OpenAI 兼容网关地址
- `OPENAI_MODEL`: 使用的模型名称
- `DISABLE_TOOLS`: 设为 `true` 可禁用工具调用

> 如果未配置密钥，聊天接口可能无法正常返回模型结果。

### 5) 运行后端测试

```bash
cd ../nexus-backend
uv run pytest -q
```

## 项目结构

```text
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # 根布局 (字体、全局样式)
│   ├── page.tsx            # 主页面入口
│   └── globals.css         # 主题系统 + CSS 变量
├── components/
│   ├── layout/             # 布局框架
│   │   ├── AppShell.tsx    # 主容器
│   │   ├── TopNav.tsx      # 顶部工作区导航
│   │   ├── WorkspaceDetails.tsx # 工作区摘要条
│   │   ├── LeftSidebar.tsx # 左侧边栏
│   │   ├── RightSidebar.tsx# 右侧边栏
│   │   └── StatusBar.tsx   # 底部状态条
│   ├── map/                # 地图组件
│   │   ├── MapContainer.tsx# 2D/3D切换
│   │   ├── Map2D.tsx       # MapLibre地图
│   │   ├── Map3D.tsx       # Cesium地球
│   ├── panels/             # 业务面板
│   │   ├── TrackListPanel.tsx
│   │   ├── TrackDetail.tsx
│   │   ├── ChatPanel.tsx
│   │   ├── LayerPanel.tsx
│   │   ├── EventLogPanel.tsx
│   │   └── CommPanel.tsx
│   ├── military/           # 军事专用组件
│   │   ├── ForceTag.tsx    # 态势标签
│   │   ├── MilSymbol.tsx   # 军标符号
│   ├── AgentMessageFloat.tsx # 智能体消息浮窗
│   └── ui/                 # shadcn/ui 组件
├── stores/
│   └── app-store.ts        # Zustand 全局状态
└── lib/
    ├── colors.ts           # 色彩 Token
    ├── mock-data.ts        # 演示数据
    └── utils.ts            # 工具函数
```

## 设计系统

### 颜色体系

| 用途 | 颜色 | CSS 变量 |
| --- | --- | --- |
| 背景基色 | `#060a13` | `--nexus-bg-base` |
| 面板背景 | `#0c1220` | `--nexus-bg-surface` |
| 主强调色 | `#22d3ee` | `--nexus-accent` |
| 敌方 | `#4b9eff` | 组件样式内使用蓝色语义 |
| 友方 | `#f97316` | 组件样式内使用橙色语义 |
| 中立 | `#8b8b92` | `--color-nexus-neutral` |

### 态势颜色 (Force Disposition)

- **HOSTILE** — 蓝色 `#4b9eff`
- **FRIENDLY** — 橙色 `#f97316`
- **NEUTRAL** — 灰色 `#8b8b92`

## 可复用组件

- `ForceTag` — 态势标签，支持 `hostile / friendly / neutral`
- `MilSymbol` — 军标符号，支持 `air / sea / underwater`
- `TopNav` / `WorkspaceDetails` / `LeftSidebar` / `RightSidebar` / `StatusBar` — 布局壳组件
- `AgentMessageFloat` — 智能体行为浮窗，与聊天面板联动

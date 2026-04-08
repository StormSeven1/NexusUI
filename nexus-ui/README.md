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
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2) 启动服务（开发模式）

```bash
cd ../nexus-backend
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
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

后端使用 OpenAI 兼容接口（默认可配置为 OpenRouter 等）。常见配置项在 `nexus-backend/config.py` 中定义，你可以通过环境变量覆盖：

- `OPENAI_API_KEY`: LLM 调用密钥
- `OPENAI_BASE_URL`: OpenAI 兼容网关地址
- `OPENAI_MODEL`: 使用的模型名称
- `DISABLE_TOOLS`: 设为 `true` 可禁用工具调用

> 如果未配置密钥，聊天接口可能无法正常返回模型结果。

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
│   │   ├── TopToolbar.tsx  # 顶部导航栏
│   │   ├── LeftSidebar.tsx # 左侧边栏
│   │   ├── RightSidebar.tsx# 右侧边栏
│   │   └── StatusBar.tsx   # 底部状态条
│   ├── map/                # 地图组件
│   │   ├── MapContainer.tsx# 2D/3D切换
│   │   ├── Map2D.tsx       # MapLibre地图
│   │   ├── Map3D.tsx       # Cesium地球
│   │   └── MiniMap.tsx     # 鹰眼小地图
│   ├── panels/             # 业务面板
│   │   ├── TrackListPanel.tsx
│   │   ├── TrackDetail.tsx
│   │   ├── AssetPanel.tsx
│   │   ├── LayerPanel.tsx
│   │   └── AlertPanel.tsx
│   ├── military/           # 军事专用组件
│   │   ├── ForceTag.tsx    # 态势标签
│   │   ├── MilSymbol.tsx   # 军标符号
│   │   └── Timeline.tsx    # 时间轴回放
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
| 敌方 | `#f97316` | `--nexus-hostile` |
| 友方 | `#60a5fa` | `--nexus-friendly` |
| 不明 | `#eab308` | `--nexus-unknown` |

### 态势颜色 (Force Disposition)

- **HOSTILE** — 橙色 `#f97316`
- **SUSPECT** — 琥珀 `#f59e0b`
- **UNKNOWN** — 黄色 `#eab308`
- **FRIENDLY** — 蓝色 `#60a5fa`
- **ASSUMED FRIEND** — 绿色 `#34d399`
- **NEUTRAL** — 灰色 `#94a3b8`

## 可复用组件

- `ForceTag` — 态势标签，支持六种态势类型
- `MilSymbol` — 军标符号，支持空/地/海/未知
- `Timeline` — 时间轴回放控件
- `TopToolbar` / `LeftSidebar` / `RightSidebar` / `StatusBar` — 布局壳组件

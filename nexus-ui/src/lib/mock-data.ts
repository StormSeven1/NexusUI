import type { ForceDisposition } from "./colors";

export interface Track {
  id: string;
  name: string;
  type: "air" | "ground" | "sea" | "unknown";
  disposition: ForceDisposition;
  lat: number;
  lng: number;
  altitude?: number;
  heading: number;
  speed: number;
  sensor: string;
  lastUpdate: string;
  starred: boolean;
}

export interface Asset {
  id: string;
  name: string;
  type: "radar" | "camera" | "tower" | "drone" | "satellite";
  status: "online" | "offline" | "degraded";
  lat: number;
  lng: number;
  range?: number;
}

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: string;
  trackId?: string;
}

export const MOCK_TRACKS: Track[] = [
  {
    id: "TRK-001",
    name: "不明车辆 : 疑似轿车",
    type: "ground",
    disposition: "unknown",
    lat: 51.4545,
    lng: -2.5879,
    heading: 25,
    speed: 8.4,
    sensor: "Tower 6.5 Scope",
    lastUpdate: "14:02:41",
    starred: false,
  },
  {
    id: "TRK-002",
    name: "SHARK-27",
    type: "air",
    disposition: "hostile",
    lat: 51.3201,
    lng: -2.2103,
    altitude: 3200,
    heading: 185,
    speed: 420,
    sensor: "雷达 Alpha",
    lastUpdate: "14:02:39",
    starred: true,
  },
  {
    id: "TRK-003",
    name: "SHARK-31",
    type: "air",
    disposition: "hostile",
    lat: 51.2890,
    lng: -1.9834,
    altitude: 2800,
    heading: 210,
    speed: 385,
    sensor: "雷达 Alpha",
    lastUpdate: "14:02:40",
    starred: false,
  },
  {
    id: "TRK-004",
    name: "BLUEJAY-12",
    type: "air",
    disposition: "friendly",
    lat: 51.5074,
    lng: -2.3576,
    altitude: 5500,
    heading: 90,
    speed: 550,
    sensor: "雷达 Bravo",
    lastUpdate: "14:02:41",
    starred: true,
  },
  {
    id: "TRK-005",
    name: "不明人员",
    type: "ground",
    disposition: "unknown",
    lat: 51.1800,
    lng: -2.4500,
    heading: 0,
    speed: 1.0,
    sensor: "TV 天线门禁",
    lastUpdate: "14:02:38",
    starred: false,
  },
  {
    id: "TRK-006",
    name: "VIPER-03",
    type: "sea",
    disposition: "suspect",
    lat: 50.7200,
    lng: -1.8700,
    heading: 315,
    speed: 18,
    sensor: "AIS 海岸站",
    lastUpdate: "14:02:35",
    starred: false,
  },
  {
    id: "TRK-007",
    name: "EAGLE-09",
    type: "air",
    disposition: "friendly",
    lat: 51.4000,
    lng: -2.7100,
    altitude: 4200,
    heading: 45,
    speed: 480,
    sensor: "雷达 Bravo",
    lastUpdate: "14:02:41",
    starred: true,
  },
  {
    id: "TRK-008",
    name: "货轮 MV-Horizon",
    type: "sea",
    disposition: "neutral",
    lat: 50.6300,
    lng: -2.1500,
    heading: 270,
    speed: 12,
    sensor: "AIS 海岸站",
    lastUpdate: "14:02:30",
    starred: false,
  },
  {
    id: "TRK-009",
    name: "SHADOW-15",
    type: "ground",
    disposition: "hostile",
    lat: 51.1000,
    lng: -2.0200,
    heading: 160,
    speed: 35,
    sensor: "Tower 4.2 Scope",
    lastUpdate: "14:02:37",
    starred: true,
  },
  {
    id: "TRK-010",
    name: "人员 (TX) TV天线",
    type: "ground",
    disposition: "unknown",
    lat: 51.0500,
    lng: -2.3800,
    heading: 0,
    speed: 0.5,
    sensor: "TV Antenna (23d0)",
    lastUpdate: "14:02:25",
    starred: false,
  },
  {
    id: "TRK-011",
    name: "FALCON-22",
    type: "air",
    disposition: "assumed-friend",
    lat: 51.6200,
    lng: -2.1000,
    altitude: 6100,
    heading: 120,
    speed: 510,
    sensor: "雷达 Charlie",
    lastUpdate: "14:02:40",
    starred: false,
  },
  {
    id: "TRK-012",
    name: "渔船 FV-Lucky",
    type: "sea",
    disposition: "neutral",
    lat: 50.5800,
    lng: -2.5200,
    heading: 90,
    speed: 6,
    sensor: "AIS 海岸站",
    lastUpdate: "14:02:28",
    starred: false,
  },
];

export const MOCK_ASSETS: Asset[] = [
  { id: "AST-001", name: "Tower 6.5 光电", type: "tower", status: "online", lat: 51.3800, lng: -2.3590, range: 15 },
  { id: "AST-002", name: "雷达 Alpha", type: "radar", status: "online", lat: 51.5000, lng: -2.5500, range: 80 },
  { id: "AST-003", name: "雷达 Bravo", type: "radar", status: "online", lat: 51.4500, lng: -2.1000, range: 80 },
  { id: "AST-004", name: "雷达 Charlie", type: "radar", status: "degraded", lat: 51.6500, lng: -1.9000, range: 60 },
  { id: "AST-005", name: "摄像头 West-01", type: "camera", status: "online", lat: 51.2000, lng: -2.8000 },
  { id: "AST-006", name: "侦察无人机", type: "drone", status: "online", lat: 51.3500, lng: -2.2000, range: 25 },
  { id: "AST-007", name: "TV 天线门禁", type: "tower", status: "online", lat: 51.0500, lng: -2.4000, range: 10 },
  { id: "AST-008", name: "AIS 海岸站", type: "tower", status: "online", lat: 50.7000, lng: -2.0000, range: 50 },
];

export const MOCK_ALERTS: Alert[] = [
  { id: "ALT-001", severity: "critical", message: "检测到新空中航迹 — SHARK-27 进入限制区域", timestamp: "14:02:39", trackId: "TRK-002" },
  { id: "ALT-002", severity: "warning", message: "雷达 Charlie 信号衰减 — 覆盖范围降至 60km", timestamp: "14:01:15" },
  { id: "ALT-003", severity: "critical", message: "SHADOW-15 正在接近周界围栏", timestamp: "14:02:37", trackId: "TRK-009" },
  { id: "ALT-004", severity: "info", message: "BLUEJAY-12 已进入观察扇区", timestamp: "14:00:52", trackId: "TRK-004" },
  { id: "ALT-005", severity: "warning", message: "VIPER-03 检测到航向偏离", timestamp: "13:58:20", trackId: "TRK-006" },
];

export const MAP_LAYERS = [
  { id: "lyr-sat", name: "卫星影像", visible: true, type: "base" as const },
  { id: "lyr-roads", name: "道路与基础设施", visible: false, type: "overlay" as const },
  { id: "lyr-terrain", name: "地形等高线", visible: false, type: "overlay" as const },
  { id: "lyr-tracks", name: "航迹标记", visible: true, type: "data" as const },
  { id: "lyr-assets", name: "传感器覆盖", visible: true, type: "data" as const },
  { id: "lyr-zones", name: "限制区域", visible: true, type: "data" as const },
  { id: "lyr-grid", name: "MGRS 网格", visible: false, type: "overlay" as const },
  { id: "lyr-weather", name: "气象叠加", visible: false, type: "overlay" as const },
];

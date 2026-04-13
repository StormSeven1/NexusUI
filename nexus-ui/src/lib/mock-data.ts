import type { ForceDisposition } from "./colors";

export interface Track {
  id: string;
  name: string;
  type: "air" | "underwater" | "sea";
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
  /** 传感器朝向（从正北顺时针，度） */
  heading?: number;
  /** 视场角（度）；雷达为 360 表示全向扫描 */
  fovAngle?: number;
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
    name: "空中目标-001",
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
    id: "TRK-002",
    name: "空中目标-002",
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
    id: "TRK-003",
    name: "空中目标-003",
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
    id: "TRK-004",
    name: "水中目标-001",
    type: "underwater",
    disposition: "hostile",
    lat: 50.7200,
    lng: -1.8700,
    heading: 315,
    speed: 18,
    sensor: "声呐 A",
    lastUpdate: "14:02:35",
    starred: false,
  },
  {
    id: "TRK-005",
    name: "空中目标-004",
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
    id: "TRK-006",
    name: "水面目标-001",
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
    id: "TRK-007",
    name: "水中目标-002",
    type: "underwater",
    disposition: "friendly",
    lat: 51.1000,
    lng: -2.0200,
    heading: 160,
    speed: 25,
    sensor: "声呐 B",
    lastUpdate: "14:02:37",
    starred: true,
  },
  {
    id: "TRK-008",
    name: "空中目标-005",
    type: "air",
    disposition: "friendly",
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
    id: "TRK-009",
    name: "水面目标-002",
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
  { id: "AST-001", name: "Tower 6.5 光电", type: "tower", status: "online", lat: 51.3800, lng: -2.3590, range: 15, heading: 45, fovAngle: 120 },
  { id: "AST-002", name: "雷达 Alpha", type: "radar", status: "online", lat: 51.5000, lng: -2.5500, range: 80, fovAngle: 360 },
  { id: "AST-003", name: "雷达 Bravo", type: "radar", status: "online", lat: 51.4500, lng: -2.1000, range: 80, fovAngle: 360 },
  { id: "AST-004", name: "雷达 Charlie", type: "radar", status: "degraded", lat: 51.6500, lng: -1.9000, range: 60, fovAngle: 360 },
  { id: "AST-005", name: "摄像头 West-01", type: "camera", status: "online", lat: 51.2000, lng: -2.8000, range: 8, heading: 160, fovAngle: 60 },
  { id: "AST-006", name: "侦察无人机", type: "drone", status: "online", lat: 51.3500, lng: -2.2000, range: 25, heading: 270, fovAngle: 90 },
  { id: "AST-007", name: "TV 天线门禁", type: "tower", status: "online", lat: 51.0500, lng: -2.4000, range: 10, heading: 0, fovAngle: 180 },
  { id: "AST-008", name: "AIS 海岸站", type: "tower", status: "online", lat: 50.7000, lng: -2.0000, range: 50, fovAngle: 360 },
];

export const MOCK_ALERTS: Alert[] = [
  { id: "ALT-001", severity: "critical", message: "检测到敌方空中目标 TRK-002 进入限制区域", timestamp: "14:02:39", trackId: "TRK-002" },
  { id: "ALT-002", severity: "warning", message: "雷达 Charlie 信号衰减 — 覆盖范围降至 60km", timestamp: "14:01:15" },
  { id: "ALT-003", severity: "critical", message: "水中目标 TRK-004 接近警戒水域边界", timestamp: "14:02:37", trackId: "TRK-004" },
  { id: "ALT-004", severity: "info", message: "友方空中目标 TRK-003 已进入观察扇区", timestamp: "14:00:52", trackId: "TRK-003" },
  { id: "ALT-005", severity: "warning", message: "水面目标 TRK-006 检测到航向偏离", timestamp: "13:58:20", trackId: "TRK-006" },
];

export interface RestrictedZone {
  id: string;
  name: string;
  type: "no-fly" | "warning" | "exercise";
  /** polygon 坐标环 [lng, lat][] */
  coordinates: Array<[number, number]>;
}

export const MOCK_ZONES: RestrictedZone[] = [
  {
    id: "ZON-001",
    name: "禁飞区 Alpha",
    type: "no-fly",
    coordinates: [
      [-2.60, 51.10], [-2.30, 51.10], [-2.30, 51.25], [-2.60, 51.25], [-2.60, 51.10],
    ],
  },
  {
    id: "ZON-002",
    name: "演习区 Bravo",
    type: "exercise",
    coordinates: [
      [-1.95, 51.35], [-1.70, 51.35], [-1.70, 51.50], [-1.95, 51.50], [-1.95, 51.35],
    ],
  },
  {
    id: "ZON-003",
    name: "警告区 Charlie",
    type: "warning",
    coordinates: [
      [-2.80, 50.55], [-2.40, 50.55], [-2.35, 50.70], [-2.75, 50.75], [-2.80, 50.55],
    ],
  },
];

export const MAP_LAYERS = [
  { id: "lyr-sat", name: "卫星影像", visible: true, type: "base" as const },
  { id: "lyr-roads", name: "道路与基础设施", visible: false, type: "overlay" as const },
  { id: "lyr-terrain", name: "地形等高线", visible: false, type: "overlay" as const },
  { id: "lyr-tracks", name: "航迹标记", visible: true, type: "data" as const },
  { id: "lyr-assets", name: "我方资产", visible: true, type: "data" as const },
  { id: "lyr-coverage", name: "传感器覆盖", visible: true, type: "data" as const },
  { id: "lyr-zones", name: "限制区域", visible: true, type: "data" as const },
  { id: "lyr-grid", name: "MGRS 网格", visible: false, type: "overlay" as const },
  { id: "lyr-weather", name: "气象叠加", visible: false, type: "overlay" as const },
];

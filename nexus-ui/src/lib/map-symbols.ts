import { FORCE_COLORS, type ForceDisposition } from "./colors.ts";
import type { Track, Asset } from "./mock-data.ts";

export type TrackType = Track["type"];
export type AssetType = Asset["type"];
export type AssetStatus = Asset["status"];

/* ── 目标航迹图标：使用 public/icons/ 中的 SVG 资源，viewBox 自动缩放至渲染尺寸 ── */

type TrackIconDef = { viewBox: string; pathD: string };

const TRACK_SVG_ICONS: Record<TrackType, TrackIconDef> = {
  // 来自 public/icons/空中目标.svg（viewBox 0 0 1024 1024）
  air: {
    viewBox: "0 0 1024 1024",
    pathD: "M950.208 208.64c16-48.128 12.8-89.888-12.8-118.784l-3.2-3.2c-28.8-25.696-70.368-28.896-118.368-12.832-41.6 12.832-80 38.528-115.168 70.624l-83.2 83.488L240 138.016c-16-3.2-35.2 0-48 12.864L115.2 227.936c-9.6 9.6-16 25.696-12.8 44.96 3.2 16.032 12.8 28.896 25.6 35.296l265.568 144.512-112 112.352-95.968-25.664c-6.4-3.2-12.8-3.2-16-3.2-12.8 0-25.6 6.4-35.2 16.032l-54.4 57.792C67.2 619.648 64 635.712 64 648.544c0 16.064 9.6 28.896 19.2 35.328l147.168 109.152 108.8 147.712c9.6 12.832 22.4 19.264 35.2 19.264h3.168c12.8 0 25.6-6.4 35.2-16.064l57.6-57.792c12.8-12.832 19.2-32.096 12.8-48.16l-25.6-96.32 111.968-112.384 143.968 266.496c9.6 16.064 22.4 22.496 32 25.696 6.4 3.2 9.6 3.2 12.8 3.2 12.8 0 22.4-3.2 32-9.6l76.768-57.824c16-12.832 22.4-32.096 19.2-51.36l-89.6-398.144 83.2-83.488c32-32.096 57.6-70.624 70.4-115.584z m-224.896 180.8l97.376 425.92-58.432 41.92-181.76-329.12-201.28 200.064 35.68 125.824L377.952 896l-103.872-138.752L128 647.552l42.208-41.92 126.592 35.456 201.28-200.032-334.4-180.704 58.464-58.08 412.256 96.8 110.4-106.464c25.92-25.824 58.4-45.184 90.88-58.08 35.712-12.896 48.672-3.232 55.168 0 3.264 6.432 9.76 19.36 0 54.848a197.76 197.76 0 0 1-58.432 90.336l-107.104 109.696z",
  },
  // 来自 public/icons/水面目标.svg（viewBox 0 0 1024 1024）
  sea: {
    viewBox: "0 0 1024 1024",
    pathD: "M625.777778 284.444444v56.888889h28.444444a56.888889 56.888889 0 0 1 56.888889 56.888889v102.769778l57.144889 18.688a56.888889 56.888889 0 0 1 35.527111 74.24l-52.622222 138.951111c21.020444-5.745778 36.778667-12.828444 44.856889-17.720889a28.444444 28.444444 0 0 1 29.297778 48.810667c-28.444444 17.066667-102.286222 44.657778-189.326223 32.199111a589.368889 589.368889 0 0 1-30.634666-5.347556c-23.210667-4.494222-44.373333-8.590222-93.354667-8.590222-48.952889 0-70.144 4.096-93.354667 8.590222a589.368889 589.368889 0 0 1-30.606222 5.347556c-87.04 12.430222-160.881778-15.132444-189.326222-32.199111a28.444444 28.444444 0 0 1 29.269333-48.810667c8.106667 4.892444 23.836444 11.975111 44.885334 17.720889l-52.622223-138.979555a56.888889 56.888889 0 0 1 35.498667-74.24L312.888889 501.020444V398.222222a56.888889 56.888889 0 0 1 56.888889-56.888889h28.444444v-56.888889a56.888889 56.888889 0 0 1 56.888889-56.888888h113.777778a56.888889 56.888889 0 0 1 56.888889 56.888888z m-170.666667 0v56.888889h113.777778v-56.888889h-113.777778z m-85.333333 197.973334l49.834666-16.298667-1.137777-0.369778 30.464-9.187555 16.952889-5.546667c2.702222-0.853333 5.404444-1.536 8.106666-1.991111l19.911111-6.030222a56.149333 56.149333 0 0 1 36.209778 0l19.854222 6.001778c2.702222 0.483556 5.404444 1.137778 8.135111 2.019555l16.952889 5.546667 2.816 0.853333-0.085333 0.028445L654.222222 482.417778V398.222222H369.777778v84.195556z m113.777778 22.670222l-210.147556 68.664889 63.857778 168.561778a256.568889 256.568889 0 0 0 42.723555-2.474667c8.732444-1.251556 16.839111-2.816 25.315556-4.465778A461.852444 461.852444 0 0 1 483.555556 725.902222v-220.785778z m267.036444 68.664889L540.444444 505.088v220.785778c36.693333 1.450667 58.481778 5.688889 78.279112 9.500444 8.448 1.649778 16.554667 3.214222 25.315555 4.465778 14.791111 2.104889 29.098667 2.816 42.666667 2.474667l63.886222-168.561778z",
  },
  // 来自 public/icons/水下目标.svg；用 clipPath 定义的区域作 viewBox，自然裁切可见部分
  underwater: {
    viewBox: "-182 257 1113.8 820.7",
    pathD: "M585.9,462.3c33.9,0,61.7,26.4,63.9,59.8v4.2c.1,0,.1,64,.1,64h38.4c131.5,0,239.2,104.6,243.1,236v7.2c.1,134.3-108.7,243.2-243,243.2H125.2c-72.8,0-133.6-55.5-140.2-128h-90.2s0,51.2,0,51.2c0,20.5-16,37.5-36.5,38.5-20.5,1-38.2-14.3-40.1-34.8l-.2-3.7v-332.8c0-20.5,16-37.5,36.5-38.5,20.5-1,38.2,14.4,40.1,34.8l.2,3.7v38.4H-13.3c12-64.6,66.9-112.3,132.5-115.1h6c0-.1,12.8-.1,12.8-.1v-64c0-33.9,26.4-61.7,59.8-63.9h4.2c0-.1,383.9-.1,383.9-.1ZM688.4,667.1H125.2c-35.4,0-64,28.7-64,64v204.8c0,35.3,28.7,64,64,64h563.2c60,.8,115.7-30.8,145.9-82.6s30.2-115.8,0-167.6c-30.2-51.8-85.9-83.3-145.9-82.6h0ZM-15.6,782.3h-89.6v89.6H-15.6v-89.6ZM573.2,539.2H214.8v51.2h358.4v-51.2ZM573.2,539.2",
  },
};

/**
 * 获取地图引擎内部使用的图标 ID。
 *
 * Get a stable marker image ID for MapLibre/Cesium caches.
 */
export function getMarkerSymbolId(type: TrackType, disposition: ForceDisposition): string {
  return `track-${type}-${disposition}`;
}

/**
 * 依据态势（敌/友/中立）取主题色。
 *
 * Pick the canonical color for a force disposition.
 */
function getMarkerColor(disposition: ForceDisposition): string {
  return FORCE_COLORS[disposition];
}

/**
 * 生成用于 2D/3D 的目标图标 SVG（64x64），无底板圆形，直接渲染目标轮廓。
 *
 * 颜色随态势（敌/友/中立）动态注入，黑色投影保证在浅色地图上的可见性。
 * 约定：图标默认朝"正北/向上"，旋转由地图层/引擎根据 heading 处理。
 */
export function buildMarkerSymbolSvg(type: TrackType, disposition: ForceDisposition): string {
  const color = getMarkerColor(disposition);
  const icon = TRACK_SVG_ICONS[type];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<defs>`,
    `<filter id="sh" x="-25%" y="-25%" width="150%" height="150%">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#000" flood-opacity="0.85"/>`,
    `</filter>`,
    `</defs>`,
    `<svg x="4" y="6" width="56" height="54" viewBox="${icon.viewBox}" filter="url(#sh)">`,
    `<path d="${icon.pathD}" fill="${color}"/>`,
    `</svg>`,
    `<path d="M32 2 L32 7" stroke="${color}" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>`,
    `</svg>`,
  ].join("");
}

/**
 * 将 SVG 包装成 data URL，便于 MapLibre `addImage`/Cesium billboard 直接使用。
 *
 * Wrap the generated SVG into a data URL.
 */
export function buildMarkerSymbolDataUrl(type: TrackType, disposition: ForceDisposition): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildMarkerSymbolSvg(type, disposition))}`;
}

/**
 * 枚举项目内所有"目标类型 × 态势"的图标 key，用于预注册到 MapLibre sprite/image cache。
 *
 * Enumerate all marker keys so we can pre-register images.
 */
export function getAllMarkerSymbolKeys(): Array<{ id: string; type: TrackType; disposition: ForceDisposition }> {
  const types: TrackType[] = ["air", "sea", "underwater"];
  const dispositions: ForceDisposition[] = ["hostile", "friendly", "neutral"];

  return types.flatMap((type) =>
    dispositions.map((disposition) => ({
      id: getMarkerSymbolId(type, disposition),
      type,
      disposition,
    }))
  );
}

/* ── 锁定框（Lock-on reticle）128x128 SVG ── */

export const LOCK_ON_IMAGE_ID = "lock-on-reticle";

export function buildLockOnSvg(): string {
  const c = "#22d3ee";
  const s = 128;
  const m = 10;
  const bl = 22;
  const bw = 2.5;
  const r = 42;
  const half = s / 2;
  const gap = 14;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<path d="M${m} ${m + bl} L${m} ${m} L${m + bl} ${m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${m} L${s - m} ${m} L${s - m} ${m + bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${m} ${s - m - bl} L${m} ${s - m} L${m + bl} ${s - m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${s - m} L${s - m} ${s - m} L${s - m} ${s - m - bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<line x1="${half}" y1="${m + 4}" x2="${half}" y2="${half - gap}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<line x1="${half}" y1="${half + gap}" x2="${half}" y2="${s - m - 4}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<line x1="${m + 4}" y1="${half}" x2="${half - gap}" y2="${half}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<line x1="${half + gap}" y1="${half}" x2="${s - m - 4}" y2="${half}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<circle cx="${half}" cy="${half}" r="${r}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="8 5" opacity="0.45"/>`,
    `</svg>`,
  ].join("");
}

export function buildLockOnDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildLockOnSvg())}`;
}

/* ── 告警环（Alert severity rings）96x96 SVG ── */

export type AlertSeverity = "critical" | "warning" | "info";

const ALERT_RING_COLORS: Record<AlertSeverity, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#60a5fa",
};

export function getAlertRingImageId(severity: AlertSeverity): string {
  return `alert-ring-${severity}`;
}

export function buildAlertRingSvg(severity: AlertSeverity): string {
  const color = ALERT_RING_COLORS[severity];
  const s = 96;
  const half = s / 2;
  const r1 = 40;
  const r2 = 36;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<circle cx="${half}" cy="${half}" r="${r1}" fill="none" stroke="${color}" stroke-width="6" opacity="0.15"/>`,
    `<circle cx="${half}" cy="${half}" r="${r2}" fill="none" stroke="${color}" stroke-width="2.2" opacity="0.75"/>`,
    `<line x1="${half}" y1="${half - r2 - 4}" x2="${half}" y2="${half - r2 + 4}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<line x1="${half}" y1="${half + r2 - 4}" x2="${half}" y2="${half + r2 + 4}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<line x1="${half - r2 - 4}" y1="${half}" x2="${half - r2 + 4}" y2="${half}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<line x1="${half + r2 - 4}" y1="${half}" x2="${half + r2 + 4}" y2="${half}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `</svg>`,
  ].join("");
}

export function buildAlertRingDataUrl(severity: AlertSeverity): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAlertRingSvg(severity))}`;
}

export function getAllAlertRingKeys(): Array<{ id: string; severity: AlertSeverity }> {
  const severities: AlertSeverity[] = ["critical", "warning", "info"];
  return severities.map((severity) => ({
    id: getAlertRingImageId(severity),
    severity,
  }));
}

/* ── 资产图标（Asset icons）48x48 SVG ── */

const ASSET_STATUS_COLORS: Record<AssetStatus, string> = {
  online: "#34d399",
  offline: "#f87171",
  degraded: "#fbbf24",
};

/* SVG 资产图标定义：radar(雷达)、camera(光电)、tower(电侦) 使用 public/icons/ 中的实际 SVG */
type AssetIconDef = {
  viewBox: string;
  /** 单路径图标：pathD 为路径 d 属性值 */
  pathD?: string;
  fillRule?: "evenodd" | "nonzero";
  /** 复合元素图标：svgContent 为原始 SVG 内部元素串，颜色占位符 ASSET_FILL 在渲染时替换 */
  svgContent?: string;
};

const ASSET_SVG_ICONS: Partial<Record<AssetType, AssetIconDef>> = {
  // 来自 public/icons/雷达.svg（viewBox 0 0 32 32，fill-rule=evenodd）
  radar: {
    viewBox: "0 0 32 32",
    fillRule: "evenodd",
    pathD: "M16,32C24.836481,32,32,24.836481,32,16C32,7.1634398,24.836481,0,16,0C7.1634398,0,0,7.1634398,0,16C0,24.836481,7.1634398,32,16,32ZM1.6054511,15.599901C1.8137347,7.9648781,7.9649844,1.8136679,15.600023,1.6054478L15.600023,6.4080844C10.616246,6.61235,6.6124725,10.616123,6.4082065,15.599901L1.6054511,15.599901ZM16.400024,1.605449L16.400024,6.4080844C18.340755,6.4876275,20.132881,7.1433282,21.609905,8.2086945Q21.977381,8,22.399988,8Q22.614334,8,22.821119,8.0564165Q23.027905,8.112833,23.212549,8.2216873L25.895561,5.5386767C23.405478,3.1824446,20.074608,1.7056714,16.400024,1.605449ZM23.778257,8.787365L26.461254,6.1043663C28.817514,8.59445,30.294306,11.925328,30.394547,15.599901L25.591841,15.599901C25.512299,13.659203,24.856619,11.867106,23.791286,10.390097Q23.999989,10.022615,23.999989,9.6000004Q23.999989,9.3856354,23.943562,9.1788292Q23.887135,8.972023,23.778257,8.787365ZM21.587353,10.978269Q21.772011,11.087143,21.978815,11.143572Q22.185623,11.199999,22.399988,11.2L22.400679,11.2C23.330141,12.437458,23.909111,13.953222,23.990196,15.599901L17.549217,15.599901Q17.492842,15.381559,17.378315,15.187304L21.587353,10.978269ZM20.799988,9.5992947L20.799988,9.6000004Q20.799988,9.8143444,20.856403,10.02113Q20.912821,10.227916,21.021675,10.412561L16.812624,14.621613Q16.618368,14.507085,16.400024,14.450709L16.400024,8.0097284C18.046732,8.0908155,19.562517,8.6698036,20.799988,9.5992947ZM15.600023,14.450709L15.600023,8.0097284C11.500097,8.2116165,8.2117386,11.499974,8.0098505,15.599901L14.450831,15.599901Q14.477507,15.496589,14.517664,15.397734Q14.557822,15.298877,14.610751,15.206228Q14.663679,15.11358,14.728441,15.02878Q14.793203,14.94398,14.868652,14.86853Q14.944101,14.793081,15.028902,14.728319Q15.113702,14.663557,15.20635,14.610629Q15.298999,14.557701,15.397855,14.517543Q15.496711,14.477385,15.600023,14.450709ZM14.450831,16.399902L8.0098505,16.399902C8.2117386,20.49983,11.500097,23.788187,15.600023,23.990074L15.600023,17.549095Q15.49671,17.522419,15.397854,17.482264Q15.298998,17.442104,15.206349,17.389177Q15.113701,17.336248,15.028902,17.271484Q14.944102,17.206722,14.868653,17.131273Q14.793204,17.055824,14.728441,16.971025Q14.663679,16.886227,14.610751,16.793577Q14.557822,16.700928,14.517664,16.602072Q14.477507,16.503216,14.450831,16.399902ZM16.400024,17.549097L16.400024,23.990074C20.499954,23.788185,23.788307,20.49983,23.990196,16.399902L17.549219,16.399902Q17.522545,16.503216,17.482386,16.602072Q17.442228,16.700928,17.389299,16.793577Q17.336372,16.886227,17.27161,16.971025Q17.206848,17.055826,17.131397,17.131275Q17.055946,17.206726,16.971148,17.271488Q16.886349,17.33625,16.793699,17.389177Q16.70105,17.442104,16.602194,17.482264Q16.503338,17.522421,16.400024,17.549097ZM1.6054456,16.399902L6.4082065,16.399902C6.6124725,21.38368,10.616246,25.387453,15.600023,25.591719L15.600023,30.39455C7.9649177,30.186331,1.8136275,24.035074,1.6054456,16.399902ZM16.400024,30.394548L16.400024,25.591719C21.383802,25.387451,25.387575,21.38368,25.591841,16.399902L30.394552,16.399902C30.186373,24.035059,24.035166,30.186306,16.400024,30.394548Z",
  },
  // 来自 public/icons/光电.svg（viewBox 0 0 27.43 24）
  camera: {
    viewBox: "0 0 27.428573608398438 24.000003814697266",
    pathD: "M5.9176493,3.8918924L6.6661258,1.5995091C6.9779911,0.64864892,7.9057903,1.7573853e-7,8.9583368,1.7573853e-7L18.470236,1.7573853e-7C19.522779,1.7573853e-7,20.450583,0.64864892,20.762445,1.5995091L21.510923,3.8918924L23.654997,3.8918924C25.7367,3.8918924,27.428574,5.4914012,27.428574,7.4594607L27.428574,20.432434C27.428574,22.400496,25.736706,24.000004,23.655003,24.000004L3.7735734,24.000004C1.6918706,24.000004,0,22.400496,0,20.432434L0,7.4594607C0,5.4914012,1.6918706,3.8918922,3.7735734,3.8918922L5.9176493,3.8918924ZM6.6817183,5.8378386L3.7735724,5.8378386C3.3213677,5.8378386,2.8847558,6.0073714,2.5572972,6.3095837C2.2376349,6.6117949,2.0583124,7.0245714,2.0583124,7.4594607L2.0583124,20.432434C2.0583124,20.859955,2.2376351,21.27273,2.5572972,21.582314C2.8769593,21.884525,3.3135715,22.054054,3.7735724,22.054054L23.670597,22.054054C24.122801,22.054054,24.55941,21.884525,24.886869,21.582314C25.206533,21.280102,25.385855,20.867325,25.385855,20.432434L25.385855,7.4594607C25.385855,7.0319419,25.206533,6.6191649,24.886869,6.3095827C24.567207,6.0073714,24.130598,5.8378386,23.670597,5.8378386L20.762451,5.8378386C20.310246,5.8378386,19.912617,5.5577402,19.780073,5.1523347L18.805494,2.1744473C18.758713,2.0417693,18.626173,1.9459461,18.478035,1.9459461L8.966136,1.9459461C8.8179998,1.9459461,8.6854572,2.0417693,8.6386786,2.1744473L7.6640978,5.1523347C7.5315547,5.5577407,7.1339259,5.8378386,6.6817183,5.8378386ZM13.722084,18.162165C10.884108,18.162165,8.5763016,15.987716,8.5763016,13.297298C8.5763016,10.60688,10.884108,8.4324331,13.722084,8.4324331C16.560061,8.4324331,18.867863,10.606879,18.867863,13.297298C18.867863,15.987716,16.567856,18.162165,13.722084,18.162165ZM13.722084,16.216219C15.429546,16.216219,16.809555,14.911549,16.809555,13.2973C16.809555,11.683051,15.429546,10.37838,13.722086,10.37838C12.014622,10.37838,10.634615,11.683048,10.634615,13.2973C10.634615,14.911551,12.014621,16.216219,13.722084,16.216219Z",
  },
  // 来自 public/icons/电侦.svg（viewBox 0 0 30 30，相控阵天线形态，多 rect 元素）
  tower: {
    viewBox: "0 0 30 30",
    svgContent:
      '<rect x="5.1" y="2.7" width="1.8" height="13.6" transform="translate(5.5 -1.7) rotate(30)" fill="ASSET_FILL"/>' +
      '<rect x="11.1" y="2.7" width="1.8" height="13.6" transform="translate(6.3 -4.7) rotate(30)" fill="ASSET_FILL"/>' +
      '<rect x="17.1" y="2.7" width="1.8" height="13.6" transform="translate(7.1 -7.8) rotate(30)" fill="ASSET_FILL"/>' +
      '<rect x="23.2" y="2.7" width="1.8" height="13.6" transform="translate(7.9 -10.8) rotate(30)" fill="ASSET_FILL"/>' +
      '<rect x="14.1" y="0" width="1.8" height="18.9" transform="translate(24.5 -5.6) rotate(90)" fill="ASSET_FILL"/>' +
      '<rect x="13.8" y="18.1" width="2.4" height="8.8" fill="ASSET_FILL"/>',
  },
};

/* drone / satellite 保留旧路径方案（48×48 坐标系，描边风格） */
const ASSET_ICON_PATHS: Partial<Record<AssetType, string>> = {
  // 无人机：使用两段半圆弧组成完整圆（替代之前有兼容性问题的近零弧写法）
  drone:
    "M14 14 L20 20 M34 14 L28 20 M14 34 L20 28 M34 34 L28 28 M20 20 L28 20 L28 28 L20 28 Z M10 14 A4 4 0 1 0 18 14 A4 4 0 1 0 10 14 Z M30 14 A4 4 0 1 0 38 14 A4 4 0 1 0 30 14 Z M10 34 A4 4 0 1 0 18 34 A4 4 0 1 0 10 34 Z M30 34 A4 4 0 1 0 38 34 A4 4 0 1 0 30 34 Z",
  satellite:
    "M16 32 L22 26 M26 22 L32 16 M22 26 L26 22 M18 18 L14 14 M30 30 L34 34 M13 28 Q10 24 14 20 M20 34 Q24 38 28 35 M19 24 L24 19 L29 24 L24 29 Z",
};

export function getAssetSymbolId(type: AssetType, status: AssetStatus): string {
  return `asset-${type}-${status}`;
}

/**
 * 生成 56x56 资产图标 SVG，颜色随运行状态（在线/离线/降级）动态注入。
 *
 * - radar / camera / tower：使用 public/icons/ 中的实际 SVG 路径，嵌套 svg 自动缩放
 *   camera 给予更大内边距避免图标过于拥挤
 * - drone / satellite：使用描边路径方案，嵌入 48×48 坐标系的嵌套 svg 保持居中
 */
export function buildAssetSymbolSvg(type: AssetType, status: AssetStatus): string {
  const color = ASSET_STATUS_COLORS[status];
  const svgIcon = ASSET_SVG_ICONS[type];

  if (svgIcon) {
    // camera 图标宽高比约 27:24（横向略宽），给更大边距以避免拥挤感
    const pad = type === "camera" ? 12 : 8;
    const inner = 56 - pad * 2;
    // 生成内部 SVG 内容：svgContent 用占位符 ASSET_FILL 动态替换；pathD 生成 path 元素
    const iconInner = svgIcon.svgContent
      ? svgIcon.svgContent.replace(/ASSET_FILL/g, color)
      : (() => {
          const fr = svgIcon.fillRule ? ` fill-rule="${svgIcon.fillRule}"` : "";
          return `<path d="${svgIcon.pathD ?? ""}" fill="${color}"${fr}/>`;
        })();
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">`,
      `<defs>`,
      `<filter id="ag" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${color}" flood-opacity="0.5"/></filter>`,
      `</defs>`,
      `<rect x="3" y="3" width="50" height="50" rx="7" fill="rgba(9,9,11,0.9)" stroke="${color}" stroke-width="2" filter="url(#ag)"/>`,
      `<svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="${svgIcon.viewBox}">`,
      iconInner,
      `</svg>`,
      `</svg>`,
    ].join("");
  }

  // drone / satellite：路径在 48×48 坐标系，嵌套 svg 映射到 50×50 区域
  const iconPath = ASSET_ICON_PATHS[type] ?? "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">`,
    `<defs>`,
    `<filter id="ag" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${color}" flood-opacity="0.5"/></filter>`,
    `</defs>`,
    `<rect x="3" y="3" width="50" height="50" rx="7" fill="rgba(9,9,11,0.9)" stroke="${color}" stroke-width="2" filter="url(#ag)"/>`,
    `<svg x="3" y="3" width="50" height="50" viewBox="0 0 48 48">`,
    `<path d="${iconPath}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    `</svg>`,
    `</svg>`,
  ].join("");
}

export function buildAssetSymbolDataUrl(type: AssetType, status: AssetStatus): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAssetSymbolSvg(type, status))}`;
}

export function getAllAssetSymbolKeys(): Array<{ id: string; type: AssetType; status: AssetStatus }> {
  const types: AssetType[] = ["radar", "camera", "tower", "drone", "satellite"];
  const statuses: AssetStatus[] = ["online", "offline", "degraded"];
  return types.flatMap((type) =>
    statuses.map((status) => ({ id: getAssetSymbolId(type, status), type, status }))
  );
}

/* ── 选中目标高亮环（Track selection ring）96x96 SVG ── */

export const TRACK_SELECT_RING_ID = "track-select-ring";

/**
 * 生成目标选中高亮环 SVG：蓝色静态瞄准环，取代原来的大透明圆圈。
 *
 * 设计：外层低透明度晕圈 + 内层主环 + 4 个刻度线，风格参考瞄准镜。
 */
export function buildSelectionRingSvg(): string {
  const c = "#60a5fa";
  const s = 96;
  const half = s / 2;
  const rO = 40;
  const rI = 33;
  const tA = half - rO;      // 8  刻度起（外环边缘）
  const tB = tA + 9;         // 17 刻度终（向内 9px）

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<circle cx="${half}" cy="${half}" r="${rO}" fill="none" stroke="${c}" stroke-width="5" opacity="0.1"/>`,
    `<circle cx="${half}" cy="${half}" r="${rI}" fill="none" stroke="${c}" stroke-width="1.8" opacity="0.8"/>`,
    `<line x1="${half}" y1="${tA}" x2="${half}" y2="${tB}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `<line x1="${half}" y1="${s - tA}" x2="${half}" y2="${s - tB}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `<line x1="${tA}" y1="${half}" x2="${tB}" y2="${half}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `<line x1="${s - tA}" y1="${half}" x2="${s - tB}" y2="${half}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `</svg>`,
  ].join("");
}

export function buildSelectionRingDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSelectionRingSvg())}`;
}

/* ── 选中资产高亮框 52x52 SVG ── */

export const ASSET_SELECT_IMAGE_ID = "asset-select-ring";

export function buildAssetSelectSvg(): string {
  const c = "#34d399";
  const s = 52;
  const m = 4;
  const bl = 12;
  const bw = 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<path d="M${m} ${m + bl} L${m} ${m} L${m + bl} ${m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${m} L${s - m} ${m} L${s - m} ${m + bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${m} ${s - m - bl} L${m} ${s - m} L${m + bl} ${s - m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${s - m} L${s - m} ${s - m} L${s - m} ${s - m - bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `</svg>`,
  ].join("");
}

export function buildAssetSelectDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAssetSelectSvg())}`;
}

/* ── GeoJSON 几何工具（覆盖范围 / 视场角 / 雷达扫描）── */

const DEG2RAD = Math.PI / 180;
const KM_PER_DEG = 111.32;

/**
 * 从 center 向某角度（地理 heading：0=北 顺时针）偏移 radiusKm 得到 [lng, lat]。
 */
function offsetPoint(centerLng: number, centerLat: number, radiusKm: number, headingDeg: number): [number, number] {
  const rad = headingDeg * DEG2RAD;
  const dy = radiusKm * Math.cos(rad);
  const dx = radiusKm * Math.sin(rad);
  const lat = centerLat + dy / KM_PER_DEG;
  const lng = centerLng + dx / (KM_PER_DEG * Math.cos(centerLat * DEG2RAD));
  return [lng, lat];
}

/**
 * 生成 360° 圆形坐标环。
 */
export function geoCircleCoords(centerLng: number, centerLat: number, radiusKm: number, segments = 64): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    pts.push(offsetPoint(centerLng, centerLat, radiusKm, (i / segments) * 360));
  }
  return pts;
}

/**
 * 生成扇形（视场角）坐标环。
 *
 * @param headingDeg  扇形中心线方向（0=北，顺时针）
 * @param fovDeg      视场角（度），例如 60 表示左右各 30°
 */
export function geoSectorCoords(
  centerLng: number,
  centerLat: number,
  radiusKm: number,
  headingDeg: number,
  fovDeg: number,
  segments = 32,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [[centerLng, centerLat]];
  const halfFov = fovDeg / 2;
  const startAngle = headingDeg - halfFov;
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * fovDeg;
    pts.push(offsetPoint(centerLng, centerLat, radiusKm, angle));
  }
  pts.push([centerLng, centerLat]);
  return pts;
}

/**
 * 生成雷达扫描扇区坐标环（用于动画：每帧更新 sweepAngle）。
 *
 * @param sweepAngle  当前扫描波束中心角度
 * @param beamWidth   波束宽度（度），默认 30
 */
export function geoRadarSweepCoords(
  centerLng: number,
  centerLat: number,
  radiusKm: number,
  sweepAngle: number,
  beamWidth = 30,
): Array<[number, number]> {
  return geoSectorCoords(centerLng, centerLat, radiusKm, sweepAngle, beamWidth, 16);
}

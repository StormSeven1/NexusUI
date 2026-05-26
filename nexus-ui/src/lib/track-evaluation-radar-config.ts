import type { AssetData } from "@/stores/asset-store";
import type { TrackEvalRadarChannel, TrackEvalRadarChannels } from "@/lib/track-evaluation-metrics";

/** sensor_id 1 / 2 / 5 对应的对海、对空雷达角色（与 C++ 航迹评估 WS 一致） */
const WHARF_PATTERNS = [/码头/, /远遥/];
const JINGZI_PATTERNS = [/靖子头/, /靖子/];
const BIRD_PATTERNS = [/探鸟/];

/** 实体列表尚未就绪时的兜底（141 远遥场景近似坐标） */
export const FALLBACK_TRACK_EVAL_RADAR_CHANNELS: TrackEvalRadarChannels = {
  radar1: {
    id: 1,
    name: "码头雷达",
    center: { lon: 122.089, lat: 37.545 },
    rotateAngleDeg: 0,
  },
  radar2: {
    id: 2,
    name: "靖子头雷达",
    center: { lon: 122.178101, lat: 37.510601 },
    rotateAngleDeg: 0,
  },
  radar5: {
    id: 5,
    name: "探鸟雷达",
    center: { lon: 122.126213, lat: 37.511272 },
    rotateAngleDeg: 0,
  },
};

function isValidGeo(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 && ln === 0) return false;
  return true;
}

function listRadarAssets(assets: readonly AssetData[]): AssetData[] {
  return assets.filter((a) => String(a.asset_type ?? "").toLowerCase() === "radar");
}

function pickRadarByPatterns(
  assets: readonly AssetData[],
  patterns: RegExp[],
): AssetData | undefined {
  const radars = listRadarAssets(assets);
  return radars.find((a) => {
    const hay = `${a.name} ${a.id}`;
    return patterns.some((p) => p.test(hay));
  });
}

function assetToRadarChannel(asset: AssetData, sensorId: number): TrackEvalRadarChannel | undefined {
  if (!isValidGeo(asset.lat, asset.lng)) return undefined;
  const name = String(asset.name ?? asset.id).trim() || `雷达 ${sensorId}`;
  return {
    id: sensorId,
    name,
    center: { lon: Number(asset.lng), lat: Number(asset.lat) },
    rotateAngleDeg: 0,
  };
}

function mergeChannel(
  fromAsset: TrackEvalRadarChannel | undefined,
  fallback: TrackEvalRadarChannel | undefined,
): TrackEvalRadarChannel | undefined {
  if (fromAsset) return fromAsset;
  return fallback;
}

/**
 * 从 `useAssetStore.assets`（实体列表 / WS 合并结果）解析航迹评估用雷达通道。
 * radar1=码头(sensor 1)，radar2=靖子头(sensor 2)，radar5=探鸟(sensor 5)。
 */
export function resolveTrackEvalRadarChannelsFromAssets(
  assets: readonly AssetData[],
  fallback: TrackEvalRadarChannels = FALLBACK_TRACK_EVAL_RADAR_CHANNELS,
): TrackEvalRadarChannels {
  const wharf = pickRadarByPatterns(assets, WHARF_PATTERNS);
  const jingzi = pickRadarByPatterns(assets, JINGZI_PATTERNS);
  const bird = pickRadarByPatterns(assets, BIRD_PATTERNS);

  return {
    radar1: mergeChannel(
      wharf ? assetToRadarChannel(wharf, 1) : undefined,
      fallback.radar1,
    ),
    radar2: mergeChannel(
      jingzi ? assetToRadarChannel(jingzi, 2) : undefined,
      fallback.radar2,
    ),
    radar5: mergeChannel(
      bird ? assetToRadarChannel(bird, 5) : undefined,
      fallback.radar5,
    ),
    radar6: fallback.radar6,
  };
}

/** 图表/统计用短名：去掉末尾「雷达」 */
export function shortTrackEvalRadarLabel(name: string | undefined, fallback: string): string {
  if (!name?.trim()) return fallback;
  const short = name.trim().replace(/雷达$/u, "").trim();
  return short || name.trim();
}

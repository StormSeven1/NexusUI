/**
 * 对空融合航迹 fusion_type 位掩码与 original_track_id 槽位映射。
 * bit0(1)=探鸟, bit1(2)=自报位, bit2(4)=反无车雷达；槽位按置位顺序依次对应 original_track_id1/2/3…
 */

export const AIR_FUSION_BIT_BIRD = 1;
export const AIR_FUSION_BIT_SELF_REPORT = 2;
export const AIR_FUSION_BIT_FANWU = 4;

export type AirFusionSourceKey = "bird" | "selfReport" | "fanwu";

export interface AirFusionSources {
  fusionType: number;
  bird?: number | string;
  selfReport?: number | string;
  fanwu?: number | string;
  /** fusion_type 未设置时兼容旧数据的 KU 雷达（original_track_id3） */
  legacyKu?: number | string;
}

const AIR_FUSION_SOURCE_ORDER: ReadonlyArray<{ bit: number; key: AirFusionSourceKey }> = [
  { bit: AIR_FUSION_BIT_BIRD, key: "bird" },
  { bit: AIR_FUSION_BIT_SELF_REPORT, key: "selfReport" },
  { bit: AIR_FUSION_BIT_FANWU, key: "fanwu" },
];

export function isValidAirFusionTrackId(id: unknown): boolean {
  if (id === undefined || id === null || id === "") return false;
  const n = Number(id);
  if (Number.isFinite(n) && n === 0) return false;
  return true;
}

export function parseAirFusionSources(originalData: Record<string, unknown>): AirFusionSources {
  const fusionType = Number(originalData.fusion_type ?? 0) || 0;
  const result: AirFusionSources = { fusionType };

  if (fusionType > 0) {
    let slot = 1;
    for (const { bit, key } of AIR_FUSION_SOURCE_ORDER) {
      if ((fusionType & bit) !== 0) {
        const id = originalData[`original_track_id${slot}`];
        if (isValidAirFusionTrackId(id)) {
          result[key] = id as number | string;
        }
        slot += 1;
      }
    }
    return result;
  }

  if (isValidAirFusionTrackId(originalData.original_track_id1)) {
    result.bird = originalData.original_track_id1 as number | string;
  }
  if (isValidAirFusionTrackId(originalData.original_track_id2)) {
    result.selfReport = originalData.original_track_id2 as number | string;
  }
  if (isValidAirFusionTrackId(originalData.original_track_id3)) {
    result.legacyKu = originalData.original_track_id3 as number | string;
  }
  return result;
}

export function getAirSelfReportId(
  originalData: Record<string, unknown>,
): number | string | undefined {
  return parseAirFusionSources(originalData).selfReport;
}

export function getAirSecondaryRadarId(sources: AirFusionSources): number | string | undefined {
  return sources.fanwu ?? sources.legacyKu;
}

export function getAirSecondaryRadarSensorId(sources: AirFusionSources): number {
  return sources.fanwu !== undefined ? 203 : 7;
}

export function hasAirRadarBesidesSelfReport(sources: AirFusionSources): boolean {
  return (
    sources.bird !== undefined ||
    sources.fanwu !== undefined ||
    sources.legacyKu !== undefined
  );
}

export interface AirFusionRadarRef {
  key: "bird" | "secondary";
  id: number | string;
  label: string;
  sensorId: number;
}

/** 对空融合中除自报位外的雷达源（探鸟、反无车/KU），按 fusion_type 顺序 */
export function listAirFusionRadars(
  sources: AirFusionSources,
  labels?: { bird?: string; secondary?: string },
): AirFusionRadarRef[] {
  const out: AirFusionRadarRef[] = [];
  if (sources.bird !== undefined) {
    out.push({
      key: "bird",
      id: sources.bird,
      label: labels?.bird ?? "探鸟",
      sensorId: 5,
    });
  }
  const secondaryId = getAirSecondaryRadarId(sources);
  if (secondaryId !== undefined) {
    out.push({
      key: "secondary",
      id: secondaryId,
      label: labels?.secondary ?? (sources.fanwu !== undefined ? "反无车" : "KU"),
      sensorId: getAirSecondaryRadarSensorId(sources),
    });
  }
  return out;
}

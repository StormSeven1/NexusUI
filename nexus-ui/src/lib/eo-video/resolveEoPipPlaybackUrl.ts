import { fetchEntityPlaybackAny } from "@/lib/eo-video/resolveCameraEntityPlayback";
import { buildUavZlmSignalingUrl, buildUavZlmStreamKey, getUavZlmWebrtcBaseUrl } from "@/lib/eo-video/buildUavZlmWebrtcUrl";
import { fetchUavPlatformSignalingUrl } from "@/lib/eo-video/resolveUavLiveByPlatform";
import { fetchResolvedUavPlaybackIds } from "@/lib/eo-video/resolveUavPlaybackByEntity";
import type { EoVideoStreamEntry } from "@/lib/eo-video/types";

const AIRPORT_FPV_PAYLOAD = "165-0-7";
const DRONE_MAIN_PAYLOAD = "81-0-0";
const DRONE_MAIN_PAYLOAD_SPECIAL = "80-0-0";

function uniqueCandidates(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function resolvePlaybackByCandidates(candidates: string[]): Promise<{ signalingUrl: string; picked: string }> {
  if (candidates.length === 0) {
    throw new Error("实体播放解析失败：候选实体为空");
  }
  let lastErr: unknown = null;
  for (const id of candidates) {
    try {
      const p = await fetchEntityPlaybackAny(id);
      return { signalingUrl: p.signalingUrl, picked: id };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `实体播放解析失败（已尝试: ${candidates.join(", ")}）${
      lastErr ? `: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : ""
    }`,
  );
}

/** 与 EoVideoPanel UAV 主流解析对齐：舱内 dock / 舱外 air 两套地址 */
async function computeUavDockAirUrls(uav: NonNullable<EoVideoStreamEntry["uav"]>): Promise<{ dock: string; air: string }> {
  const resolved = await fetchResolvedUavPlaybackIds(uav.entityId).catch(() => null);
  const airportSn = resolved?.airportSN ?? uav.airportSN;
  const droneSn = resolved?.deviceSN ?? uav.deviceSN;
  const mainPayload = droneSn === "1581F6QAD241200BWX4E" ? DRONE_MAIN_PAYLOAD_SPECIAL : DRONE_MAIN_PAYLOAD;

  let dockZlm: string | null = null;
  let airZlm: string | null = null;
  if (airportSn) {
    try {
      dockZlm = buildUavZlmSignalingUrl(airportSn, AIRPORT_FPV_PAYLOAD);
    } catch {
      dockZlm = null;
    }
  }
  if (droneSn) {
    try {
      airZlm = buildUavZlmSignalingUrl(droneSn, mainPayload);
    } catch {
      airZlm = null;
    }
  }

  const [platformDock, platformAir] = await Promise.all([
    !dockZlm && airportSn
      ? fetchUavPlatformSignalingUrl({ deviceSn: airportSn, payloadIndex: AIRPORT_FPV_PAYLOAD }).catch((e) => ({
          err: e as unknown,
        }))
      : Promise.resolve(null),
    !airZlm && droneSn
      ? fetchUavPlatformSignalingUrl({ deviceSn: droneSn, payloadIndex: mainPayload }).catch((e) => ({
          err: e as unknown,
        }))
      : Promise.resolve(null),
  ]);

  const dockCandidates = uniqueCandidates(
    resolved?.dockPlaybackEntityId,
    resolved?.airportSN,
    uav.dockPlaybackEntityId,
    uav.airportSN,
    uav.entityId,
  );
  const airCandidates = uniqueCandidates(
    resolved?.airPlaybackEntityId,
    resolved?.deviceSN,
    uav.airPlaybackEntityId,
    uav.deviceSN,
    uav.entityId,
  );

  const [dockResult, airResult] = await Promise.all([
    dockZlm
      ? Promise.resolve({ signalingUrl: dockZlm, picked: `zlm:${airportSn}:${AIRPORT_FPV_PAYLOAD}` })
      : platformDock
        ? "err" in platformDock
          ? resolvePlaybackByCandidates(dockCandidates).catch((e) => ({ err: e as unknown }))
          : Promise.resolve({
              signalingUrl: platformDock.signalingUrl,
              picked: `platform:${airportSn}:${AIRPORT_FPV_PAYLOAD}`,
            })
        : resolvePlaybackByCandidates(dockCandidates).catch((e) => ({ err: e as unknown })),
    airZlm
      ? Promise.resolve({ signalingUrl: airZlm, picked: `zlm:${droneSn}:${mainPayload}` })
      : platformAir
        ? "err" in platformAir
          ? resolvePlaybackByCandidates(airCandidates).catch((e) => ({ err: e as unknown }))
          : Promise.resolve({
              signalingUrl: platformAir.signalingUrl,
              picked: `platform:${droneSn}:${mainPayload}`,
            })
        : resolvePlaybackByCandidates(airCandidates).catch((e) => ({ err: e as unknown })),
  ]);

  const dockUrl = "signalingUrl" in dockResult ? dockResult.signalingUrl : null;
  const airUrl = "signalingUrl" in airResult ? airResult.signalingUrl : null;

  if (!dockUrl && !airUrl) {
    throw new Error("画中画：机场/机体取流均失败");
  }

  return {
    dock: dockUrl ?? airUrl ?? "",
    air: airUrl ?? dockUrl ?? "",
  };
}

export interface ResolveEoPipPlaybackUrlOpts {
  /** PiP 所选流 id 与当前主流 id 相同：直接复用主流已解析信令（含 MQTT 舱内/外） */
  sameAsActiveMain: boolean;
  mainPlaySignalingUrl: string;
  /** 当前主流实体 id（用于判断 PiP 另一路是否同一架机以套用 MQTT） */
  activeMainUavEntityId: string | null;
  /** 来自 MQTT，仅当 PiP 目标与主流为同一 UAV entity 时参与选 dock/air */
  mqttDroneInDock: boolean | null;
}

/**
 * 画中画独立拉流：与 EoVideoPanel 主流解析链对齐；跨机 PiP 时 MQTT 未必适用该机，按 dock→air 回退。
 */
export async function resolveEoPipPlaybackUrl(
  entry: EoVideoStreamEntry,
  opts: ResolveEoPipPlaybackUrlOpts,
): Promise<string> {
  if (opts.sameAsActiveMain && opts.mainPlaySignalingUrl.trim()) {
    return opts.mainPlaySignalingUrl;
  }

  if (!entry.uav) {
    if (entry.signalingUrl && entry.signalingUrl !== "about:blank") {
      return entry.signalingUrl;
    }
    const p = await fetchEntityPlaybackAny(entry.id);
    return p.signalingUrl;
  }

  const urls = await computeUavDockAirUrls(entry.uav);
  const sameEntity =
    opts.activeMainUavEntityId != null &&
    opts.activeMainUavEntityId.trim() === entry.uav.entityId.trim();

  if (sameEntity && opts.mqttDroneInDock !== null) {
    return opts.mqttDroneInDock ? urls.dock : (urls.air || urls.dock);
  }
  return urls.dock || urls.air;
}

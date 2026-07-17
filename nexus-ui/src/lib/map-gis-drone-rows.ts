import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import type { DroneTelemetry } from "@/stores/drone-store";
import { useDroneStore } from "@/stores/drone-store";

/** 地图右键 / 起飞控制：机体 SN + 机场 gateway SN（与 `postUavControlAction` 一致） */
export type MapGisDroneRow = { sn: string; airportSN: string; label: string };

function pickDockFromProps(props: Record<string, unknown> | undefined): string {
  if (!props) return "";
  return String(props.dock_sn ?? props.dockSn ?? props.airportSN ?? props.airport_sn ?? "").trim();
}

function payloadSourceGrpc(d: DroneTelemetry): boolean {
  for (const bag of [d.status, d.highFreq, d.flightPath]) {
    if (!bag || typeof bag !== "object") continue;
    if (String((bag as Record<string, unknown>).source ?? "").toLowerCase() === "grpc") return true;
  }
  return false;
}

/** gRPC 蓝方等无机场绑定，仍须在图层面板列出以便单独控显隐 */
export function isStandaloneMapGisDrone(
  row: Pick<MapGisDroneRow, "sn" | "airportSN">,
  tele?: DroneTelemetry | null,
): boolean {
  if (row.airportSN.trim()) return false;
  if (tele?.virtualTroop) return true;
  if (tele && payloadSourceGrpc(tele)) return true;
  return false;
}

/** 仅一个机巢时，用于补全缺失的 `droneToAirport`（部分环境 relationships 不完整） */
function soleRelationshipDockSn(): string {
  const aps = useDroneStore.getState().relationships?.airports ?? [];
  if (aps.length !== 1) return "";
  return String(aps[0]?.dockSn ?? "").trim();
}

/**
 * 合并数据源（与光电窗口尽量同源）：
 * 1. `drone-store.drones` + `droneToAirport`（实时）
 * 2. 单机巢时：有遥测但缺映射的 SN → 机巢 dockSn
 * 3. 无机场但为 gRPC/蓝方虚兵 → 仍入列（`airportSN` 空，图层面板可单独开关）
 * 4. `asset-store` 中 `asset_type=drone` 且 `properties.dock_sn`（地图已显示无人机时常见）
 */
export function collectMapGisDroneRowsSync(): MapGisDroneRow[] {
  const seen = new Set<string>();
  const rows: MapGisDroneRow[] = [];

  const ds = useDroneStore.getState();
  const fallbackDock = soleRelationshipDockSn();

  for (const sn of Object.keys(ds.drones)) {
    if (seen.has(sn)) continue;
    const d = ds.drones[sn];
    let airportSN = (ds.droneToAirport[sn] ?? "").trim();
    if (!airportSN) airportSN = fallbackDock;
    if (!airportSN && !isStandaloneMapGisDrone({ sn, airportSN: "" }, d)) continue;
    seen.add(sn);
    rows.push({ sn, airportSN, label: (d.displayName || "").trim() || sn });
  }

  const assets = useAssetStore.getState().assets;
  for (const a of assets) {
    if (a.asset_type !== "drone") continue;
    const sn = String(a.id ?? "").trim();
    if (!sn || seen.has(sn)) continue;
    const props =
      a.properties && typeof a.properties === "object"
        ? (a.properties as Record<string, unknown>)
        : undefined;
    let dockSn = pickDockFromProps(props);
    if (!dockSn) dockSn = fallbackDock;
    const standaloneAsset =
      !dockSn &&
      (a.disposition === "hostile" ||
        props?.virtual_troop === true ||
        props?.is_virtual === true);
    if (!dockSn && !standaloneAsset) continue;
    seen.add(sn);
    rows.push({ sn, airportSN: dockSn, label: (a.name || "").trim() || sn });
  }

  rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  return rows;
}

/**
 * 注册表无条目时，与光电 UAV 流兜底一致：`entityId` 优先于 WS 展示名（见 `mergeRegistryStreams`）。
 */
export function mapGisDroneEoFallbackLabel(sn: string): string {
  const ds = useDroneStore.getState();
  for (const [eid, mapped] of Object.entries(ds.entityIdToDeviceSn)) {
    if (mapped === sn && eid.trim()) return eid.trim();
  }
  return (ds.drones[sn]?.displayName ?? "").trim() || sn;
}

/** 先 `sync` 后 `extra`；同 SN 保留先出现的（实时 store 优先） */
export function mergeMapGisDroneRowsPreferSync(sync: MapGisDroneRow[], extra: MapGisDroneRow[]): MapGisDroneRow[] {
  const seen = new Set<string>();
  const out: MapGisDroneRow[] = [];
  for (const r of [...sync, ...extra]) {
    if (seen.has(r.sn)) continue;
    seen.add(r.sn);
    out.push(r);
  }
  out.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  return out;
}

/** 供依赖签名：仅无人机资产相关字段变化时重算 */
export function mapGisDroneSyncSignature(assets: AssetData[]): string {
  return assets
    .filter((a) => a.asset_type === "drone")
    .map((a) => {
      const p =
        a.properties && typeof a.properties === "object"
          ? (a.properties as Record<string, unknown>)
          : undefined;
      return `${a.id}:${pickDockFromProps(p)}:${a.name ?? ""}`;
    })
    .sort()
    .join("|");
}

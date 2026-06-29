"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import {
  useAssetStore,
  type AssetData,
  type AssetRelationshipGraph,
  type AssetRelationshipNode,
} from "@/stores/asset-store";
import { PUBLIC_MAP_SVG_FILES, publicIconFileUrl } from "@/lib/map-icons";
import { normalizeAssetType, type PublicMapAssetType } from "@/lib/map-entity-model";
import { formatAssetDeviceStateDisplay, getAssetDeviceStateTags, isAssetStatusFresh } from "@/lib/map-app-config";

const CATEGORY_ORDER: Array<{ type: PublicMapAssetType; label: string }> = [
  { type: "airport", label: "机场" },
  { type: "radar", label: "雷达" },
  { type: "camera", label: "光电" },
  { type: "tower", label: "电侦" },
  { type: "laser", label: "激光" },
  { type: "tdoa", label: "TDOA" },
  { type: "usv", label: "无人船" },
  { type: "missile", label: "飞弹" },
  { type: "drone", label: "无人机" },
];

type TreeNode = {
  id: string;
  asset?: AssetData;
  relation?: AssetRelationshipNode;
  children: TreeNode[];
};

type Section = {
  id: string;
  label: string;
  type: PublicMapAssetType;
  nodes: TreeNode[];
};

function toPublicAssetType(raw: string | undefined): PublicMapAssetType | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    return normalizeAssetType(value);
  } catch {
    const normalized = value.toLowerCase();
    if (normalized === "uav") return "drone";
    if (normalized === "dock") return "airport";
    if (normalized === "optoelectronic") return "camera";
    if (normalized === "esm") return "tower";
    return null;
  }
}

function getNodeType(node: TreeNode): PublicMapAssetType | null {
  return toPublicAssetType(node.asset?.asset_type ?? node.relation?.assetType);
}

function getNodeName(node: TreeNode): string {
  const name = String(node.asset?.name ?? node.relation?.name ?? "").trim();
  return name || node.id;
}

function getNodeCoords(node: TreeNode): { lat: number; lng: number } | null {
  if (node.asset && Number.isFinite(node.asset.lat) && Number.isFinite(node.asset.lng)) {
    return { lat: node.asset.lat, lng: node.asset.lng };
  }
  const lat = node.relation?.latitude;
  const lng = node.relation?.longitude;
  if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
  return null;
}

function getNodeIconUrl(node: TreeNode): string {
  const type = getNodeType(node) ?? "radar";
  return publicIconFileUrl(PUBLIC_MAP_SVG_FILES[type]);
}

function getAirportProps(asset: AssetData | undefined): Record<string, unknown> | null {
  return asset?.properties && typeof asset.properties === "object"
    ? (asset.properties as Record<string, unknown>)
    : null;
}

function getDroneBatteryPercent(asset: AssetData | undefined): number | null {
  if (!asset || toPublicAssetType(asset.asset_type) !== "drone") return null;
  const props = getAirportProps(asset);
  const status = props?.drone_status && typeof props.drone_status === "object"
    ? (props.drone_status as Record<string, unknown>)
    : null;
  const n = Number(
    props?.drone_battery_percent ??
      props?.battery_percent ??
      props?.batteryPercent ??
      props?.battery_capacity_percent ??
      props?.batteryCapacityPercent ??
      status?.battery_percent ??
      status?.batteryPercent ??
      status?.battery_capacity_percent ??
      status?.batteryCapacityPercent,
  );
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function getAirportDockBatteryPercent(asset: AssetData | undefined): number | null {
  if (!asset || toPublicAssetType(asset.asset_type) !== "airport") return null;
  const props = getAirportProps(asset);
  const dock = props?.dock && typeof props.dock === "object"
    ? (props.dock as Record<string, unknown>)
    : null;
  const n = Number(
    props?.dock_battery_percent ??
      props?.battery_capacity_percent ??
      props?.batteryCapacityPercent ??
      dock?.battery_capacity_percent ??
      dock?.batteryCapacityPercent,
  );
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function getAirportModeInfo(asset: AssetData | undefined): { title: string; value: string } {
  const props = getAirportProps(asset);
  const hasDockStatus = props?.dock != null || props?.dock_status_received_at_ms != null;
  const rawMode = props?.dock_mode_code ?? props?.mode_code;
  const hasMode = rawMode !== undefined && rawMode !== null && String(rawMode).trim() !== "";
  if (!hasDockStatus || !hasMode) {
    return { title: "状态", value: isAssetStatusFresh(asset) ? "在线" : "离线" };
  }
  const labels: Record<string, string> = {
    "0": "空闲",
    "1": "现场调试",
    "2": "远程调试",
    "3": "固件升级中",
    "4": "作业中",
  };
  const key = String(rawMode).trim();
  return { title: "模式", value: labels[key] ?? "未知" };
}

function getAirportWarnLabel(asset: AssetData | undefined): string | null {
  const props = getAirportProps(asset);
  const alarmState =
    props?.dock && typeof props.dock === "object"
      ? Number((props.dock as Record<string, unknown>).alarm_state)
      : NaN;
  if (Number.isFinite(alarmState) && alarmState > 0) return `告警 ${alarmState}`;
  return null;
}

function logAirportPanelDebug(asset: AssetData | undefined): void {
  if (!asset || toPublicAssetType(asset.asset_type) !== "airport") return;
  // console.debug("[dock_status][panel][airport-render]", {
  //   assetName: asset.name,
  //   dock_mode_code: props?.dock_mode_code,
  //   dock_battery_percent: props?.dock_battery_percent,
  //   dock: props?.dock,
  // });
}

function matchesSearch(node: TreeNode, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return (
    getNodeName(node).toLowerCase().includes(q) ||
    String(node.relation?.deviceSn ?? "").toLowerCase().includes(q) ||
    String(node.relation?.gatewaySn ?? "").toLowerCase().includes(q)
  );
}

function countNodesByType(nodes: TreeNode[], type: PublicMapAssetType): number {
  let total = 0;
  for (const node of nodes) {
    total += getNodeType(node) === type ? 1 : 0;
    total += countNodesByType(node.children, type);
  }
  return total;
}

function buildNodeMap(assets: AssetData[], relationships: AssetRelationshipGraph | null): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();
  for (const asset of assets) map.set(asset.id, { id: asset.id, asset, children: [] });
  for (const relation of relationships?.nodes ?? []) {
    const prev = map.get(relation.id);
    if (prev) prev.relation = relation;
    else map.set(relation.id, { id: relation.id, relation, children: [] });
  }
  return map;
}

function buildParentGraph(relationships: AssetRelationshipGraph | null): {
  parentByChild: Map<string, string>;
  childrenByParent: Map<string, string[]>;
} {
  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();
  for (const edge of relationships?.edges ?? []) {
    const parent = String(edge.parent ?? "").trim();
    const child = String(edge.child ?? "").trim();
    if (!parent || !child || parent === child) continue;
    parentByChild.set(child, parent);
    const list = childrenByParent.get(parent) ?? [];
    list.push(child);
    childrenByParent.set(parent, list);
  }
  return { parentByChild, childrenByParent };
}

function buildTree(
  rootId: string,
  nodeMap: Map<string, TreeNode>,
  childrenByParent: Map<string, string[]>,
  allowedIds: Set<string>,
  seen: Set<string> = new Set(),
): TreeNode {
  const base = nodeMap.get(rootId) ?? { id: rootId, children: [] };
  if (seen.has(rootId)) return { ...base, children: [] };
  const nextSeen = new Set(seen);
  nextSeen.add(rootId);
  const childIds = [...new Set(childrenByParent.get(rootId) ?? [])]
    .filter((childId) => allowedIds.has(childId))
    .sort((a, b) =>
      getNodeName(nodeMap.get(a) ?? { id: a, children: [] }).localeCompare(
        getNodeName(nodeMap.get(b) ?? { id: b, children: [] }),
        "zh-Hans",
        { sensitivity: "base" },
      ),
    );
  return {
    ...base,
    children: childIds.map((childId) => buildTree(childId, nodeMap, childrenByParent, allowedIds, nextSeen)),
  };
}

function filterTree(nodes: TreeNode[], search: string): TreeNode[] {
  const visit = (node: TreeNode): TreeNode | null => {
    const children = node.children.map(visit).filter((child): child is TreeNode => child !== null);
    if (matchesSearch(node, search) || children.length > 0) return { ...node, children };
    return null;
  };
  return nodes.map(visit).filter((node): node is TreeNode => node !== null);
}

function buildSections(assets: AssetData[], relationships: AssetRelationshipGraph | null, search: string): Section[] {
  const nodeMap = buildNodeMap(assets, relationships);
  const { parentByChild } = buildParentGraph(relationships);
  const assetState = useAssetStore.getState();
  const entityIdToDeviceSn = assetState.entityIdToDeviceSn;
  const deviceSnToEntityId = assetState.deviceSnToEntityId;
  const assetByDeviceSn = new Map<string, string>();
  for (const asset of assets) {
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    const deviceSn = String(props?.deviceSn ?? props?.device_sn ?? "").trim();
    if (deviceSn) assetByDeviceSn.set(deviceSn, asset.id);
  }

  const canonicalId = (id: string): string => {
    const raw = String(id ?? "").trim();
    if (!raw) return raw;
    const byEntity = entityIdToDeviceSn[raw];
    if (byEntity) {
      const assetId = assetByDeviceSn.get(byEntity);
      if (assetId && nodeMap.has(assetId)) return assetId;
      if (nodeMap.has(byEntity)) return byEntity;
    }
    const bySn = assetByDeviceSn.get(raw);
    if (bySn && nodeMap.has(bySn)) return bySn;
    const byDevice = deviceSnToEntityId[raw];
    if (byDevice && nodeMap.has(byDevice)) return byDevice;
    if (nodeMap.has(raw)) return raw;
    return raw;
  };

  const normalizedParentByChild = new Map<string, string>();
  const normalizedChildrenByParent = new Map<string, string[]>();
  for (const [child, parent] of parentByChild.entries()) {
    const childId = canonicalId(child);
    const parentId = canonicalId(parent);
    if (!childId || !parentId || childId === parentId) continue;
    normalizedParentByChild.set(childId, parentId);
    const list = normalizedChildrenByParent.get(parentId) ?? [];
    list.push(childId);
    normalizedChildrenByParent.set(parentId, list);
  }

  const sections: Section[] = [];
  for (const category of CATEGORY_ORDER) {
    const allowedIds = new Set<string>();
    for (const node of nodeMap.values()) {
      const type = getNodeType(node);
      if (type !== category.type) continue;
      if (normalizedParentByChild.has(node.id)) continue;
      allowedIds.add(node.id);
      for (const childId of normalizedChildrenByParent.get(node.id) ?? []) {
        allowedIds.add(childId);
      }
    }

    if (allowedIds.size === 0) continue;

    const rootIds = [...allowedIds]
      .filter((id) => !normalizedParentByChild.has(id) || !allowedIds.has(normalizedParentByChild.get(id)!))
      .sort((a, b) =>
        getNodeName(nodeMap.get(a) ?? { id: a, children: [] }).localeCompare(
          getNodeName(nodeMap.get(b) ?? { id: b, children: [] }),
          "zh-Hans",
          { sensitivity: "base" },
        ),
      );

    const trees = rootIds.map((rootId) => buildTree(rootId, nodeMap, normalizedChildrenByParent, allowedIds));
    const filtered = filterTree(trees, search);
    if (filtered.length === 0) continue;

    sections.push({
      id: `type:${category.type}`,
      label: `${category.label} (${countNodesByType(filtered, category.type)})`,
      type: category.type,
      nodes: filtered,
    });
  }

  return sections;
}

function StatusTag({ label, color }: { label: string; color: string }) {
  return <span className={cn("inline-flex rounded px-1 py-0.5 text-[8px] leading-none", color)}>{label}</span>;
}

function DroneBatteryBar({ value }: { value: number | null }) {
  const pct = value != null ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="h-4 w-[86px] shrink-0 overflow-hidden border border-white/10 bg-[#4e4e52]">
      <div className="relative h-full">
        <div className="absolute inset-y-0 left-0 bg-[#4f8a63]" style={{ width: `${pct}%` }} />
        <div className="relative flex h-full items-center justify-between px-1.5 text-[8px] font-medium leading-none">
          <span className="text-[#39ef97]">电量</span>
          <span className="text-[#d4d4d8]">{value != null ? `${Math.round(value)}%` : "--"}</span>
        </div>
      </div>
    </div>
  );
}

function AirportStatusStrip({ asset }: { asset: AssetData }) {
  logAirportPanelDebug(asset);
  const mode = getAirportModeInfo(asset);
  const warn = getAirportWarnLabel(asset);

  return (
    <div className="mr-5 mt-0.5 space-y-0.5">
      <div className="flex h-4 items-stretch border border-white/10 bg-[#5b5b5f]">
        <div className="flex min-w-[90px] items-center bg-[#4e4e52] px-1 text-[8px] font-medium text-[#2ef2b0]">
          <span className="mr-1 text-[8px]">{mode.title}</span>
          {mode.value}
        </div>
        <div className="ml-px flex flex-1 items-center bg-[#4e4e52] px-2.5 text-[8px] font-medium text-[#ffb327]">
          {warn ?? ""}
        </div>
      </div>
    </div>
  );
}

function TreeRow({
  node,
  level,
  selectedAssetId,
  collapsedNodes,
  inheritedAirportBattery,
  onToggleCollapse,
  onSelect,
}: {
  node: TreeNode;
  level: number;
  selectedAssetId: string | null;
  collapsedNodes: Set<string>;
  inheritedAirportBattery?: number | null;
  onToggleCollapse: (nodeId: string) => void;
  onSelect: (node: TreeNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedNodes.has(node.id);
  const isSelected = selectedAssetId === node.id;
  const type = getNodeType(node);
  const tags = node.asset ? getAssetDeviceStateTags(node.asset) : [];
  const statusText = node.asset ? formatAssetDeviceStateDisplay(node.asset) : "";
  const droneBattery = getDroneBatteryPercent(node.asset);
  const displayDroneBattery = type === "drone" ? (droneBattery ?? inheritedAirportBattery ?? null) : null;
  const nextInheritedAirportBattery =
    type === "airport" ? getAirportDockBatteryPercent(node.asset) : inheritedAirportBattery;
  // if (type === "drone" && node.asset) {
    // const props = getAirportProps(node.asset);
    // console.log("[asset_panel][drone]", {
    //   id: node.asset.id,
    //   name: node.asset.name,
    //   deviceState: props?.deviceState,
    //   deviceStateLabel: props?.deviceStateLabel,
    //   droneBattery,
    //   batteryFields: {
    //     drone_battery_percent: props?.drone_battery_percent,
    //     battery_percent: props?.battery_percent,
    //     batteryPercent: props?.batteryPercent,
    //     battery_capacity_percent: props?.battery_capacity_percent,
    //     batteryCapacityPercent: props?.batteryCapacityPercent,
    //   },
    // });
  // }

  return (
    <div>
      <button
        onClick={() => onSelect(node)}
        className={cn(
          "flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-white/[0.02]",
          isSelected && "bg-white/[0.03]",
        )}
        style={{ paddingLeft: `${8 + level * 10}px` }}
      >
        <div
          className={cn(
            "flex h-4 w-3 shrink-0 items-center justify-center text-zinc-500",
            type === "airport" && "self-center",
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleCollapse(node.id);
          }}
        >
          {hasChildren ? isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} /> : null}
        </div>
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/8 bg-white/[0.02]",
            type === "airport" && "self-center",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getNodeIconUrl(node)} alt="" className="h-3.5 w-3.5 object-contain opacity-90" />
        </div>
        <div className="min-w-0 flex-1 border-b border-white/[0.04] pb-1">
          <div className="truncate text-[10px] font-medium leading-4 text-zinc-100">{getNodeName(node)}</div>
          {type === "airport" && node.asset ? <AirportStatusStrip asset={node.asset} /> : null}
          {type !== "airport" && (statusText || type === "drone") ? (
            <div className={cn("mt-0.5 flex h-4 items-center gap-1", type === "drone" && "mr-5")}>
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {tags.length > 0 ? tags.map((tag, index) => <StatusTag key={`${node.id}-${index}`} label={tag.label} color={tag.color} />) : null}
              </div>
              {type === "drone" ? <DroneBatteryBar value={displayDroneBattery} /> : null}
            </div>
          ) : null}
        </div>
      </button>
      {hasChildren && !isCollapsed ? (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              level={level + 1}
              selectedAssetId={selectedAssetId}
              collapsedNodes={collapsedNodes}
              inheritedAirportBattery={nextInheritedAirportBattery}
              onToggleCollapse={onToggleCollapse}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionBlock({
  section,
  collapsedSections,
  collapsedNodes,
  selectedAssetId,
  onToggleSection,
  onToggleCollapse,
  onSelect,
}: {
  section: Section;
  collapsedSections: Set<string>;
  collapsedNodes: Set<string>;
  selectedAssetId: string | null;
  onToggleSection: (sectionId: string) => void;
  onToggleCollapse: (nodeId: string) => void;
  onSelect: (node: TreeNode) => void;
}) {
  const isCollapsed = collapsedSections.has(section.id);

  return (
    <div className="border-b border-white/[0.04] last:border-b-0">
      <button
        onClick={() => onToggleSection(section.id)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-white/[0.02]"
      >
        <span className="text-[11px] font-medium text-zinc-100">{section.label}</span>
        {isCollapsed ? <ChevronRight size={12} className="text-zinc-500" /> : <ChevronDown size={12} className="text-zinc-500" />}
      </button>
      {!isCollapsed ? (
        <div>
          {section.nodes.length > 0 ? (
            section.nodes.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                level={0}
                selectedAssetId={selectedAssetId}
                collapsedNodes={collapsedNodes}
                onToggleCollapse={onToggleCollapse}
                onSelect={onSelect}
              />
            ))
          ) : (
            <div className="px-6 py-3 text-[10px] text-zinc-500">暂无设备</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AssetPanel() {
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const selectedAssetId = useAppStore((state) => state.selectedAssetId);
  const selectAsset = useAppStore((state) => state.selectAsset);
  const requestFlyTo = useAppStore((state) => state.requestFlyTo);
  const assets = useAssetStore((state) => state.assets);
  const relationships = useAssetStore((state) => state.relationships);

  const sections = useMemo(() => buildSections(assets, relationships, search), [assets, relationships, search]);
  const online = assets.filter((asset) => asset.status === "online").length;
  const offline = assets.length - online;

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const toggleNode = (nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleSelect = (node: TreeNode) => {
    if (!node.asset) return;
    const isSelected = selectedAssetId === node.id;
    selectAsset(isSelected ? null : node.id);
    if (isSelected) return;
    const coords = getNodeCoords(node);
    if (coords) requestFlyTo(coords.lat, coords.lng, 14);
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="border-b border-white/[0.05] px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[9px] font-medium text-zinc-400">资产</span>
          <span className="text-[8px] text-zinc-500">{online} 在线 / {offline} 离线</span>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索资产"
            className="h-6 w-full rounded-md border border-white/[0.06] bg-white/[0.02] pl-7 pr-2 text-[9px] text-zinc-200 placeholder:text-zinc-500 focus:border-white/[0.1] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[9px] text-zinc-500">暂无匹配资产</div>
        ) : (
          sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              collapsedSections={collapsedSections}
              collapsedNodes={collapsedNodes}
              selectedAssetId={selectedAssetId}
              onToggleSection={toggleSection}
              onToggleCollapse={toggleNode}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

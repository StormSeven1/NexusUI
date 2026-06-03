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
import { assetUiDisplayName, getAssetDeviceStateTags } from "@/lib/map-app-config";

type TreeNode = {
  id: string;
  asset?: AssetData;
  relation?: AssetRelationshipNode;
  children: TreeNode[];
};

const CATEGORY_ORDER: { type: PublicMapAssetType; label: string }[] = [
  { type: "airport", label: "机场" },
  { type: "drone", label: "无人机" },
  { type: "usv", label: "无人船" },
  { type: "missile", label: "飞弹" },
  { type: "radar", label: "雷达" },
  { type: "camera", label: "光电" },
  { type: "tower", label: "电侦" },
  { type: "laser", label: "激光" },
  { type: "tdoa", label: "TDOA" },
];

const CATEGORY_LABELS = new Map(CATEGORY_ORDER.map((item) => [item.type, item.label]));

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
  if (node.asset) return assetUiDisplayName(node.asset);
  const relationName = String(node.relation?.name ?? "").trim();
  return relationName || node.id;
}

function getNodeCoords(node: TreeNode): { lat: number; lng: number } | null {
  if (
    node.asset &&
    Number.isFinite(node.asset.lat) &&
    Number.isFinite(node.asset.lng)
  ) {
    return { lat: node.asset.lat, lng: node.asset.lng };
  }
  const lat = node.relation?.latitude;
  const lng = node.relation?.longitude;
  if (typeof lat === "number" && typeof lng === "number") {
    return { lat, lng };
  }
  return null;
}

function getNodeTypeLabel(node: TreeNode): string {
  const type = getNodeType(node);
  return (type && CATEGORY_LABELS.get(type)) || "实体";
}

function getNodeIconUrl(node: TreeNode): string {
  const type = getNodeType(node) ?? "radar";
  return publicIconFileUrl(PUBLIC_MAP_SVG_FILES[type]);
}

function wouldCreateCycle(parentId: string, childId: string, parentByChild: Map<string, string>) {
  let currentId = parentId;
  const visited = new Set<string>([childId]);
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = parentByChild.get(currentId) ?? "";
  }
  return false;
}

function buildAssetTree(assets: AssetData[], relationships: AssetRelationshipGraph | null): TreeNode[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const relationById = new Map(
    (relationships?.nodes ?? []).map((node) => [node.id, node]),
  );
  const ids = new Set<string>();

  for (const asset of assets) ids.add(asset.id);
  for (const node of relationships?.nodes ?? []) ids.add(node.id);
  for (const edge of relationships?.edges ?? []) {
    if (edge.parent) ids.add(edge.parent);
    if (edge.child) ids.add(edge.child);
  }

  const parentByChild = new Map<string, string>();
  for (const edge of relationships?.edges ?? []) {
    const parent = String(edge.parent ?? "").trim();
    const child = String(edge.child ?? "").trim();
    if (!parent || !child || parent === child || parentByChild.has(child)) continue;
    if (wouldCreateCycle(parent, child, parentByChild)) continue;
    parentByChild.set(child, parent);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [child, parent] of parentByChild.entries()) {
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(child);
    childrenByParent.set(parent, siblings);
  }

  const sortIds = (values: string[]) =>
    values.sort((left, right) => {
      const leftName =
        assetUiDisplayName(assetById.get(left) ?? { id: left, name: relationById.get(left)?.name ?? "" });
      const rightName =
        assetUiDisplayName(assetById.get(right) ?? { id: right, name: relationById.get(right)?.name ?? "" });
      return leftName.localeCompare(rightName, "en", { sensitivity: "base" });
    });

  const makeNode = (id: string, lineage: Set<string>): TreeNode => {
    if (lineage.has(id)) {
      return {
        id,
        asset: assetById.get(id),
        relation: relationById.get(id),
        children: [],
      };
    }
    const nextLineage = new Set(lineage);
    nextLineage.add(id);
    const childIds = sortIds([...(childrenByParent.get(id) ?? [])]);
    return {
      id,
      asset: assetById.get(id),
      relation: relationById.get(id),
      children: childIds.map((childId) => makeNode(childId, nextLineage)),
    };
  };

  const rootIds = sortIds(
    [...ids].filter((id) => !parentByChild.has(id)),
  );
  const effectiveRoots = rootIds.length > 0 ? rootIds : sortIds([...ids]);
  const pruneNonAssetNodes = (nodes: TreeNode[]): TreeNode[] => {
    const next: TreeNode[] = [];
    for (const node of nodes) {
      const children = pruneNonAssetNodes(node.children);
      if (node.asset) {
        next.push({ ...node, children });
      } else {
        next.push(...children);
      }
    }
    return next;
  };

  return pruneNonAssetNodes(effectiveRoots.map((id) => makeNode(id, new Set<string>())));
}

function filterTree(
  nodes: TreeNode[],
  search: string,
  typeFilter: string,
): TreeNode[] {
  const q = search.trim().toLowerCase();
  const visit = (node: TreeNode): TreeNode | null => {
    const filteredChildren = node.children
      .map(visit)
      .filter((child): child is TreeNode => child !== null);
    const type = getNodeType(node);
    const matchesType = typeFilter === "all" || type === typeFilter;
    const matchesSearch =
      !q ||
      getNodeName(node).toLowerCase().includes(q) ||
      node.id.toLowerCase().includes(q) ||
      String(node.relation?.deviceSn ?? "").toLowerCase().includes(q) ||
      String(node.relation?.gatewaySn ?? "").toLowerCase().includes(q);
    if ((matchesType && matchesSearch) || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  };
  return nodes.map(visit).filter((node): node is TreeNode => node !== null);
}

function countTreeNodes(nodes: TreeNode[]): number {
  let total = 0;
  for (const node of nodes) total += 1 + countTreeNodes(node.children);
  return total;
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium leading-none",
        color,
      )}
    >
      {label}
    </span>
  );
}

function TreeItem({
  node,
  level,
  selectedAssetId,
  collapsedNodes,
  onToggleCollapse,
  onSelect,
}: {
  node: TreeNode;
  level: number;
  selectedAssetId: string | null;
  collapsedNodes: Set<string>;
  onToggleCollapse: (nodeId: string) => void;
  onSelect: (node: TreeNode) => void;
}) {
  const isSelected = selectedAssetId === node.id;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedNodes.has(node.id);
  const tags = node.asset ? getAssetDeviceStateTags(node.asset) : [];

  return (
    <div key={node.id}>
      <button
        onClick={() => onSelect(node)}
        className={cn(
          "flex w-full items-start gap-2 border-b border-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.04]",
          isSelected && "bg-emerald-500/[0.08]",
          !node.asset && "opacity-75",
        )}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        <div
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleCollapse(node.id);
          }}
          className="flex h-5 w-3 shrink-0 items-center justify-center"
        >
          {hasChildren ? (
            isCollapsed ? (
              <ChevronRight size={12} className="text-nexus-text-muted" />
            ) : (
              <ChevronDown size={12} className="text-nexus-text-muted" />
            )
          ) : null}
        </div>
        <div
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
            isSelected
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-white/[0.08] bg-white/[0.03]",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getNodeIconUrl(node)} alt="" className="h-3 w-3 object-contain opacity-90" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] font-medium text-nexus-text-primary">
              {getNodeName(node)}
            </span>
            <span className="shrink-0 text-[9px] font-medium text-nexus-text-secondary">
              {getNodeTypeLabel(node)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-nexus-text-muted">{node.id}</span>
            {tags.length > 0 ? (
              <div className="flex shrink-0 items-center gap-1">
                {tags.map((tag, index) => (
                  <Tag key={`${node.id}-${index}`} label={tag.label} color={tag.color} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </button>
      {hasChildren && !isCollapsed ? (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedAssetId={selectedAssetId}
              collapsedNodes={collapsedNodes}
              onToggleCollapse={onToggleCollapse}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AssetPanel() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const selectedAssetId = useAppStore((state) => state.selectedAssetId);
  const selectAsset = useAppStore((state) => state.selectAsset);
  const requestFlyTo = useAppStore((state) => state.requestFlyTo);
  const assets = useAssetStore((state) => state.assets);
  const relationships = useAssetStore((state) => state.relationships);

  const treeData = useMemo(
    () => buildAssetTree(assets, relationships),
    [assets, relationships],
  );

  const filteredTree = useMemo(
    () => filterTree(treeData, search, typeFilter),
    [treeData, search, typeFilter],
  );

  const online = assets.filter((asset) => asset.status === "online").length;
  const offline = assets.length - online;
  const visibleCount = countTreeNodes(filteredTree);

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
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            资产树
          </span>
          <span className="text-[10px] text-nexus-text-muted">
            {online} 在线 / {offline} 离线
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-muted"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索实体"
              className="h-7 w-full rounded-md border border-white/[0.06] bg-white/[0.03] pl-8 pr-2 text-[11px] text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/[0.08]"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-7 rounded-md border border-white/[0.06] bg-[#1e1e24] px-1.5 text-[10px] text-nexus-text-primary focus:outline-none"
          >
            <option value="all" className="bg-[#1e1e24]">
              全部
            </option>
            {CATEGORY_ORDER.map((item) => (
              <option key={item.type} value={item.type} className="bg-[#1e1e24]">
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[10px] text-nexus-text-muted">
          {visibleCount} 个可见节点
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredTree.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-nexus-text-muted">
            暂无匹配实体
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              level={0}
              selectedAssetId={selectedAssetId}
              collapsedNodes={collapsedNodes}
              onToggleCollapse={toggleNode}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

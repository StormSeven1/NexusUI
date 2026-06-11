/** 区域实体 ID：`area-{groupId}-{areaId}` */
export function areaEntityId(groupId: number, areaId: number): string {
  return `area-${groupId}-${areaId}`;
}

/** 航线实体 ID：`route-{groupId}-{areaId}` */
export function routeEntityId(groupId: number, areaId: number): string {
  return `route-${groupId}-${areaId}`;
}

/** 按 `area_table.area_type` 选择实体 ID（4=航线，其余=区域） */
export function mapEntityId(groupId: number, areaId: number, areaType: number): string {
  return areaType === 4 ? routeEntityId(groupId, areaId) : areaEntityId(groupId, areaId);
}

export function parseMapEntityId(entityId: string): { groupId: number; areaId: number } | null {
  const id = entityId.trim();
  let m = /^area-(\d+)-(\d+)$/.exec(id);
  if (m) return { groupId: Number(m[1]), areaId: Number(m[2]) };
  /** 兼容旧格式 `group-{groupId}-area-{areaId}` */
  m = /^group-(\d+)-area-(\d+)$/.exec(id);
  if (m) return { groupId: Number(m[1]), areaId: Number(m[2]) };
  m = /^route-(\d+)-(\d+)$/.exec(id);
  if (m) return { groupId: Number(m[1]), areaId: Number(m[2]) };
  /** 兼容旧格式 `groupId_areaId` */
  m = /^(\d+)_(\d+)$/.exec(id);
  if (m) return { groupId: Number(m[1]), areaId: Number(m[2]) };
  return null;
}

/** @deprecated 使用 parseMapEntityId */
export const parseAreaEntityId = parseMapEntityId;

/** 与 `EoVideoPanel` 内原常量一致，抽出供同步 store 与面板共用 */
export const EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX = "nexus.eo.activeStream.";
export const EO_PIP_STREAM_STORAGE_PREFIX = "nexus.eo.pipActiveStream.";

const ZOOM_PERSIST_SUFFIX = "::zoom";

/**
 * dock 与放大窗内嵌面板共用同一键：嵌套实例 `streamPersistKey` 带 `::zoom`，与 dock 的 `electro-optical-1` 对齐为同一同步键。
 */
export function getEoVideoStreamSyncKey(
  streamPersistKey: string | undefined,
  entityId: string | undefined,
): string {
  const raw = (streamPersistKey ?? "").trim();
  const stripped = raw.endsWith(ZOOM_PERSIST_SUFFIX)
    ? raw.slice(0, -ZOOM_PERSIST_SUFFIX.length).trim()
    : raw;
  if (stripped) return stripped;
  const ent = (entityId ?? "").trim();
  if (ent) return ent;
  return "default";
}

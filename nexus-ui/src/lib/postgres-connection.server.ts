/**
 * Nexus 服务端共用 PostgreSQL 连接串（WatchSystem 库：查证元数据、区域图层 `area_table` 等）。
 *
 * 优先 `NEXUS_POSTGRES_URL`；仍兼容旧环境变量名，便于迁移。
 */
export function resolvePostgresConnectionString(): string | null {
  const s =
    process.env.NEXUS_POSTGRES_URL?.trim() ??
    process.env.TASK_STATUS_PG_CONNECTION_STRING?.trim() ??
    process.env.TASK_STATUS_METADATA_DATABASE_URL?.trim();
  return s || null;
}

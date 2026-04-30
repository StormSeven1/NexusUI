const BUILTIN_DEFAULT = "http://192.168.18.141:8890";

/**
 * 无人机私有云 / 平台 HTTP 根地址（登录、MQTT 信息、控制指令等 BFF 共用）。
 * 优先 NEXUS_DRONE_PLATFORM_BASE_URL；旧配置可用 NEXUS_DRONE_PRIVATE_CLOUD_BASE_URL 或 NEXUS_UAV_PLATFORM_BASE_URL。
 */
export function resolveDronePlatformBase(): { base: string; source: string } {
  const entries: [string, string | undefined][] = [
    ["NEXUS_DRONE_PLATFORM_BASE_URL", process.env.NEXUS_DRONE_PLATFORM_BASE_URL],
    ["NEXUS_DRONE_PRIVATE_CLOUD_BASE_URL", process.env.NEXUS_DRONE_PRIVATE_CLOUD_BASE_URL],
    ["NEXUS_UAV_PLATFORM_BASE_URL", process.env.NEXUS_UAV_PLATFORM_BASE_URL],
  ];
  for (const [name, raw] of entries) {
    const t = raw?.trim();
    if (t) return { base: t.replace(/\/$/, ""), source: name };
  }
  return { base: BUILTIN_DEFAULT, source: "builtin-default" };
}

export function getDronePlatformBaseUrl(): string {
  return resolveDronePlatformBase().base;
}

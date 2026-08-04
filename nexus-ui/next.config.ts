import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8001";

const nextConfig: NextConfig = {
  /** pg/minio 含 Node 原生可选依赖，禁止打进 RSC 包 */
  serverExternalPackages: ["pg", "minio"],
  turbopack: {},
  /**
   * 将服务端 .env 的 NEXUS_FUSION_TRACK_GRPC_SOURCES 暴露给前端（目标图层默认显隐），
   * 与 Custombackend 共用同一配置项，无需再写 NEXT_PUBLIC_ 副本。
   */
  env: {
    NEXUS_FUSION_TRACK_GRPC_SOURCES: process.env.NEXUS_FUSION_TRACK_GRPC_SOURCES ?? "",
  },
  /** 采集上传 /api/eo-capture/collect-upload 等 multipart 可能较大（截图 PNG、录屏） */
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  /** 局域网 IP 访问 dev（HMR / webpack-hmr）时需放行，否则跨域被拦 */
  allowedDevOrigins: ["192.168.18.141"],
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        http: false,
        https: false,
        zlib: false,
      };
    }
    return config;
  },
};

export default nextConfig;

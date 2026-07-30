import path from "path";
import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8001";
const INSTRUMENTATION_NODE = path.join(__dirname, "src/instrumentation.node.ts");

const nextConfig: NextConfig = {
  /** pg/minio 含 Node 原生可选依赖，禁止打进 RSC 包 */
  serverExternalPackages: ["pg", "minio", "ws", "jpeg-js"],
  turbopack: {},
  /** 采集上传 /api/eo-capture/collect-upload 等 multipart 可能较大（截图 PNG、录屏） */
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  /** 局域网 IP 访问 dev（HMR / webpack-hmr）时需放行，否则跨域被拦 */
  allowedDevOrigins: [
    "192.168.18.141",
    "192.168.18.143",
    "localhost",
    "127.0.0.1",
  ],
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
  webpack: (config, { isServer, nextRuntime }) => {
    // Edge instrumentation must not pull Node-only startup (dgram/pg/…).
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...(config.resolve.alias as Record<string, unknown>),
        [INSTRUMENTATION_NODE]: false,
        "@/server/eo-third-party-camera-relay": false,
        "@/server/task-status-http-listener": false,
      };
    }
    if (isServer && nextRuntime === "nodejs") {
      const externals = ["pg", "pg-native", "pg-connection-string", "minio", "dgram", "ws"];
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...externals]
        : config.externals
          ? [config.externals, ...externals]
          : externals;
    }
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        stream: false,
        dgram: false,
        http: false,
        https: false,
        zlib: false,
      };
    }
    return config;
  },
};

export default nextConfig;

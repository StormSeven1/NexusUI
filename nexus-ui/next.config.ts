import type { NextConfig } from "next";

// 会话列表、聊天审批等非流式的通用后端 API。
const BACKEND_URL = process.env.BACKEND_URL ?? "http://192.168.18.141:26003";
// 流式聊天接口（AI SDK useChat 的 SSE 代理）
const CHAT_STREAM_URL = process.env.CHAT_STREAM_URL ?? "http://192.168.18.103:8000/api/v1/chat/stream";

const nextConfig: NextConfig = {
  turbopack: {},
  env: { CHAT_STREAM_URL },
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

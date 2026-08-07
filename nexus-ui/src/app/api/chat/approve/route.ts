import {
  custombackendProxyHeaders,
  resolveCustombackendBase,
} from "@/lib/server/custombackend-proxy";

export async function POST(req: Request) {
  const body = await req.json();
  const backendBase = resolveCustombackendBase();

  try {
    const res = await fetch(`${backendBase}/api/chat/approve`, {
      method: "POST",
      headers: custombackendProxyHeaders(req, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "无法连接到后端服务" }, { status: 502 });
  }
}

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8001";

export async function POST(req: Request) {
  const body = await req.json();

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "无法连接到后端服务" }, { status: 502 });
  }
}

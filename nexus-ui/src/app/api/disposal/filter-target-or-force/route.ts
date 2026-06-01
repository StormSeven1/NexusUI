type ProxyBody = {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let payload: ProxyBody;
  try {
    payload = (await req.json()) as ProxyBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const url = String(payload.url ?? "").trim();
  if (!url || !isHttpUrl(url)) {
    return Response.json({ error: "invalid target url" }, { status: 400 });
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.headers ?? {}),
      },
      body: JSON.stringify(payload.body ?? {}),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "proxy failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

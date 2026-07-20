// functions/index.ts — Statement Lens backend proxy.
//
// Keeps the LlamaParse API key server-side. The browser never sees the key;
// it only talks to this Worker, which injects Authorization before forwarding
// to LlamaCloud's v1 parsing API.

type Env = {
  DO: Fetcher;
  LLAMA_CLOUD_API_KEY: string;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const LLAMA_BASE = "https://api.cloud.llamaindex.ai/api/v1/parsing";

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

function passthrough(upstream: Response): Response {
  // Forward the upstream body back to the client, but replace CORS headers
  // with our own so the browser accepts the response.
  const headers = new Headers(upstream.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return json({ ok: true, now: new Date().toISOString() });
    }

    const key = env.LLAMA_CLOUD_API_KEY;
    if (!key) {
      return json(
        {
          error:
            "LLAMA_CLOUD_API_KEY is not configured on the server. Set it in the project envs.",
        },
        500,
      );
    }

    // POST /api/llamaparse/upload
    // Forward the multipart upload to LlamaParse with our server-side key.
    if (url.pathname === "/api/llamaparse/upload" && request.method === "POST") {
      const contentType = request.headers.get("Content-Type") ?? "multipart/form-data";
      const body = await request.arrayBuffer();
      try {
        const upstream = await fetch(`${LLAMA_BASE}/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": contentType,
          },
          body,
        });
        return passthrough(upstream);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Upstream upload failed: ${msg}` }, 502);
      }
    }

    // GET /api/llamaparse/job/:id
    // GET /api/llamaparse/job/:id/result/markdown
    const jobMatch = url.pathname.match(/^\/api\/llamaparse\/job\/([^/]+)(\/[^/]*)*$/);
    if (jobMatch && request.method === "GET") {
      const suffix = url.pathname.slice(`/api/llamaparse/job/${jobMatch[1]}`.length);
      try {
        const upstream = await fetch(`${LLAMA_BASE}/job/${jobMatch[1]}${suffix}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        return passthrough(upstream);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Upstream job fetch failed: ${msg}` }, 502);
      }
    }

    return json({ error: "not found", path: url.pathname }, 404);
  },
} satisfies ExportedHandler<Env>;

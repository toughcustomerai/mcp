// CORS for browser-hosted MCP clients (claude.ai, chatgpt.com, MCP Inspector).
//
// Browser clients can't read our 401 + WWW-Authenticate response without
// CORS headers, which means they can't follow the OAuth handshake — the
// "couldn't connect / start_error" failure mode in Claude.
//
// /mcp uses Bearer tokens (not cookies) for auth, so allowing the origin
// dynamically is safe. We mirror back the request's Origin header if it's
// on the allow-list, falling back to `*`. Allow-list is overridable via
// MCP_CORS_ALLOWED_ORIGINS (comma-separated).

const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://chatgpt.com",
  "https://chat.openai.com",
  // Local MCP Inspector
  "http://localhost:6274",
  "http://127.0.0.1:6274",
];

function allowedOrigins(): string[] {
  const env = process.env.MCP_CORS_ALLOWED_ORIGINS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ALLOWED_ORIGINS;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const list = allowedOrigins();
  const allowAll = list.includes("*");
  const allow = allowAll || list.includes(origin) ? origin || "*" : "";

  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
    "Access-Control-Expose-Headers":
      "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allow) {
    h["Access-Control-Allow-Origin"] = allow;
  }
  return h;
}

/** Build a 204 preflight response with the right CORS headers. */
export function preflightResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Apply CORS headers to an existing Response. */
export function withCors(res: Response, req: Request): Response {
  const newHeaders = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) {
    newHeaders.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

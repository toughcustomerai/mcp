// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
//
// MCP clients fetch this before calling /mcp to discover the authorization
// server they need to send the user to. The MCP server's 401 response carries
// `WWW-Authenticate: Bearer resource_metadata="<this-url>"` pointing here.
//
// Authorization Server: Supabase Auth at AUTH_BASE_URL (default
// https://auth.toughcustomer.ai). Supabase issues the tokens Claude carries.
// Salesforce is a downstream backend, not the AS — see userstories.md §2.1.

export const runtime = "nodejs";

function baseUrl(): string {
  if (process.env.MCP_PUBLIC_URL) return process.env.MCP_PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

function authBaseUrl(): string {
  return process.env.AUTH_BASE_URL ?? "https://auth.toughcustomer.ai";
}

export async function GET() {
  // Supabase publishes its RFC 8414 AS-metadata document at a non-canonical
  // path: `/.well-known/oauth-authorization-server/auth/v1` (not the RFC 8414
  // canonical `/.well-known/oauth-authorization-server`). MCP clients that
  // probe the canonical location will miss it. By including the explicit AS
  // metadata URL here, MCP clients that read this RFC 9728 doc can fetch it
  // directly without guessing.
  // OIDC discovery, by contrast, lives at the conventional path.
  return Response.json({
    resource: `${baseUrl()}/mcp`,
    authorization_servers: [authBaseUrl()],
    authorization_server_metadata: `${authBaseUrl()}/.well-known/oauth-authorization-server/auth/v1`,
    openid_configuration: `${authBaseUrl()}/auth/v1/.well-known/openid-configuration`,
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl()}/`,
    scopes_supported: [
      "roleplay:create",
      "opportunity:read",
      "voice:read",
      "scenario:read",
    ],
  });
}

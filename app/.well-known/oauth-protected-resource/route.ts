// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
//
// MCP clients fetch this before calling /mcp to discover the
// authorization server (Salesforce) they need to send the user to.
// When the MCP server returns 401 it must include a
// `WWW-Authenticate: Bearer resource_metadata="<this-url>"` header
// pointing back here.
//
// Only served when USE_SALESFORCE=true — in mock mode there's no
// auth server and Claude should not try to negotiate one.

export const runtime = "nodejs";

const SF_LOGIN_URL = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
const USE_SALESFORCE = process.env.USE_SALESFORCE === "true";

function baseUrl(): string {
  if (process.env.MCP_PUBLIC_URL) return process.env.MCP_PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

export async function GET() {
  if (!USE_SALESFORCE) {
    return new Response("Not enabled", { status: 404 });
  }
  return Response.json({
    resource: `${baseUrl()}/mcp`,
    authorization_servers: [SF_LOGIN_URL],
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl()}/`,
    scopes_supported: ["api", "refresh_token", "openid"],
  });
}

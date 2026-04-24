// Salesforce auth helpers for the MCP server.
//
// The MCP server is a resource server in OAuth 2.1 terms: it does NOT
// issue tokens. Callers (Claude) obtain a Salesforce access token by
// going through the SF Connected App OAuth flow, then hit our /mcp
// endpoint with `Authorization: Bearer <sf-token>`.
//
// Every tool handler calls getSfAuth() to verify the token and get
// the user's instance URL + identity. Verification uses SF's
// /services/oauth2/userinfo endpoint — a 200 means the token is
// valid and not revoked.
//
// A small in-memory cache avoids hitting userinfo on every tool call
// for the same token in a single warm function instance.

import { headers } from "next/headers";

export interface SfAuth {
  accessToken: string;
  instanceUrl: string;
  userId: string;
  email: string;
  organizationId: string;
  /** true when the MCP server is running in mock mode (no real SF call). */
  mock?: boolean;
}

export class TCUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TCUnauthorizedError";
  }
}

const SF_LOGIN_URL = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
const USE_SALESFORCE = process.env.USE_SALESFORCE === "true";

// Token → SfAuth cache. Keyed by token, TTL is short so revocations
// propagate quickly. Acceptable staleness window: 60s.
const TOKEN_CACHE = new Map<string, { auth: SfAuth; expiresAt: number }>();
const TOKEN_TTL_MS = 60_000;

async function extractBearer(): Promise<string | null> {
  // Next 15+: headers() is async.
  const h = await headers();
  const authz = h.get("authorization") ?? h.get("Authorization");
  if (!authz) return null;
  const m = authz.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

/**
 * Resolve the calling user's Salesforce session.
 *
 * In mock mode (USE_SALESFORCE != "true"): returns a synthetic auth
 * object so the mock service layer still works without a real token.
 *
 * In live mode: reads the Bearer token from the request, verifies it
 * against Salesforce, and returns an SfAuth the service layer can use
 * to make further SF REST calls on behalf of the user.
 *
 * Throws TCUnauthorizedError if the token is missing or invalid.
 */
export async function getSfAuth(): Promise<SfAuth> {
  if (!USE_SALESFORCE) {
    return {
      accessToken: "mock",
      instanceUrl: "https://mock.my.salesforce.com",
      userId: "005000000000000MCK",
      email: "mock.user@toughcustomer.ai",
      organizationId: "00D000000000000MCK",
      mock: true,
    };
  }

  const token = await extractBearer();
  if (!token) {
    throw new TCUnauthorizedError(
      "Missing Authorization header. Connect the MCP server via the Salesforce OAuth flow.",
    );
  }

  const cached = TOKEN_CACHE.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.auth;

  // userinfo is the cheapest way to validate a SF access token and
  // pull identity claims without knowing the instance URL ahead of time.
  const res = await fetch(`${SF_LOGIN_URL}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    throw new TCUnauthorizedError("Salesforce token is invalid, expired, or revoked.");
  }
  if (!res.ok) {
    throw new TCUnauthorizedError(`Salesforce userinfo failed: ${res.status}`);
  }

  const info = (await res.json()) as {
    sub: string;
    user_id: string;
    organization_id: string;
    email: string;
    urls: { rest: string; custom_domain?: string };
  };

  // info.urls.rest looks like:
  //   https://<instance>.my.salesforce.com/services/data/v{version}/
  // we want just the origin.
  const instanceUrl = new URL(info.urls.rest).origin;

  const auth: SfAuth = {
    accessToken: token,
    instanceUrl,
    userId: info.user_id,
    email: info.email,
    organizationId: info.organization_id,
  };

  TOKEN_CACHE.set(token, { auth, expiresAt: Date.now() + TOKEN_TTL_MS });
  return auth;
}

/** Current mode — useful for diagnostics and landing-page rendering. */
export function isSalesforceMode(): boolean {
  return USE_SALESFORCE;
}

// Auth helpers for the MCP server (Model B).
//
// Authorization Server: Supabase Auth (auth.toughcustomer.ai). Claude carries
// a Supabase-issued JWT, NOT a Salesforce token.
//
// Per-request flow:
//   1. getCallerIdentity()  — validate the Supabase JWT via Supabase's JWKS
//                             (offline; no callback to Supabase). Returns
//                             { supabaseUserId, email }.
//   2. getSfAuth()          — given the caller identity, look up the user's
//                             encrypted SF refresh token in identity_links,
//                             exchange for a fresh SF access token, return
//                             an SfAuth ready to use against SF GraphQL.
//                             Cached per supabase_user_id for 50 minutes.
//
// Mock mode (TC_MODE=mock): both helpers return synthetic values so local
// dev works without Supabase or Salesforce. Never enable in production.

import { headers } from "next/headers";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { deleteIdentityLink, loadIdentityLink } from "./identity-vault";
import { redact } from "./log-redactor";
import { isAllowed } from "./domain-allowlist";

const TC_MODE = process.env.TC_MODE ?? "live";

export function isMockMode(): boolean {
  return TC_MODE === "mock";
}

export class TCUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TCUnauthorizedError";
  }
}

export interface CallerIdentity {
  supabaseUserId: string;
  email: string;
}

export interface SfAuth {
  instanceUrl: string;
  accessToken: string;
  externalUserId: string;
  externalEmail: string;
  externalOrgId: string;
  /** true when running in TC_MODE=mock — service layer skips real SF calls. */
  mock?: boolean;
}

// ─── Supabase JWT validation (JWKS) ──────────────────────────────────────

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (jwksCache) return jwksCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new TCUnauthorizedError(
      "NEXT_PUBLIC_SUPABASE_URL is not configured.",
    );
  }
  jwksCache = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  return jwksCache;
}

async function extractBearer(): Promise<string | null> {
  const h = await headers();
  const authz = h.get("authorization") ?? h.get("Authorization");
  if (!authz) return null;
  const m = authz.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

export async function getCallerIdentity(): Promise<CallerIdentity> {
  if (isMockMode()) {
    return {
      supabaseUserId: "00000000-0000-0000-0000-000000000000",
      email: "mock.user@toughcustomer.ai",
    };
  }

  const token = await extractBearer();
  if (!token) {
    throw new TCUnauthorizedError(
      "Missing Authorization header. Sign in via Tough Customer.",
    );
  }

  // Per Supabase docs we should validate:
  //   - signature (via JWKS)
  //   - aud === "authenticated" for user-session tokens
  //   - exp (jose checks this automatically)
  //   - iss matches the project's auth base URL
  //
  // NOTE: JWKS only returns keys for projects that have migrated to
  // asymmetric "JWT Signing Keys" (RS256/ES256). Legacy HS256 projects
  // expose an EMPTY JWKS — verification will fail. If your Supabase
  // project predates JWT Signing Keys, rotate to asymmetric keys in the
  // dashboard before deploying. See docs/CUSTOM_DOMAIN.md.
  //
  // Issuer: the project URL + "/auth/v1". With a custom domain, Supabase
  // issues tokens with iss bound to the custom hostname when activated.
  // We pin to AUTH_BASE_URL so that flips correctly post-custom-domain.
  const expectedIssuer = `${process.env.AUTH_BASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJwks(), {
      audience: "authenticated",
      issuer: expectedIssuer,
    });
    payload = result.payload;
  } catch {
    throw new TCUnauthorizedError("Invalid or expired Supabase token.");
  }

  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) {
    throw new TCUnauthorizedError("Token missing sub claim.");
  }

  const email = typeof payload.email === "string" ? payload.email : "";

  // Domain allow-list (userstories.md §2.4). When MCP_ALLOWED_DOMAINS is unset
  // the gate is open. We surface this as TCUnauthorizedError for now so it
  // shows up to Claude as `isError: true`; protocol-level 403 is a v2 polish.
  if (!isAllowed(email)) {
    throw new TCUnauthorizedError(
      "Email domain not on the allow list. Contact your administrator.",
    );
  }

  return { supabaseUserId: sub, email };
}

// ─── SF access-token minting + cache ─────────────────────────────────────

interface CachedSfToken {
  sfAuth: SfAuth;
  expiresAt: number;
}

const SF_TOKEN_CACHE = new Map<string, CachedSfToken>();
// SF access tokens are typically valid 1h+. Cache 50 minutes — a bit of
// headroom under the typical TTL, and well inside the maxDuration of any
// long-running tool call.
const SF_TOKEN_TTL_MS = 50 * 60 * 1000;

async function mintSfAccessToken(supabaseUserId: string): Promise<SfAuth> {
  const link = await loadIdentityLink(supabaseUserId);
  if (!link) {
    throw new TCUnauthorizedError(
      "Salesforce is not connected. Visit /connect to link your Salesforce org.",
    );
  }

  const sfLogin = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const clientId = process.env.SF_CLIENT_ID;
  if (!clientId) {
    throw new Error("SF_CLIENT_ID is not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: link.refreshTokenPlaintext,
    client_id: clientId,
  });
  const clientSecret = process.env.SF_CLIENT_SECRET;
  if (clientSecret) body.set("client_secret", clientSecret);

  const res = await fetch(`${sfLogin}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    // invalid_grant = refresh token revoked, expired, or user disabled in SF.
    // Purge the row so the user gets a clean reconnect prompt next time.
    if (errText.includes("invalid_grant")) {
      try {
        await deleteIdentityLink(supabaseUserId);
      } catch {
        // best-effort cleanup
      }
      throw new TCUnauthorizedError(
        "Your Salesforce link is no longer valid. Reconnect at /connect.",
      );
    }
    console.error(
      "[sf-auth] refresh exchange failed",
      redact({ status: res.status, body: errText }),
    );
    throw new Error(`Salesforce token refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    instance_url?: string;
  };

  return {
    instanceUrl: json.instance_url ?? link.instanceUrl,
    accessToken: json.access_token,
    externalUserId: link.externalUserId,
    externalEmail: link.externalEmail,
    externalOrgId: link.externalOrgId,
  };
}

/**
 * Resolve the calling user's Salesforce session.
 *
 * Mock mode: returns a synthetic SfAuth so the mock service layer works
 * without Supabase or Salesforce.
 *
 * Live mode: validates the Supabase JWT, looks up the linked SF refresh
 * token, mints a fresh SF access token, and returns it. Cached per user
 * for 50 minutes.
 *
 * Throws TCUnauthorizedError if the JWT is missing/invalid, the user
 * hasn't linked Salesforce, or the SF refresh token has been revoked.
 */
export async function getSfAuth(): Promise<SfAuth> {
  if (isMockMode()) {
    return {
      instanceUrl: "https://mock.my.salesforce.com",
      accessToken: "mock",
      externalUserId: "005000000000000MCK",
      externalEmail: "mock.user@toughcustomer.ai",
      externalOrgId: "00D000000000000MCK",
      mock: true,
    };
  }

  const identity = await getCallerIdentity();
  const cached = SF_TOKEN_CACHE.get(identity.supabaseUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.sfAuth;

  const sfAuth = await mintSfAccessToken(identity.supabaseUserId);
  SF_TOKEN_CACHE.set(identity.supabaseUserId, {
    sfAuth,
    expiresAt: Date.now() + SF_TOKEN_TTL_MS,
  });
  return sfAuth;
}

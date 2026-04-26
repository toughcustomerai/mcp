// GET /connect/callback — Salesforce redirects here after the user authorizes.
//
// 1. Read the PKCE cookie (code_verifier, expected state, supabase user id).
// 2. Verify `state` matches.
// 3. Exchange `code` for {access_token, refresh_token} at SF's token endpoint.
// 4. Call SF /services/oauth2/userinfo to capture identity (sf user id, org,
//    email, instance URL).
// 5. saveIdentityLink — refresh token is envelope-encrypted before insert.
// 6. Redirect back to /connect?status=linked.
//
// SF tokens never touch the browser. The access token is discarded after
// userinfo; only the encrypted refresh token persists.

import { NextRequest, NextResponse } from "next/server";
import { saveIdentityLink } from "@/lib/identity-vault";
import { redact } from "@/lib/log-redactor";

export const runtime = "nodejs";

const PKCE_COOKIE = "tc_sf_pkce";

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

function fail(reason: string): NextResponse {
  const url = new URL("/connect", appBaseUrl());
  url.searchParams.set("status", "error");
  url.searchParams.set("reason", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete(PKCE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) return fail(error);
  if (!code || !state) return fail("missing-code-or-state");

  const cookie = req.cookies.get(PKCE_COOKIE)?.value;
  if (!cookie) return fail("pkce-cookie-missing");

  let parsed: { codeVerifier: string; state: string; supabaseUserId: string };
  try {
    parsed = JSON.parse(cookie);
  } catch {
    return fail("pkce-cookie-malformed");
  }

  if (parsed.state !== state) return fail("state-mismatch");

  const sfLogin = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET; // optional with PKCE
  if (!clientId) return fail("missing-sf-client-id");

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: `${appBaseUrl()}/connect/callback`,
    code_verifier: parsed.codeVerifier,
  });
  if (clientSecret) tokenBody.set("client_secret", clientSecret);

  const tokenRes = await fetch(`${sfLogin}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error(
      "[connect/callback] SF token exchange failed",
      redact({ status: tokenRes.status, body: text }),
    );
    return fail("sf-token-exchange-failed");
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    instance_url: string;
  };

  if (!tokenJson.refresh_token) {
    // Connected App is misconfigured — refresh_token scope wasn't granted.
    return fail("no-refresh-token");
  }

  // Fetch userinfo to capture identity. Use the access token; we discard it
  // immediately after.
  const userinfoRes = await fetch(`${sfLogin}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    cache: "no-store",
  });
  if (!userinfoRes.ok) return fail("sf-userinfo-failed");
  const info = (await userinfoRes.json()) as {
    user_id: string;
    organization_id: string;
    email: string;
    urls: { rest: string };
  };

  const instanceUrl = new URL(info.urls.rest).origin;

  await saveIdentityLink({
    supabaseUserId: parsed.supabaseUserId,
    externalUserId: info.user_id,
    externalOrgId: info.organization_id,
    externalEmail: info.email,
    refreshToken: tokenJson.refresh_token,
    instanceUrl,
  });

  const ok = NextResponse.redirect(
    new URL("/connect?status=linked", appBaseUrl()),
  );
  ok.cookies.delete(PKCE_COOKIE);
  return ok;
}

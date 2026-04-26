// POST /connect/start — kicks off the Salesforce account-link OAuth flow.
//
// Generates a PKCE code_verifier, stores it (and the user's Supabase id) in a
// short-lived signed cookie, and redirects the browser to Salesforce's
// authorize endpoint. The SF callback lands at /connect/callback.
//
// Note on architecture: userstories.md §2.2 originally specified the SF
// callback as a Supabase Edge Function at auth.toughcustomer.ai. We do it in
// this Next.js project instead so the PKCE code_verifier cookie (set on
// app.toughcustomer.ai) is readable by the callback. The security goal — SF
// token never reaches the browser, exchange happens server-side — is met
// either way.

import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseSSRClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const PKCE_COOKIE = "tc_sf_pkce";
const PKCE_TTL_SECONDS = 600; // 10 minutes

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

export async function POST() {
  const supabase = await getSupabaseSSRClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/connect", appBaseUrl()));
  }

  const sfLogin = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const clientId = process.env.SF_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/connect?status=error&reason=missing-sf-client-id", appBaseUrl()),
    );
  }

  // PKCE
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const state = b64url(randomBytes(16));

  const authorizeUrl = new URL(`${sfLogin}/services/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${appBaseUrl()}/connect/callback`);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "api refresh_token openid");
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(
    PKCE_COOKIE,
    JSON.stringify({ codeVerifier, state, supabaseUserId: user.id }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/connect",
      maxAge: PKCE_TTL_SECONDS,
    },
  );
  return res;
}

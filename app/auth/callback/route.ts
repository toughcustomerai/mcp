// GET /auth/callback — Supabase OAuth redirect target.
// Exchanges the authorization code for a Supabase session, then redirects to
// the post-signin destination (defaults to /connect).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseSSRClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/connect";

  if (!code) {
    return NextResponse.redirect(
      new URL("/connect?status=error&reason=missing-code", appBaseUrl()),
    );
  }

  const supabase = await getSupabaseSSRClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL("/connect?status=error&reason=session-exchange-failed", appBaseUrl()),
    );
  }

  return NextResponse.redirect(new URL(next, appBaseUrl()));
}

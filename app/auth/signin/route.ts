// /auth/signin — kicks off Supabase Google OAuth.
//
// Accepts both GET and POST so it can be linked from a redirect (e.g. when a
// page wants to send an unauthenticated user to sign in) AND from a form
// submit. The `next` query param (if present) survives the round-trip and
// the user lands back where they started after Google + Supabase complete.
//
// Code Hero default: Google. Email/password is opt-in.

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

async function handle(req: NextRequest): Promise<NextResponse> {
  const next = req.nextUrl.searchParams.get("next") || "/connect";
  // Build a callback URL that preserves `next` for /auth/callback to honor.
  const callbackUrl = new URL("/auth/callback", appBaseUrl());
  callbackUrl.searchParams.set("next", next);

  const supabase = await getSupabaseSSRClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl.toString() },
  });
  if (error || !data.url) {
    return NextResponse.redirect(
      new URL("/connect?status=error&reason=signin-failed", appBaseUrl()),
    );
  }
  return NextResponse.redirect(data.url);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

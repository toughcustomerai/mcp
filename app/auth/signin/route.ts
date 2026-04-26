// POST /auth/signin — kicks off Supabase Google OAuth.
// Code Hero default: Google. Email/password is opt-in.

import { NextResponse } from "next/server";
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

export async function POST() {
  const supabase = await getSupabaseSSRClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appBaseUrl()}/auth/callback?next=/connect`,
    },
  });
  if (error || !data.url) {
    return NextResponse.redirect(
      new URL("/connect?status=error&reason=signin-failed", appBaseUrl()),
    );
  }
  return NextResponse.redirect(data.url);
}

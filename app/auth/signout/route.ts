// POST /auth/signout — clears the Supabase session.

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
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/connect", appBaseUrl()));
}

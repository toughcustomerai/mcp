// POST /connect/disconnect — removes the user's Salesforce link.
//
// Best-effort revoke at SF, then deletes the local row. After this point
// any MCP call from this user will fail with "Reconnect Salesforce".

import { NextResponse } from "next/server";
import { deleteIdentityLink } from "@/lib/identity-vault";
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/connect", appBaseUrl()));
  }
  await deleteIdentityLink(user.id);
  return NextResponse.redirect(
    new URL("/connect?status=disconnected", appBaseUrl()),
  );
}

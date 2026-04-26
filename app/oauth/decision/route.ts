// POST /oauth/decision — receives the approve/deny submit from /oauth/consent.
//
// Calls the Supabase SDK to record the decision and gets back a redirect_url
// pointing at the OAuth client's registered redirect_uri (with `code` and
// `state` on approve, or `error=access_denied` on deny). We bounce there.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseSSRClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const authorizationId = form.get("authorization_id");
  const decision = form.get("decision");

  if (typeof authorizationId !== "string" || !authorizationId) {
    return NextResponse.json({ error: "missing authorization_id" }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "deny") {
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  }

  const supabase = await getSupabaseSSRClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const fn =
    decision === "approve"
      ? supabase.auth.oauth.approveAuthorization
      : supabase.auth.oauth.denyAuthorization;

  const res = await fn(authorizationId, { skipBrowserRedirect: true });
  if (res.error || !res.data?.redirect_url) {
    return NextResponse.json(
      { error: res.error?.message ?? "decision failed" },
      { status: 500 },
    );
  }
  return NextResponse.redirect(res.data.redirect_url, 303);
}

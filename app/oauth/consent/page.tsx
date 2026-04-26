// Supabase OAuth 2.1 Server consent screen.
//
// Supabase redirects users here at `${SITE_URL}/oauth/consent?authorization_id=...`
// during the authorize flow. We:
//   1. Verify the user is signed in to Supabase (redirect to /auth/signin if not).
//   2. Fetch the authorization details via SDK (which returns either the consent
//      payload OR an immediate-redirect if the user already consented).
//   3. Render approve/deny against /oauth/decision.

import { redirect } from "next/navigation";
import { getSupabaseSSRClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchParams {
  authorization_id?: string;
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const authorizationId = params.authorization_id;

  if (!authorizationId) {
    return (
      <Page>
        <h1>Missing authorization request</h1>
        <p>This page expects an <code>authorization_id</code> query parameter.</p>
      </Page>
    );
  }

  const supabase = await getSupabaseSSRClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Preserve the consent URL so we come back here after sign-in.
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/auth/signin?next=${encodeURIComponent(next)}`);
  }

  // Fetch details. Response is one of:
  //   { authorization_id, client, scope, redirect_uri, user }   → render consent
  //   { redirect_url }                                          → user already consented; bounce
  // The SDK does not auto-redirect from this method.
  const detailsRes = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsRes.error || !detailsRes.data) {
    return (
      <Page>
        <h1>Authorization request failed</h1>
        <p style={muted}>{detailsRes.error?.message ?? "No data returned."}</p>
      </Page>
    );
  }

  const data = detailsRes.data as
    | { authorization_id: string; client: { name?: string; client_name?: string }; scope: string; redirect_uri: string }
    | { redirect_url: string };

  if ("redirect_url" in data) {
    redirect(data.redirect_url);
  }

  const clientName = data.client?.name ?? data.client?.client_name ?? "Unknown app";
  const scopes = data.scope.split(/\s+/).filter(Boolean);

  return (
    <Page>
      <h1>Authorize {clientName}</h1>
      <p style={muted}>
        signed in as <strong>{user.email}</strong>
      </p>

      <p>
        <strong>{clientName}</strong> wants to access your Tough Customer
        account with the permissions below.
      </p>

      <ul style={scopeList}>
        {scopes.map((s) => (
          <li key={s}>
            <code>{s}</code> — <ScopeDescription scope={s} />
          </li>
        ))}
      </ul>

      <p style={muted}>
        After approval, you'll be redirected to: <code>{data.redirect_uri}</code>
      </p>

      <form action="/oauth/decision" method="POST" style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <button type="submit" name="decision" value="approve" style={primaryBtn}>
          Approve
        </button>
        <button type="submit" name="decision" value="deny" style={secondaryBtn}>
          Deny
        </button>
      </form>
    </Page>
  );
}

function ScopeDescription({ scope }: { scope: string }) {
  // Map our product scopes to plain-English descriptions. Unknown scopes
  // render verbatim — Supabase always passes the raw name.
  const map: Record<string, string> = {
    "roleplay:create": "create new Tough Customer roleplay sessions on your behalf",
    "opportunity:read": "read your Salesforce opportunities and contacts",
    "voice:read": "list available roleplay voices",
    "scenario:read": "list available roleplay scenarios",
    openid: "verify your Tough Customer identity",
    email: "see your email address",
    profile: "see your basic profile",
  };
  return <>{map[scope] ?? "scope description not available"}</>;
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: "3rem auto",
        padding: "0 1rem",
        lineHeight: 1.55,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {children}
    </main>
  );
}

const muted: React.CSSProperties = { color: "#666", fontSize: 14 };
const scopeList: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: "0.75rem 1.25rem",
  background: "rgba(0,0,0,0.02)",
};
const primaryBtn: React.CSSProperties = {
  padding: "0.6rem 1.2rem",
  borderRadius: 6,
  border: "1px solid #06f",
  background: "#06f",
  color: "white",
  cursor: "pointer",
  fontSize: 15,
};
const secondaryBtn: React.CSSProperties = {
  padding: "0.6rem 1.2rem",
  borderRadius: 6,
  border: "1px solid #999",
  background: "white",
  color: "#333",
  cursor: "pointer",
  fontSize: 15,
};

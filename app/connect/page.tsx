// app.toughcustomer.ai/connect — Salesforce account-linking UI.
//
// Three states:
//   1. Not signed in to Supabase     → "Sign in" button (Google OAuth).
//   2. Signed in, no SF link         → "Connect Salesforce" button.
//   3. Signed in, linked             → "Connected as <email> in org <id>" + Disconnect.
//
// All work happens server-side. The browser never sees a Salesforce token.

import Link from "next/link";
import { getSupabaseSSRClient, getSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LinkRow {
  external_email: string;
  created_at: string;
}

async function loadLinkSummary(supabaseUserId: string): Promise<LinkRow | null> {
  const svc = getSupabaseServiceClient();
  const { data, error } = await svc
    .from("identity_links")
    .select("external_email, created_at")
    .eq("supabase_user_id", supabaseUserId)
    .eq("provider", "salesforce")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getSupabaseSSRClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main style={pageStyle}>
      <h1>Connect Salesforce</h1>
      <p style={lead}>
        Tough Customer needs a one-time link to your Salesforce account. After
        linking, your AI assistant can run roleplays using your real
        opportunities and contacts — Salesforce&apos;s sharing rules and
        field-level security stay in force the whole time.
      </p>

      {params.status === "linked" && (
        <Banner kind="ok">Salesforce connected.</Banner>
      )}
      {params.status === "disconnected" && (
        <Banner kind="ok">Salesforce link removed.</Banner>
      )}
      {params.status === "error" && (
        <Banner kind="err">
          Couldn&apos;t link your Salesforce account. Try again — if it keeps
          failing, contact your administrator.
        </Banner>
      )}

      {!user ? <SignedOut /> : <SignedIn supabaseUserId={user.id} />}

      <hr style={{ margin: "2rem 0", border: 0, borderTop: "1px solid #ddd" }} />
      <p style={{ fontSize: 13, color: "#666" }}>
        Your Salesforce credentials are encrypted at rest and never sent to the
        AI client. <Link href="/">Back to home</Link>.
      </p>
    </main>
  );
}

function SignedOut() {
  return (
    <section>
      <p>Sign in to Tough Customer first:</p>
      <form action="/auth/signin" method="post">
        <button type="submit" style={primaryBtn}>
          Sign in with Google
        </button>
      </form>
    </section>
  );
}

async function SignedIn({ supabaseUserId }: { supabaseUserId: string }) {
  const link = await loadLinkSummary(supabaseUserId);

  if (!link) {
    return (
      <section>
        <p>You&apos;re signed in. Now connect Salesforce:</p>
        <form action="/connect/start" method="post">
          <button type="submit" style={primaryBtn}>
            Connect Salesforce
          </button>
        </form>
      </section>
    );
  }

  return (
    <section>
      <p>
        <strong>Connected as</strong> {link.external_email}
        <br />
        <small style={{ color: "#666" }}>
          linked {new Date(link.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </small>
      </p>
      <form action="/connect/disconnect" method="post">
        <button type="submit" style={dangerBtn}>
          Disconnect Salesforce
        </button>
      </form>
    </section>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  const bg = kind === "ok" ? "rgba(0,170,0,.08)" : "rgba(187,0,0,.08)";
  const border = kind === "ok" ? "#0a0" : "#b00";
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        border: `1px solid ${border}`,
        borderRadius: 6,
        background: bg,
        margin: "1rem 0",
      }}
    >
      {children}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: "3rem auto",
  padding: "0 1rem",
  lineHeight: 1.6,
  fontFamily: "system-ui, sans-serif",
};
const lead: React.CSSProperties = { color: "#333" };
const primaryBtn: React.CSSProperties = {
  padding: "0.6rem 1rem",
  borderRadius: 6,
  border: "1px solid #06f",
  background: "#06f",
  color: "white",
  cursor: "pointer",
  fontSize: 15,
};
const dangerBtn: React.CSSProperties = {
  padding: "0.5rem 0.9rem",
  borderRadius: 6,
  border: "1px solid #b00",
  background: "white",
  color: "#b00",
  cursor: "pointer",
  fontSize: 14,
};

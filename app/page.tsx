import Link from "next/link";
import { isMockMode } from "@/lib/sf-auth";

export default function Home() {
  const mock = isMockMode();
  return (
    <main style={{ maxWidth: 760, margin: "3rem auto", padding: "0 1rem", lineHeight: 1.6 }}>
      <h1>Tough Customer MCP</h1>
      <p>
        Model Context Protocol server exposing the Tough Customer roleplay setup
        workflow (opportunities → contacts → voices → scenarios → session) to LLMs.
      </p>
      <p>
        MCP endpoint: <code>/mcp</code>
      </p>
      <div
        style={{
          padding: "0.75rem 1rem",
          border: "1px solid",
          borderColor: mock ? "#b00" : "#0a0",
          borderRadius: 6,
          background: mock ? "rgba(187,0,0,.06)" : "rgba(0,170,0,.06)",
          margin: "1rem 0",
        }}
      >
        <strong>Mode: {mock ? "Mock (demo — no auth)" : "Live (Supabase auth)"}</strong>
        <br />
        {mock ? (
          <>
            Returns in-memory demo data to any caller. Do not connect real
            customers. Set <code>TC_MODE=live</code> (or unset) to enable
            production auth.
          </>
        ) : (
          <>
            Authorization Server: <strong>Supabase Auth</strong>. Claude carries
            a Supabase-issued JWT, never a Salesforce token. Salesforce is
            connected at <Link href="/connect">/connect</Link> (one-time per
            user); the MCP server holds an encrypted refresh token and mints
            short-lived SF access tokens per request.
          </>
        )}
      </div>
      <h2>Resources</h2>
      <ul>
        <li><code>toughcustomer://opportunities</code></li>
        <li><code>toughcustomer://scenarios</code></li>
        <li><code>toughcustomer://voices</code></li>
      </ul>
      <h2>Tools</h2>
      <ul>
        <li><code>list_opportunities</code></li>
        <li><code>list_voices</code></li>
        <li><code>list_scenarios</code></li>
        <li><code>get_opportunity_contacts</code></li>
        <li><code>create_roleplay_session</code></li>
      </ul>
      <h2>Prompts</h2>
      <ul>
        <li><code>setup_sales_roleplay</code></li>
      </ul>
      <p>
        Backend dispatch lives in <code>lib/tc-service.ts</code>. Salesforce
        implementation is in <code>lib/tc-salesforce.ts</code> via
        <code>lib/sf-graphql.ts</code> — no Apex deploy required. The custom
        objects + fields the SF admin must create are documented in
        <code>docs/SALESFORCE_OBJECTS.md</code>. Auth model: see
        <code>userstories.md</code> §2.1 (Model B).
      </p>
    </main>
  );
}

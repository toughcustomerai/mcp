import { isSalesforceMode } from "@/lib/sf-auth";

export default function Home() {
  const sf = isSalesforceMode();
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
          borderColor: sf ? "#0a0" : "#b00",
          borderRadius: 6,
          background: sf ? "rgba(0,170,0,.06)" : "rgba(187,0,0,.06)",
          margin: "1rem 0",
        }}
      >
        <strong>Mode: {sf ? "Salesforce (production auth)" : "Mock (demo — no auth)"}</strong>
        <br />
        {sf ? (
          <>
            Every request must carry <code>Authorization: Bearer &lt;sf-token&gt;</code>. Identity
            comes from Salesforce; SOQL runs with <code>WITH USER_MODE</code>.
          </>
        ) : (
          <>
            Returns in-memory demo data to any caller. Do not connect real customers.{" "}
            Set <code>USE_SALESFORCE=true</code> to enable production auth.
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
        Backend dispatch lives in <code>lib/tc-service.ts</code>. Salesforce implementation is in{" "}
        <code>lib/tc-salesforce.ts</code>; the Apex REST classes you need to deploy are documented in{" "}
        <code>APEX.md</code>.
      </p>
    </main>
  );
}

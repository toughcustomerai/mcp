import Link from "next/link";
import { isMockMode } from "@/lib/sf-auth";

export default function Home() {
  const mock = isMockMode();
  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: ".25rem" }}>Tough Customer</h1>
      <p style={tagline}>
        Live sales roleplays with an AI buyer, configured from your Salesforce
        data.
      </p>

      {mock && (
        <div style={mockBanner}>
          <strong>Demo mode</strong> — this server is serving sample data, not
          real Salesforce records. Don&apos;t connect production accounts.
        </div>
      )}

      <section style={section}>
        <h2 style={h2}>How it works</h2>
        <ol style={list}>
          <li>
            <Link href="/connect">Connect your Salesforce account</Link>{" "}
            (one-time, takes 30 seconds).
          </li>
          <li>
            Add this server as a custom connector in Claude (or another
            MCP-compatible AI client).
          </li>
          <li>
            Ask the AI to set up a roleplay on any of your opportunities — pick
            a deal, optionally a contact / scenario / voice, and click the
            launch URL.
          </li>
        </ol>
      </section>

      <section style={section}>
        <h2 style={h2}>What the AI can do for you</h2>
        <ul style={list}>
          <li>Browse your sales opportunities</li>
          <li>Pick a buyer (real contact on the deal)</li>
          <li>Choose a roleplay scenario from your team&apos;s library</li>
          <li>Pick a voice for the AI buyer (or let the system choose)</li>
          <li>Launch a live conversation with full deal context loaded</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>Your data</h2>
        <p style={{ color: "#444" }}>
          Salesforce&apos;s sharing rules and field-level security stay in
          force the entire time — the AI only sees what you would see. Your
          Salesforce credentials are encrypted at rest and never sent to the
          AI client.
        </p>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: "3rem auto",
  padding: "0 1rem",
  lineHeight: 1.6,
  fontFamily: "system-ui, sans-serif",
  color: "#222",
};
const tagline: React.CSSProperties = {
  color: "#555",
  fontSize: 17,
  marginTop: 0,
  marginBottom: "2rem",
};
const section: React.CSSProperties = { marginTop: "2rem" };
const h2: React.CSSProperties = { fontSize: "1.1rem", marginBottom: ".5rem" };
const list: React.CSSProperties = { paddingLeft: "1.25rem", margin: 0 };
const mockBanner: React.CSSProperties = {
  padding: "0.75rem 1rem",
  border: "1px solid #b00",
  borderRadius: 6,
  background: "rgba(187,0,0,.06)",
  margin: "1rem 0",
  fontSize: 14,
};

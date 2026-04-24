// Mock Tough Customer backend. Swap these functions for real API calls later.
//
// Each exported function is intentionally async so the real implementation
// (HTTP fetch, etc.) can slot in without touching the MCP route handler.

export interface Opportunity {
  id: string;
  name: string;
  stage: string;
  amount: number;
}

export interface Contact {
  id: string;
  opportunityId: string;
  name: string;
  title: string;
}

export interface Voice {
  id: string;
  name: string;
  gender: "male" | "female" | "neutral";
  description: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
}

export interface CreateSessionInput {
  userEmail: string;
  opportunityId: string;
  contactId: string;
  voiceId: string;
  scenarioId: string;
  backstory?: string;
}

export class TCUnauthorizedError extends Error {
  constructor(email: string) {
    super(`User not authorized: ${email}`);
    this.name = "TCUnauthorizedError";
  }
}

// RLS/RBAC stub. Replace with a real Supabase JWT / API check later.
// For now we just require a syntactically valid email so every tool
// carries identity that the backend can key off of.
function requireUser(userEmail: string): string {
  const email = (userEmail ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TCUnauthorizedError(userEmail || "<missing>");
  }
  return email;
}

export interface RoleplaySession {
  id: string;
  url: string;
  createdAt: string;
  dealContext: {
    opportunity: Opportunity;
    contact: Contact;
    voice: Voice;
    scenario: Scenario;
    backstory?: string;
  };
}

export class TCNotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = "TCNotFoundError";
  }
}

const OPPORTUNITIES: Opportunity[] = [
  { id: "opp_globaltech_platform", name: "GlobalTech - Platform Modernization", stage: "Discovery", amount: 250_000 },
  { id: "opp_acme_expansion", name: "Acme Corp - Regional Expansion", stage: "Proposal", amount: 120_000 },
  { id: "opp_finedge_renewal", name: "FinEdge - Renewal + Upsell", stage: "Negotiation", amount: 80_000 },
  { id: "opp_northwind_pilot", name: "Northwind - Security Pilot", stage: "Qualification", amount: 45_000 },
];

const CONTACTS: Contact[] = [
  { id: "ct_james_wilson", opportunityId: "opp_globaltech_platform", name: "James Wilson", title: "VP Engineering" },
  { id: "ct_priya_rao", opportunityId: "opp_globaltech_platform", name: "Priya Rao", title: "Director of Platform" },
  { id: "ct_dan_chen", opportunityId: "opp_globaltech_platform", name: "Dan Chen", title: "CTO" },
  { id: "ct_maria_gomez", opportunityId: "opp_acme_expansion", name: "Maria Gomez", title: "VP Sales Ops" },
  { id: "ct_omar_patel", opportunityId: "opp_acme_expansion", name: "Omar Patel", title: "Regional Director" },
  { id: "ct_sarah_lin", opportunityId: "opp_finedge_renewal", name: "Sarah Lin", title: "Head of Procurement" },
  { id: "ct_tom_becker", opportunityId: "opp_northwind_pilot", name: "Tom Becker", title: "CISO" },
];

const VOICES: Voice[] = [
  { id: "voice_charon", name: "Charon", gender: "male", description: "Deep, measured — seasoned executive feel." },
  { id: "voice_orion", name: "Orion", gender: "male", description: "Direct, confident — no-nonsense buyer." },
  { id: "voice_lyra", name: "Lyra", gender: "female", description: "Warm, energetic — curious champion." },
  { id: "voice_nova", name: "Nova", gender: "female", description: "Crisp, precise — analytical evaluator." },
  { id: "voice_atlas", name: "Atlas", gender: "neutral", description: "Even, neutral — procurement-style." },
];

const SCENARIOS: Scenario[] = [
  { id: "scn_enterprise_discovery", name: "Enterprise Discovery", description: "Cold discovery with a technical buyer at a large org." },
  { id: "scn_pricing_negotiation", name: "Pricing Negotiation", description: "Late-stage push-back on pricing and terms." },
  { id: "scn_competitive_bakeoff", name: "Competitive Bake-off", description: "Evaluation vs. an incumbent; must differentiate." },
  { id: "scn_renewal_pushback", name: "Renewal Pushback", description: "Existing customer questioning value at renewal." },
  { id: "scn_champion_building", name: "Champion Building", description: "Coach an internal champion to build the business case." },
];

export async function listOpportunities(userEmail: string): Promise<Opportunity[]> {
  requireUser(userEmail);
  // TODO: filter by userEmail via RLS / owner lookup.
  return OPPORTUNITIES;
}

export async function listScenarios(userEmail: string): Promise<Scenario[]> {
  requireUser(userEmail);
  return SCENARIOS;
}

export async function listVoices(userEmail: string): Promise<Voice[]> {
  requireUser(userEmail);
  return VOICES;
}

export async function getOpportunityContacts(
  userEmail: string,
  opportunityId: string,
): Promise<Contact[]> {
  requireUser(userEmail);
  if (!OPPORTUNITIES.some((o) => o.id === opportunityId)) {
    throw new TCNotFoundError("Opportunity", opportunityId);
  }
  return CONTACTS.filter((c) => c.opportunityId === opportunityId);
}

export async function createRoleplaySession(input: CreateSessionInput): Promise<RoleplaySession> {
  requireUser(input.userEmail);
  const opportunity = OPPORTUNITIES.find((o) => o.id === input.opportunityId);
  if (!opportunity) throw new TCNotFoundError("Opportunity", input.opportunityId);

  const contact = CONTACTS.find(
    (c) => c.id === input.contactId && c.opportunityId === input.opportunityId,
  );
  if (!contact)
    throw new TCNotFoundError(
      `Contact for opportunity ${input.opportunityId}`,
      input.contactId,
    );

  const voice = VOICES.find((v) => v.id === input.voiceId);
  if (!voice) throw new TCNotFoundError("Voice", input.voiceId);

  const scenario = SCENARIOS.find((s) => s.id === input.scenarioId);
  if (!scenario) throw new TCNotFoundError("Scenario", input.scenarioId);

  const id =
    "sess_" +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 8);

  return {
    id,
    url: `https://www.toughcustomer.ai/session/${id}`,
    createdAt: new Date().toISOString(),
    dealContext: {
      opportunity,
      contact,
      voice,
      scenario,
      backstory: input.backstory,
    },
  };
}

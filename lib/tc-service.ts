// Tough Customer service layer.
//
// Two backends:
//   1. Mock (TC_MODE=mock): returns in-memory sample data. Good for local
//      dev and connector smoke tests. getSfAuth() returns a synthetic auth
//      with `mock: true`.
//   2. Salesforce (default): the caller's Supabase identity is resolved,
//      their stored SF refresh token is exchanged for a fresh access token,
//      and Salesforce REST GraphQL API is called as that SF user. GraphQL
//      enforces FLS + sharing for all profiles (including admins) — same
//      guarantee `WITH USER_MODE` gives in Apex, without an Apex deploy.
//
// Every function takes an SfAuth as its first argument. We dispatch on
// `auth.mock` alone — the caller's authentication path is what determines
// which backend runs.

import { SfAuth } from "./sf-auth";
import {
  createRoleplaySessionSF,
  getOpportunityContactsSF,
  listOpportunitiesSF,
  listScenariosSF,
  listVoicesSF,
} from "./tc-salesforce";

export { TCUnauthorizedError } from "./sf-auth";

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
  opportunityId: string;
  contactId: string;
  voiceId: string;
  scenarioId: string;
  backstory?: string;
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

// ─── Mock data ──────────────────────────────────────────────────────────

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

// ─── Mock implementations ───────────────────────────────────────────────

async function listOpportunitiesMock(_auth: SfAuth): Promise<Opportunity[]> {
  return OPPORTUNITIES;
}

async function listScenariosMock(_auth: SfAuth): Promise<Scenario[]> {
  return SCENARIOS;
}

async function listVoicesMock(_auth: SfAuth): Promise<Voice[]> {
  return VOICES;
}

async function getOpportunityContactsMock(
  _auth: SfAuth,
  opportunityId: string,
): Promise<Contact[]> {
  if (!OPPORTUNITIES.some((o) => o.id === opportunityId)) {
    throw new TCNotFoundError("Opportunity", opportunityId);
  }
  return CONTACTS.filter((c) => c.opportunityId === opportunityId);
}

async function createRoleplaySessionMock(
  _auth: SfAuth,
  input: CreateSessionInput,
): Promise<RoleplaySession> {
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

// ─── Public dispatcher ──────────────────────────────────────────────────

export async function listOpportunities(auth: SfAuth): Promise<Opportunity[]> {
  return auth.mock ? listOpportunitiesMock(auth) : listOpportunitiesSF(auth);
}

export async function listScenarios(auth: SfAuth): Promise<Scenario[]> {
  return auth.mock ? listScenariosMock(auth) : listScenariosSF(auth);
}

export async function listVoices(auth: SfAuth): Promise<Voice[]> {
  return auth.mock ? listVoicesMock(auth) : listVoicesSF(auth);
}

export async function getOpportunityContacts(
  auth: SfAuth,
  opportunityId: string,
): Promise<Contact[]> {
  return auth.mock
    ? getOpportunityContactsMock(auth, opportunityId)
    : getOpportunityContactsSF(auth, opportunityId);
}

export async function createRoleplaySession(
  auth: SfAuth,
  input: CreateSessionInput,
): Promise<RoleplaySession> {
  return auth.mock
    ? createRoleplaySessionMock(auth, input)
    : createRoleplaySessionSF(auth, input);
}

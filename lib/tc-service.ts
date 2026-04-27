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
  /** Account.Name (Salesforce). Optional — not all callers need it. */
  accountName?: string;
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

export type VoiceGender = "male" | "female" | "any";

export interface CreateSessionInput {
  /** Required — the only thing the launch URL needs. */
  opportunityId: string;
  /**
   * Optional. When provided, the server validates the contact is on the
   * opportunity and includes it in dealContext for Claude's coaching.
   * Otherwise it's skipped — the LWC picks a contact at session start.
   */
  contactId?: string;
  /**
   * Optional. When provided, the server resolves the Scenario__c and
   * includes it in dealContext. Otherwise the LWC picks one client-side.
   */
  scenarioId?: string;
  /**
   * Specific voice from the catalog (power-user path). When set, the
   * server resolves the Voice and includes it in dealContext.
   */
  voiceId?: string;
  /**
   * Gender preference. The LWC picks a concrete voice from the matching
   * subset of lib/voices.ts at session start. Mutually exclusive with
   * voiceId; if both, voiceId wins.
   */
  voiceGender?: VoiceGender;
  /** Optional free-text context for the AI buyer. */
  backstory?: string;
}

export interface RoleplaySession {
  id: string;
  url: string;
  createdAt: string;
  dealContext: {
    /** Always present — the launch URL is keyed on the opportunity. */
    opportunity: Opportunity;
    /** Present only when the caller passed contactId. */
    contact?: Contact;
    /** Present only when the caller passed voiceId. */
    voice?: Voice;
    /** Present only when the caller passed voiceGender (and not voiceId). */
    voicePreference?: { gender: VoiceGender; description: string };
    /** Present only when the caller passed scenarioId. */
    scenario?: Scenario;
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

// Mock opportunity / contact / scenario data used in TC_MODE=mock.
// Voices are shared with live mode (see lib/voices.ts) — they're not a SF
// object in this org per docs/SALESFORCE_OBJECTS.md.

import { VOICES as REAL_VOICES, findVoice } from "./voices";

const OPPORTUNITIES: Opportunity[] = [
  { id: "opp_globaltech_platform", name: "Platform Modernization", accountName: "GlobalTech", stage: "Discovery", amount: 250_000 },
  { id: "opp_acme_expansion", name: "Regional Expansion", accountName: "Acme Corp", stage: "Proposal", amount: 120_000 },
  { id: "opp_finedge_renewal", name: "Renewal + Upsell", accountName: "FinEdge", stage: "Negotiation", amount: 80_000 },
  { id: "opp_northwind_pilot", name: "Security Pilot", accountName: "Northwind", stage: "Qualification", amount: 45_000 },
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

// Voices: same hardcoded list as live mode — see lib/voices.ts.
const VOICES = REAL_VOICES;

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

  // Optional context — validate only if provided.
  let contact: Contact | undefined;
  if (input.contactId) {
    contact = CONTACTS.find(
      (c) =>
        c.id === input.contactId && c.opportunityId === input.opportunityId,
    );
    if (!contact) {
      throw new TCNotFoundError(
        `Contact for opportunity ${input.opportunityId}`,
        input.contactId,
      );
    }
  }

  let voice: Voice | undefined;
  let voicePreference: { gender: VoiceGender; description: string } | undefined;
  if (input.voiceId) {
    voice = findVoice(input.voiceId);
    if (!voice) throw new TCNotFoundError("Voice", input.voiceId);
  } else if (input.voiceGender) {
    voicePreference = {
      gender: input.voiceGender,
      description: "AI-picked voice (gender preference)",
    };
  }

  let scenario: Scenario | undefined;
  if (input.scenarioId) {
    scenario = SCENARIOS.find((s) => s.id === input.scenarioId);
    if (!scenario) throw new TCNotFoundError("Scenario", input.scenarioId);
  }

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
      ...(contact ? { contact } : {}),
      ...(voice ? { voice } : {}),
      ...(voicePreference ? { voicePreference } : {}),
      ...(scenario ? { scenario } : {}),
      ...(input.backstory ? { backstory: input.backstory } : {}),
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

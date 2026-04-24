// Salesforce-backed implementation of the Tough Customer service layer.
//
// Every function takes an SfAuth — the verified session of the calling
// user — and hits Salesforce Apex REST endpoints that wrap the real
// SOQL queries with `WITH USER_MODE`. See APEX.md for the Apex class
// you must deploy to Salesforce before flipping USE_SALESFORCE=true.
//
// Why Apex REST and not plain SOQL /query?
//   `WITH USER_MODE` enforces FLS + sharing even for admin profiles.
//   Plain REST /query enforces sharing always but only enforces FLS
//   for non-admins. If a CRM admin ever uses the MCP server, they
//   would otherwise see fields the business considers restricted.
//
// API versions are pinned. Bump intentionally.

import type {
  Contact,
  CreateSessionInput,
  Opportunity,
  RoleplaySession,
  Scenario,
  Voice,
} from "./tc-service";
import { SfAuth, TCUnauthorizedError } from "./sf-auth";

const SF_API_VERSION = process.env.SF_API_VERSION ?? "v62.0";
const APEX_BASE = "/services/apexrest/tc";

async function sfGet<T>(auth: SfAuth, path: string): Promise<T> {
  const res = await fetch(`${auth.instanceUrl}${path}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new TCUnauthorizedError("Salesforce rejected the request (token or permission issue).");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Salesforce ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function sfPost<T, B>(auth: SfAuth, path: string, body: B): Promise<T> {
  const res = await fetch(`${auth.instanceUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new TCUnauthorizedError("Salesforce rejected the request (token or permission issue).");
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Salesforce ${res.status} ${res.statusText}: ${errBody.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function listOpportunitiesSF(auth: SfAuth): Promise<Opportunity[]> {
  return sfGet<Opportunity[]>(auth, `${APEX_BASE}/opportunities`);
}

export async function getOpportunityContactsSF(
  auth: SfAuth,
  opportunityId: string,
): Promise<Contact[]> {
  // Defence in depth — Apex already validates, but don't feed raw args into URLs.
  if (!/^[a-zA-Z0-9]{15,18}$/.test(opportunityId)) {
    throw new Error(`Invalid Salesforce Opportunity Id: ${opportunityId}`);
  }
  return sfGet<Contact[]>(
    auth,
    `${APEX_BASE}/opportunities/${encodeURIComponent(opportunityId)}/contacts`,
  );
}

// Voices and scenarios are product metadata, not CRM data. You have
// two options:
//   (a) Store them in a Salesforce custom metadata type / custom
//       object and return via Apex REST (recommended for one source
//       of truth + admin ergonomics).
//   (b) Keep them in the MCP server as a static list.
// This file assumes (a). If you choose (b), delete these and leave
// the mock implementations in lib/tc-service.ts active.

export async function listVoicesSF(auth: SfAuth): Promise<Voice[]> {
  return sfGet<Voice[]>(auth, `${APEX_BASE}/voices`);
}

export async function listScenariosSF(auth: SfAuth): Promise<Scenario[]> {
  return sfGet<Scenario[]>(auth, `${APEX_BASE}/scenarios`);
}

export async function createRoleplaySessionSF(
  auth: SfAuth,
  input: CreateSessionInput,
): Promise<RoleplaySession> {
  return sfPost<RoleplaySession, CreateSessionInput>(
    auth,
    `${APEX_BASE}/sessions`,
    input,
  );
}

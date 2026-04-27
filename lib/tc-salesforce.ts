// Salesforce-backed implementation of the Tough Customer service layer.
//
// Talks to the real tc5 dev-org schema via Salesforce REST GraphQL API.
// GraphQL enforces FLS + sharing for ALL profiles (admins included), giving
// us the same security guarantee Apex `WITH USER_MODE` would, with no Apex
// deploy. See docs/SALESFORCE_OBJECTS.md for the schema we query.
//
// Schema highlights (relative to the obsolete prototype):
//   - There is NO Tough_Customer__c filter on Opportunity. We list whatever
//     opportunities the calling user can see under sharing rules.
//   - There is NO Roleplay_Voice__c. Voices are hardcoded — see lib/voices.ts.
//   - Scenarios live in Scenario__c (Name + Description__c).
//   - "Creating a roleplay session" actually creates a ScenarioAssignment__c
//     row owned by the caller.

import {
  TCNotFoundError,
  type Contact,
  type CreateSessionInput,
  type Opportunity,
  type RoleplaySession,
  type Scenario,
  type Voice,
  type VoiceGender,
} from "./tc-service";
import { type SfAuth } from "./sf-auth";
import { sfGraphQL, val } from "./sf-graphql";
import { VOICES, findVoice } from "./voices";

// ─── Type aliases for raw GraphQL response shapes ────────────────────────

interface GqlNode<T> {
  edges: Array<{ node: T }>;
}
type GqlString = { value: string | null } | null;
type GqlNumber = { value: number | null } | null;

// ─── list_opportunities ─────────────────────────────────────────────────

interface OppNode {
  Id: string;
  Name: GqlString;
  StageName: GqlString;
  Amount: GqlNumber;
  Account: { Name: GqlString } | null;
}

export async function listOpportunitiesSF(auth: SfAuth): Promise<Opportunity[]> {
  // No "Tough_Customer__c" flag in this org — return what the user can see,
  // ordered most-recently-modified first. SF GraphQL enforces sharing.
  const data = await sfGraphQL<{
    uiapi: { query: { Opportunity: GqlNode<OppNode> } };
  }>(
    auth,
    /* GraphQL */ `
      query ListOpportunities {
        uiapi {
          query {
            Opportunity(
              orderBy: { LastModifiedDate: { order: DESC } }
              first: 50
            ) {
              edges {
                node {
                  Id
                  Name { value }
                  StageName { value }
                  Amount { value }
                  Account {
                    Name { value }
                  }
                }
              }
            }
          }
        }
      }
    `,
  );

  return data.uiapi.query.Opportunity.edges.map(({ node }) => ({
    id: node.Id,
    name: val(node.Name) ?? "",
    accountName: val(node.Account?.Name ?? null) ?? undefined,
    stage: val(node.StageName) ?? "",
    amount: val(node.Amount) ?? 0,
  }));
}

// ─── get_opportunity_contacts ───────────────────────────────────────────
//
// Uses OpportunityContactRole (the standard junction). FLS is enforced by
// GraphQL — a user only sees roles whose Contact they have access to.

interface OcrNode {
  Id: string;
  ContactId: GqlString;
  Role: GqlString;
  IsPrimary: { value: boolean | null } | null;
  Contact: {
    Id: string;
    Name: GqlString;
    Title: GqlString;
  } | null;
}

export async function getOpportunityContactsSF(
  auth: SfAuth,
  opportunityId: string,
): Promise<Contact[]> {
  if (!/^[a-zA-Z0-9]{15,18}$/.test(opportunityId)) {
    throw new Error(`Invalid Salesforce Opportunity Id: ${opportunityId}`);
  }

  const data = await sfGraphQL<{
    uiapi: {
      query: {
        Opportunity: GqlNode<{ Id: string }>;
        OpportunityContactRole: GqlNode<OcrNode>;
      };
    };
  }>(
    auth,
    /* GraphQL */ `
      query OppContacts($oppId: ID!) {
        uiapi {
          query {
            Opportunity(where: { Id: { eq: $oppId } }, first: 1) {
              edges { node { Id } }
            }
            OpportunityContactRole(
              where: { OpportunityId: { eq: $oppId } }
              first: 200
            ) {
              edges {
                node {
                  Id
                  ContactId { value }
                  Role { value }
                  IsPrimary { value }
                  Contact {
                    Id
                    Name { value }
                    Title { value }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { oppId: opportunityId },
  );

  if (data.uiapi.query.Opportunity.edges.length === 0) {
    throw new TCNotFoundError("Opportunity", opportunityId);
  }

  return data.uiapi.query.OpportunityContactRole.edges
    .map(({ node }) => node)
    .filter((ocr) => ocr.Contact != null)
    // Sort primary contact first (orderBy on OpportunityContactRole isn't
    // accepted by SF GraphQL — at least not with the {Field:{order}} shape
    // that works on Opportunity. Sorting JS-side is fine for ≤200 rows.)
    .sort((a, b) => {
      const ap = a.IsPrimary?.value ? 1 : 0;
      const bp = b.IsPrimary?.value ? 1 : 0;
      return bp - ap;
    })
    .map((ocr) => ({
      id: ocr.Contact!.Id,
      opportunityId,
      name: val(ocr.Contact!.Name) ?? "",
      title: val(ocr.Contact!.Title) ?? val(ocr.Role) ?? "",
    }));
}

// ─── list_voices ───────────────────────────────────────────────────────
//
// Voices are NOT a SF object in this org — see docs/SALESFORCE_OBJECTS.md.
// Same hardcoded list in mock and live modes.

export async function listVoicesSF(_auth: SfAuth): Promise<Voice[]> {
  return VOICES;
}

// ─── list_scenarios ─────────────────────────────────────────────────────

interface ScenarioNode {
  Id: string;
  Name: GqlString;
  Description__c: GqlString;
  Type__c: GqlString;
}

export async function listScenariosSF(auth: SfAuth): Promise<Scenario[]> {
  const data = await sfGraphQL<{
    uiapi: { query: { Scenario__c: GqlNode<ScenarioNode> } };
  }>(
    auth,
    /* GraphQL */ `
      query ListScenarios {
        uiapi {
          query {
            Scenario__c(
              orderBy: { Name: { order: ASC } }
              first: 200
            ) {
              edges {
                node {
                  Id
                  Name { value }
                  Description__c { value }
                  Type__c { value }
                }
              }
            }
          }
        }
      }
    `,
  );

  return data.uiapi.query.Scenario__c.edges.map(({ node }) => ({
    id: node.Id,
    name: val(node.Name) ?? "",
    // Prefer the short description; fall back to scenario type tag.
    description:
      val(node.Description__c) ?? `Type: ${val(node.Type__c) ?? "Case"}`,
  }));
}

// ─── create_roleplay_session → ScenarioAssignment__c ────────────────────
//
// Creates a ScenarioAssignment__c owned by the caller. Per the schema doc,
// "session" in our MCP terms means the assignment + its eventual Transcript;
// there is no Roleplay_Session__c object.
//
// opportunityId / contactId / voiceId / backstory are NOT persisted on the
// assignment (the schema has no fields for them). They flow through to
// Claude as deal-context for pre-call coaching, and into the launch URL
// query string so the LWC can pick them up client-side.

interface AssignmentMutationResult {
  Record: {
    Id: string;
    Name: GqlString;
    Scenario__c: GqlString;
    Assigned_Date__c: GqlString;
    Due_Date__c: GqlString;
    CreatedDate: GqlString;
  };
  errors?: Array<{ message: string }>;
}

const SCENARIO_ASSIGNMENT_DUE_DAYS = 7;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function plusDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildLaunchUrl(args: {
  instanceUrl: string;
  assignmentId: string;
  opportunityId: string;
  contactId: string;
  /** Concrete voice id picked by the caller. Mutually exclusive with voiceGender. */
  voiceId?: string;
  /** Gender preference; the LWC picks a concrete voice client-side. */
  voiceGender?: VoiceGender;
  backstory?: string;
}): string {
  // ScenarioAssignment__c.Launch_Scenario__c is a Lightning-internal URL:
  //   /lightning/n/Learning?c__sa=<assignmentId>
  // We append context the LWC reads to pre-fill voice / opportunity / contact.
  // Use the Lightning host derived from the instance URL.
  const lightning = args.instanceUrl
    .replace(".my.salesforce.com", ".lightning.force.com")
    .replace(/^https:\/\//, "https://");
  const params = new URLSearchParams({
    c__sa: args.assignmentId,
    c__opp: args.opportunityId,
    c__contact: args.contactId,
  });
  if (args.voiceId) {
    params.set("c__voice", args.voiceId);
  } else if (args.voiceGender) {
    params.set("c__voiceGender", args.voiceGender);
  }
  if (args.backstory) params.set("c__backstory", args.backstory);
  return `${lightning}/lightning/n/Learning?${params.toString()}`;
}

export async function createRoleplaySessionSF(
  auth: SfAuth,
  input: CreateSessionInput,
): Promise<RoleplaySession> {
  // 1. Resolve all the lookups for deal-context the caller picked.
  //    Voice is hardcoded; the rest come from SF.
  if (!input.voiceId && !input.voiceGender) {
    throw new Error("Either voiceId or voiceGender must be provided");
  }
  let voice: Voice | undefined;
  let voicePreference:
    | { gender: VoiceGender; description: string }
    | undefined;
  if (input.voiceId) {
    const found = findVoice(input.voiceId);
    if (!found) throw new TCNotFoundError("Voice", input.voiceId);
    voice = found;
  } else {
    voicePreference = {
      gender: input.voiceGender!,
      description: "AI-picked voice (gender preference)",
    };
  }

  const lookups = await sfGraphQL<{
    uiapi: {
      query: {
        Opportunity: GqlNode<{
          Id: string;
          Name: GqlString;
          StageName: GqlString;
          Amount: GqlNumber;
          Account: { Name: GqlString } | null;
        }>;
        OpportunityContactRole: GqlNode<{
          Contact: { Id: string; Name: GqlString; Title: GqlString } | null;
        }>;
        Scenario__c: GqlNode<ScenarioNode>;
      };
    };
  }>(
    auth,
    /* GraphQL */ `
      query SessionLookups(
        $oppId: ID!
        $contactId: ID!
        $scenarioId: ID!
      ) {
        uiapi {
          query {
            Opportunity(where: { Id: { eq: $oppId } }, first: 1) {
              edges {
                node {
                  Id
                  Name { value }
                  StageName { value }
                  Amount { value }
                  Account { Name { value } }
                }
              }
            }
            OpportunityContactRole(
              where: {
                and: [
                  { OpportunityId: { eq: $oppId } }
                  { ContactId: { eq: $contactId } }
                ]
              }
              first: 1
            ) {
              edges {
                node {
                  Contact { Id Name { value } Title { value } }
                }
              }
            }
            Scenario__c(where: { Id: { eq: $scenarioId } }, first: 1) {
              edges {
                node {
                  Id
                  Name { value }
                  Description__c { value }
                  Type__c { value }
                }
              }
            }
          }
        }
      }
    `,
    {
      oppId: input.opportunityId,
      contactId: input.contactId,
      scenarioId: input.scenarioId,
    },
  );

  const oppNode = lookups.uiapi.query.Opportunity.edges[0]?.node;
  if (!oppNode) throw new TCNotFoundError("Opportunity", input.opportunityId);

  const ocrContact =
    lookups.uiapi.query.OpportunityContactRole.edges[0]?.node.Contact;
  if (!ocrContact) {
    throw new TCNotFoundError(
      `Contact for opportunity ${input.opportunityId}`,
      input.contactId,
    );
  }

  const scenarioNode = lookups.uiapi.query.Scenario__c.edges[0]?.node;
  if (!scenarioNode) throw new TCNotFoundError("Scenario", input.scenarioId);

  // 2. Insert the ScenarioAssignment__c. Owner defaults to the caller; we
  //    don't override. Single-mutation request → atomic.
  const created = await sfGraphQL<{
    uiapi: { ScenarioAssignment__cCreate: AssignmentMutationResult };
  }>(
    auth,
    /* GraphQL */ `
      mutation CreateAssignment($input: ScenarioAssignment__c_CreateInput!) {
        uiapi {
          ScenarioAssignment__cCreate(input: $input) {
            Record {
              Id
              Name { value }
              Scenario__c { value }
              Assigned_Date__c { value }
              Due_Date__c { value }
              CreatedDate { value }
            }
            errors { message }
          }
        }
      }
    `,
    {
      input: {
        ScenarioAssignment__c: {
          Scenario__c: input.scenarioId,
          Assigned_Date__c: todayIso(),
          Due_Date__c: plusDaysIso(SCENARIO_ASSIGNMENT_DUE_DAYS),
          Notification_Sent__c: false,
        },
      },
    },
  );

  const mutResult = created.uiapi.ScenarioAssignment__cCreate;
  if (mutResult.errors && mutResult.errors.length > 0) {
    throw new Error(
      `Salesforce assignment create failed: ${mutResult.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const rec = mutResult.Record;
  const launchUrl = buildLaunchUrl({
    instanceUrl: auth.instanceUrl,
    assignmentId: rec.Id,
    opportunityId: input.opportunityId,
    contactId: input.contactId,
    voiceId: voice?.id,
    voiceGender: voice ? undefined : input.voiceGender,
    backstory: input.backstory,
  });

  return {
    id: rec.Id,
    url: launchUrl,
    createdAt: val(rec.CreatedDate) ?? new Date().toISOString(),
    dealContext: {
      opportunity: {
        id: oppNode.Id,
        name: val(oppNode.Name) ?? "",
        accountName: val(oppNode.Account?.Name ?? null) ?? undefined,
        stage: val(oppNode.StageName) ?? "",
        amount: val(oppNode.Amount) ?? 0,
      },
      contact: {
        id: ocrContact.Id,
        opportunityId: input.opportunityId,
        name: val(ocrContact.Name) ?? "",
        title: val(ocrContact.Title) ?? "",
      },
      ...(voice ? { voice } : {}),
      ...(voicePreference ? { voicePreference } : {}),
      scenario: {
        id: scenarioNode.Id,
        name: val(scenarioNode.Name) ?? "",
        description:
          val(scenarioNode.Description__c) ??
          `Type: ${val(scenarioNode.Type__c) ?? "Case"}`,
      },
      ...(input.backstory ? { backstory: input.backstory } : {}),
    },
  };
}

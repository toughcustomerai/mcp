// Salesforce-backed implementation of the Tough Customer service layer.
//
// Calls Salesforce REST GraphQL API exclusively. GraphQL enforces FLS +
// sharing for ALL users (including admins with "View All Data"), giving us
// the same security guarantee Apex `WITH USER_MODE` would, with no Apex
// deploy required. Multi-mutation requests are transactional.
//
// All field references in the queries below assume the custom-object schema
// documented in docs/SALESFORCE_SETUP.md. If your SF admin renames a field,
// update the corresponding query here.

import {
  TCNotFoundError,
  type Contact,
  type CreateSessionInput,
  type Opportunity,
  type RoleplaySession,
  type Scenario,
  type Voice,
} from "./tc-service";
import { type SfAuth } from "./sf-auth";
import { sfGraphQL, val } from "./sf-graphql";

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
}

export async function listOpportunitiesSF(auth: SfAuth): Promise<Opportunity[]> {
  // Filter to opportunities flagged as Tough Customer training candidates.
  // Adjust `Tough_Customer__c` if your admin uses a different flag.
  const data = await sfGraphQL<{
    uiapi: { query: { Opportunity: GqlNode<OppNode> } };
  }>(
    auth,
    /* GraphQL */ `
      query ListOpportunities {
        uiapi {
          query {
            Opportunity(
              where: { Tough_Customer__c: { eq: true } }
              orderBy: { Name: { order: ASC } }
              first: 200
            ) {
              edges {
                node {
                  Id
                  Name { value }
                  StageName { value }
                  Amount { value }
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
    .map((ocr) => ({
      id: ocr.Contact!.Id,
      opportunityId,
      name: val(ocr.Contact!.Name) ?? "",
      title: val(ocr.Contact!.Title) ?? "",
    }));
}

// ─── list_voices / list_scenarios ───────────────────────────────────────
//
// Voices and scenarios are product metadata stored in custom objects on SF
// so admins can manage them without code deploys. See userstories §4.2.

interface VoiceNode {
  Id: string;
  Name: GqlString;
  Gender__c: GqlString;
  Description__c: GqlString;
}

export async function listVoicesSF(auth: SfAuth): Promise<Voice[]> {
  const data = await sfGraphQL<{
    uiapi: { query: { Roleplay_Voice__c: GqlNode<VoiceNode> } };
  }>(
    auth,
    /* GraphQL */ `
      query ListVoices {
        uiapi {
          query {
            Roleplay_Voice__c(
              where: { IsActive__c: { eq: true } }
              orderBy: { Name: { order: ASC } }
              first: 200
            ) {
              edges {
                node {
                  Id
                  Name { value }
                  Gender__c { value }
                  Description__c { value }
                }
              }
            }
          }
        }
      }
    `,
  );

  return data.uiapi.query.Roleplay_Voice__c.edges.map(({ node }) => {
    const gender = (val(node.Gender__c) ?? "neutral").toLowerCase();
    return {
      id: node.Id,
      name: val(node.Name) ?? "",
      gender:
        gender === "male" || gender === "female" ? gender : "neutral",
      description: val(node.Description__c) ?? "",
    };
  });
}

interface ScenarioNode {
  Id: string;
  Name: GqlString;
  Description__c: GqlString;
}

export async function listScenariosSF(auth: SfAuth): Promise<Scenario[]> {
  const data = await sfGraphQL<{
    uiapi: { query: { Roleplay_Scenario__c: GqlNode<ScenarioNode> } };
  }>(
    auth,
    /* GraphQL */ `
      query ListScenarios {
        uiapi {
          query {
            Roleplay_Scenario__c(
              where: { IsActive__c: { eq: true } }
              orderBy: { Name: { order: ASC } }
              first: 200
            ) {
              edges {
                node {
                  Id
                  Name { value }
                  Description__c { value }
                }
              }
            }
          }
        }
      }
    `,
  );

  return data.uiapi.query.Roleplay_Scenario__c.edges.map(({ node }) => ({
    id: node.Id,
    name: val(node.Name) ?? "",
    description: val(node.Description__c) ?? "",
  }));
}

// ─── create_roleplay_session ────────────────────────────────────────────
//
// Creates a Roleplay_Session__c record. If we ever need to insert a parent
// + children atomically, multiple `Create` mutations in a single GraphQL
// request execute as one SF transaction (all-or-nothing rollback on error).

interface SessionMutationResult {
  Record: {
    Id: string;
    Name: GqlString;
    Opportunity__c: GqlString;
    Contact__c: GqlString;
    Voice__c: GqlString;
    Scenario__c: GqlString;
    Backstory__c: GqlString;
    Session_Url__c: GqlString;
    CreatedDate: GqlString;
  };
  errors?: Array<{ message: string }>;
}

export async function createRoleplaySessionSF(
  auth: SfAuth,
  input: CreateSessionInput,
): Promise<RoleplaySession> {
  // Fetch the related records first so the response includes denormalized
  // names for the Claude-facing summary. One round-trip; FLS enforced.
  const lookups = await sfGraphQL<{
    uiapi: {
      query: {
        Opportunity: GqlNode<{
          Id: string;
          Name: GqlString;
          StageName: GqlString;
          Amount: GqlNumber;
        }>;
        OpportunityContactRole: GqlNode<{
          Contact: { Id: string; Name: GqlString; Title: GqlString } | null;
        }>;
        Roleplay_Voice__c: GqlNode<VoiceNode>;
        Roleplay_Scenario__c: GqlNode<ScenarioNode>;
      };
    };
  }>(
    auth,
    /* GraphQL */ `
      query SessionLookups(
        $oppId: ID!
        $contactId: ID!
        $voiceId: ID!
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
            Roleplay_Voice__c(where: { Id: { eq: $voiceId } }, first: 1) {
              edges {
                node {
                  Id
                  Name { value }
                  Gender__c { value }
                  Description__c { value }
                }
              }
            }
            Roleplay_Scenario__c(
              where: { Id: { eq: $scenarioId } }
              first: 1
            ) {
              edges {
                node {
                  Id
                  Name { value }
                  Description__c { value }
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
      voiceId: input.voiceId,
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

  const voiceNode = lookups.uiapi.query.Roleplay_Voice__c.edges[0]?.node;
  if (!voiceNode) throw new TCNotFoundError("Voice", input.voiceId);

  const scenarioNode =
    lookups.uiapi.query.Roleplay_Scenario__c.edges[0]?.node;
  if (!scenarioNode) throw new TCNotFoundError("Scenario", input.scenarioId);

  // Insert the session. Single-mutation request — atomic by definition.
  // If we add child records (e.g. Roleplay_Participant__c) later, list both
  // mutations in this same `mutation { uiapi { ... ... } }` block to get
  // all-or-nothing semantics.
  const created = await sfGraphQL<{
    uiapi: { Roleplay_Session__cCreate: SessionMutationResult };
  }>(
    auth,
    /* GraphQL */ `
      mutation CreateSession($input: Roleplay_Session__c_CreateInput!) {
        uiapi {
          Roleplay_Session__cCreate(input: $input) {
            Record {
              Id
              Name { value }
              Opportunity__c { value }
              Contact__c { value }
              Voice__c { value }
              Scenario__c { value }
              Backstory__c { value }
              Session_Url__c { value }
              CreatedDate { value }
            }
            errors { message }
          }
        }
      }
    `,
    {
      input: {
        Roleplay_Session__c: {
          Opportunity__c: input.opportunityId,
          Contact__c: input.contactId,
          Voice__c: input.voiceId,
          Scenario__c: input.scenarioId,
          ...(input.backstory ? { Backstory__c: input.backstory } : {}),
        },
      },
    },
  );

  const mutResult = created.uiapi.Roleplay_Session__cCreate;
  if (mutResult.errors && mutResult.errors.length > 0) {
    throw new Error(
      `Salesforce session create failed: ${mutResult.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const rec = mutResult.Record;
  const sessionId = rec.Id;
  const sessionUrl =
    val(rec.Session_Url__c) ?? `https://www.toughcustomer.ai/session/${sessionId}`;

  return {
    id: sessionId,
    url: sessionUrl,
    createdAt: val(rec.CreatedDate) ?? new Date().toISOString(),
    dealContext: {
      opportunity: {
        id: oppNode.Id,
        name: val(oppNode.Name) ?? "",
        stage: val(oppNode.StageName) ?? "",
        amount: val(oppNode.Amount) ?? 0,
      },
      contact: {
        id: ocrContact.Id,
        opportunityId: input.opportunityId,
        name: val(ocrContact.Name) ?? "",
        title: val(ocrContact.Title) ?? "",
      },
      voice: {
        id: voiceNode.Id,
        name: val(voiceNode.Name) ?? "",
        gender: (() => {
          const g = (val(voiceNode.Gender__c) ?? "neutral").toLowerCase();
          return g === "male" || g === "female" ? g : "neutral";
        })(),
        description: val(voiceNode.Description__c) ?? "",
      },
      scenario: {
        id: scenarioNode.Id,
        name: val(scenarioNode.Name) ?? "",
        description: val(scenarioNode.Description__c) ?? "",
      },
      ...(input.backstory ? { backstory: input.backstory } : {}),
    },
  };
}

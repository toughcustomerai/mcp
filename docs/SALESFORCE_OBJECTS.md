# Salesforce object schema

The MCP server reads/writes Salesforce via the **REST GraphQL API** (no Apex
deploy required). FLS + sharing are enforced by Salesforce GraphQL for all
users including admins. The customer's SF admin only needs to create the
custom objects + fields below — point-and-click in Setup, no code.

## Standard objects used as-is

| Object | Fields used |
|---|---|
| `Opportunity` | `Id`, `Name`, `StageName`, `Amount`, `Tough_Customer__c` (custom checkbox — see below) |
| `Contact` | `Id`, `Name`, `Title` |
| `OpportunityContactRole` | `Id`, `OpportunityId`, `ContactId` (relationship to Contact above) |

## Custom field on Opportunity

Add a single boolean to the standard Opportunity object so admins can flag
which deals are roleplay candidates:

| API name | Type | Purpose |
|---|---|---|
| `Tough_Customer__c` | Checkbox | When `true`, the deal appears in `list_opportunities`. |

Permission: grant **Read** on `Opportunity.Tough_Customer__c` to the rep
profile (or whichever profile uses the MCP server). Grant **Edit** to
whoever curates the candidate list.

## Custom object: `Roleplay_Voice__c`

Product metadata. Admins curate this; reps read it.

| API name | Type | Required | Notes |
|---|---|---|---|
| `Name` | Text (Auto-name OK) | yes | e.g. "Charon" |
| `Gender__c` | Picklist | no | values: `male`, `female`, `neutral` |
| `Description__c` | Text(255) | no | Short character description |
| `IsActive__c` | Checkbox, default `true` | yes | Filtered on in `list_voices` |

Permissions: rep profile = **Read** on object + all fields. Admin = full.

## Custom object: `Roleplay_Scenario__c`

| API name | Type | Required | Notes |
|---|---|---|---|
| `Name` | Text | yes | e.g. "Pricing Negotiation" |
| `Description__c` | Long Text Area(1000) | no | |
| `IsActive__c` | Checkbox, default `true` | yes | Filtered on in `list_scenarios` |

Permissions: rep profile = **Read** on object + all fields.

## Custom object: `Roleplay_Session__c`

The record `create_roleplay_session` inserts.

| API name | Type | Required | Notes |
|---|---|---|---|
| `Name` | Auto Number `RPS-{0000}` | yes | |
| `Opportunity__c` | Lookup(Opportunity) | yes | |
| `Contact__c` | Lookup(Contact) | yes | |
| `Voice__c` | Lookup(Roleplay_Voice__c) | yes | |
| `Scenario__c` | Lookup(Roleplay_Scenario__c) | yes | |
| `Backstory__c` | Long Text Area(4000) | no | |
| `Session_Url__c` | URL(255) | no | Populated by a flow / Apex trigger if you mint URLs server-side, otherwise the MCP server falls back to a deterministic URL based on Id. |

Permissions: rep profile = **Create**, **Read** on object + all fields.

## Owner Sharing

Default owner-based sharing means a rep sees opportunities they own. If
your team uses sales teams / opportunity-team-member sharing, no extra
configuration needed — `WITH USER_MODE`-equivalent enforcement in GraphQL
respects whatever sharing rules you have.

If your reps need to see opportunities they're a contact role on (but
don't own), add an OWD or sharing rule accordingly. The MCP server has no
opinion — Salesforce decides what each user sees.

## Smoke test

After creating the objects + fields and granting permissions:

```bash
curl -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ uiapi { query { Roleplay_Voice__c(first: 5) { edges { node { Id Name { value } } } } } } }"}' \
  https://<instance>.my.salesforce.com/services/data/v62.0/graphql
```

Expected: 200 with the voices list. If you get 400 with "schema not found"
errors, the object or field API names don't match what `lib/tc-salesforce.ts`
queries. Either rename in SF or update the query strings in that file.

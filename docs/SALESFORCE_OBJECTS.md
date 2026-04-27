# Salesforce object schema (as it actually exists in this org)

This project's MCP / external integrations read and write Salesforce data
through the Salesforce REST or GraphQL API. FLS + sharing are enforced by
Salesforce for all users (admins included). The objects and fields below
are the **current** data model — no setup required, no new fields needed.

> **Note:** an earlier version of this doc described `Roleplay_Voice__c`,
> `Roleplay_Scenario__c`, `Roleplay_Session__c`, and `Opportunity.Tough_Customer__c`.
> **None of those exist.** The names below match the metadata in
> `force-app/main/default/objects/`.

---

## Standard objects used as-is

| Object | Fields used |
|---|---|
| `Opportunity` | `Id`, `Name`, `Account.Name`, `StageName`, `Amount`, `Probability`, `Type`, `NextStep`, `Description`, `ForecastCategoryName`, `MainCompetitors__c` (custom — see below), child `OpportunityLineItems`, child `OpportunityContactRoles` |
| `Contact` | `Id`, `Name`, `Title`, `Email`, `Phone`, `Department` |
| `OpportunityContactRole` | `Id`, `OpportunityId`, `ContactId`, `Role`, `IsPrimary` |
| `OpportunityLineItem` | `Id`, `Quantity`, `UnitPrice`, `TotalPrice`, `Description`, `Product2.Name`, `Product2.Description`, `Product2.ProductCode` |
| `Product2` | accessed via `OpportunityLineItem.Product2` |

### Custom field on Opportunity (already exists)

| API name | Type | Used by |
|---|---|---|
| `MainCompetitors__c` | (custom field on Opportunity, see Setup → Object Manager → Opportunity) | `OppCoachController.fetchOpportunity` to seed competitive context into the AI prompt. |

There is **no** `Tough_Customer__c` checkbox on Opportunity. Pickers in
the LWCs (e.g. `oppCoach`, `oppSimulation`) operate on whatever
opportunity record the page is on (`@api recordId`); they don't filter a
list by a "candidate" flag.

> The repo's `package.xml` retrieves `<CustomObject>*</CustomObject>` but
> does **not** pull custom fields on standard objects, so
> `MainCompetitors__c` is referenced by Apex but its `field-meta.xml`
> isn't in the source tree. Add `Opportunity.MainCompetitors__c` (and any
> other Opportunity custom fields) to the manifest if you want them
> source-tracked.

---

## Voices — hardcode them, do not model in Salesforce

There is no `Roleplay_Voice__c` object. The existing `oppCoach` LWC
already hardcodes the voice picker (see `oppCoach.js`, getter
`voiceOptions`):

```javascript
get voiceOptions() {
    return [
        { label: 'Alloy',   value: 'alloy' },
        { label: 'Ash',     value: 'ash' },
        // ... etc — OpenAI voice names
    ];
}
```

Recommendation: keep voices as a hardcoded constant in your code (LWC, MCP tool, whatever consumes them). Don't create a custom object for them.

- The list is small, never filtered, never reported on.
- It's tightly coupled to the underlying provider's catalog (OpenAI Realtime, Gemini Live, etc.) — when the provider updates, you update the array.
- Admins shouldn't be able to add a "voice" that the API doesn't actually accept; a hardcoded list prevents that footgun.

For Gemini Live, hardcode the supported voices, e.g.:

```javascript
// Gemini Live API voices (gemini-2.5-flash-preview-native-audio-dialog,
// gemini-live-2.5-flash-preview, etc.). Keep this list in sync with the
// model's documented `prebuiltVoiceConfig.voiceName` values.
const GEMINI_VOICES = [
    'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede',
    'Leda', 'Orus', 'Zephyr'
    // (newer 2.5+ models add 30+ more — only expose what your model supports)
];
```

If a future requirement makes voices admin-curatable per org, that's the moment to introduce a CMDT (`Voice__mdt`) — not a regular custom object — because it's metadata, not data. Until then, hardcode.

> **LWC contract:** the launch URL the MCP server hands the LWC is `/lightning/n/Learning?c__opp=<opportunityId>` — only the opportunity id flows through the URL. The LWC resolves everything else (scenario, contact, voice, the user's most recent `ScenarioAssignment__c` on the opp) at session-start from that opp context. If voiceGender / voiceId / backstory selection moves back into the URL later, restore the `c__voice|c__voiceGender|c__contact|c__backstory` params in `buildLaunchUrl` (lib/tc-salesforce.ts).

---

## Custom object: `Scenario__c`

Roleplay / coaching / certification cases. Admins curate these; reps and the AI read them.

| API name | Type | Notes |
|---|---|---|
| `Name` | Text (Scenario Name) | Display name, e.g. "Pricing Negotiation" |
| `Body__c` | Long Text Area (130000) | Full instructions/script handed to the AI |
| `Case__c` | Long Text Area (32768) | Case background |
| `Description__c` | Long Text Area (131072) | Short description |
| `Filelink__c` | Text(255) | Public Files link (admin pastes after Files → New → Upload → Create public link → Copy Link) |
| `Pass_Threshold__c` | Number(3,0), default 80 | Minimum overall score (0–100) required to pass |
| `Scoring_Category__c` | Text(255) | Free-text scoring category tag |
| `Type__c` | Picklist (restricted) | Certification, Demo, Case (default), Coaching |
| `ScenarioSet__c` | Lookup → `ScenarioSet__c` | Optional grouping |

There is no `IsActive__c` on `Scenario__c`. If you want to filter to "active" scenarios, either filter on `Type__c`, on membership in a `ScenarioSet__c`, or add an `Is_Active__c` checkbox (separate change — out of scope here).

OWD: Public Read/Write. History tracking on. Tab default.

---

## Custom object: `ScenarioSet__c`

A curated bundle of scenarios (e.g. "Onboarding Week 1", "Q4 Cert Track").

| API name | Type | Notes |
|---|---|---|
| `Name` | Text (Scenario Set Name) | |
| `Description__c` | Long Text Area (131072) | |
| `Status__c` | Picklist (restricted) | Draft (default), In Progress, Completed, On Hold, Cancelled |
| `Strategy__c` | Lookup → `Strategy__c` | Optional parent strategy |

OWD: Public Read/Write.

---

## Custom object: `ScenarioSetMember__c`

Junction-style child that orders scenarios inside a set and carries per-member Slack notification copy.

| API name | Type | Notes |
|---|---|---|
| `Name` | (standard text Name) | |
| `Scenario_Set__c` | Lookup → `ScenarioSet__c` | |
| `Scenario__c` | Lookup → `Scenario__c` | |
| `SortOrder__c` | Number(2,0) | Position inside the set |
| `Delay_Days__c` | Number(3,0) | Days after assignment to send/start |
| `Notification_Title__c` | Text(255) | Slack title (emoji OK) |
| `Notification_Body__c` | Long Text Area(1000) | Slack body |
| `Notification_Button_Text__c` | Text(50), default "Start Roleplay" | Slack action button label |

**Watch out:** the lookup field on this object is `Scenario_Set__c` (with the underscore), while the same idea on `Scenario__c` and `ScenarioAssignment__c` is `ScenarioSet__c` (no underscore). Both shapes exist — copy/paste API names, don't guess.

---

## Custom object: `ScenarioAssignment__c`

A scenario assigned to a user (Owner = the assignee). Auto-numbered.

| API name | Type | Notes |
|---|---|---|
| `Name` | Auto Number `SA-{0000}` | "Assignment Number" |
| `Scenario__c` | Lookup → `Scenario__c` (Restrict delete) | The scenario being assigned |
| `ScenarioSet__c` | Lookup → `ScenarioSet__c` | Optional parent set |
| `Assigned_Date__c` | Date, required | When it was assigned |
| `Due_Date__c` | Date, required | When it's due |
| `Completion_Date__c` | Date | When the user finished |
| `Completion_Status__c` | Text(255), history-tracked | Free-text status |
| `Delay_Days__c` | Number(3,0) | Mirrors the set member's delay |
| `SortOrder__c` | Number(2,0) | Mirrors the set member's order |
| `Notification_Sent__c` | Checkbox, default false | Whether the Slack ping went out |
| `Transcript__c` | Lookup → `toughcustomer__Transcript__c` (managed package) | The captured conversation |
| `Launch_Scenario__c` | Formula(Text) | `HYPERLINK("/lightning/n/Learning?c__sa=" & Id, "Launch Scenario", "_blank")` |
| `Completed_Scenarios__c` | Roll-Up Summary (count) | count(`Scenario_Progress__c`) where `Status__c` = 'Completed' |

OWD: Public Read/Write, history-tracked.

There is no `Roleplay_Session__c`. When code talks about a "session" it means either:

- an ephemeral OpenAI/Gemini realtime session in the LWC (no SF record), or
- a `ScenarioAssignment__c` + the resulting `toughcustomer__Transcript__c` record from the managed package, joined by `ScenarioAssignment__c.Transcript__c`.

**The MCP `create_roleplay_session` tool does NOT create a `ScenarioAssignment__c`.** It validates the picked context (opp / contact / scenario / voice) and returns a Lightning launch URL — the **Learning LWC** is responsible for creating the assignment when the user clicks Start. We tried the GraphQL mutation `ScenarioAssignment__cCreate(input: ScenarioAssignment__c_CreateInput!)` and SF rejected it as an unknown input type; rather than fight the schema (which would require either REST `/sobjects` or Apex), we let the LWC own the write.

---

## Custom object: `Scenario_Progress__c`

Master-detail child of `ScenarioAssignment__c`. Tracks progress on a single attempt.

| API name | Type | Notes |
|---|---|---|
| `Name` | Auto Number `SP-{000000}` | |
| `Scenario_Assignment__c` | Master-Detail → `ScenarioAssignment__c` | Parent (controls sharing) |
| `Status__c` | Picklist (restricted) | Not Started, In Progress, Completed |
| `Score__c` | Number(18,0) | Overall score (denormalized) |
| `Due_Date__c` | Date | |
| `Completion_Date__c` | Date | |
| `Sort_Order__c` | Number | |

Sharing: ControlledByParent.

---

## Custom object: `Strategy__c`

Top-level container above `ScenarioSet__c` (e.g. "FY26 Enablement Plan").

| API name | Type | Notes |
|---|---|---|
| `Name` | Text (Strategy Name) | |
| `Description__c` | Long Text Area (131072) | |
| `Status__c` | Picklist (restricted) | Draft (default), In Progress, Completed, On Hold, Cancelled |
| `Is_Active__c` | Checkbox, default false | |
| `Start_Date__c` | Text(255) | Yes, text — not a Date field. Don't change without checking dependencies. |
| `End_Date__c` | Text(255) | Same. |

OWD: Public Read/Write.

---

## Custom object: `Competency__c`

Reference data describing what the AI scores against.

| API name | Type | Notes |
|---|---|---|
| `Name` | Text (Competency Name) | |
| `Body__c` | Long Text Area (32768) | Rubric / description fed to the LLM |
| `Category__c` | Picklist (unrestricted) | Customer Trust, Collaboration, Business Acument (sic), MEDDIC, SPICED, Challenger, GAP Selling, BANT, Command of the Sale, Customer Centric Selling, IMPACT Selling, PLUS, SPIN, TALK, plus single-letter MEDDICC tags I, C, DP, E, M, DC, PASS |
| `Subcategory__c` | Picklist (unrestricted) | ~25 values incl. Customer Communications, Research & Discover, Topics, Asking, Levity, Kindness, Presence, Accuracy, Story, Substance, Demo Alignment, Storytelling & Value Mapping, Proof & Product Mastery, Technical Validation, Trust & Security, Engagement & Facilitation, Evaluation Support, Handoff & Next Steps, OutSystems Advantage Mastery, Agentic Future Leadership, etc. |
| `Type__c` | Text(255) | |
| `Object__c` | Text(255) | |
| `Why__c` | Text(255) | |

---

## Custom object: `Score__c`

One AI-emitted competency score per transcript.

| API name | Type | Notes |
|---|---|---|
| `Name` | Text (Score Name) | |
| `Body__c` | Long Text Area (32768) | LLM commentary |
| `Score__c` | Number(1,0) | The numeric score |
| `Why__c` | Text(255) | Justification |
| `Category__c` | Picklist (unrestricted) | Same MEDDIC/SPICED/etc. value set as `Competency__c.Category__c` (subset) |
| `Subcategory__c` | Picklist (unrestricted) | Subset of `Competency__c.Subcategory__c` |
| `Competency__c` | Lookup → `Competency__c` | |
| `Scenario__c` | Lookup → `Scenario__c` | |
| `Transcript__c` | Lookup → `toughcustomer__Transcript__c` (managed package) | |

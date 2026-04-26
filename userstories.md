# Tough Customer MCP — User Stories

Scope: the remote MCP server at `https://mcp-umber-three.vercel.app/mcp` that lets an LLM client (Claude Desktop, claude.ai, ChatGPT Apps, mcp-ui) configure and launch a Tough Customer roleplay session.

Three audiences:

- **Admin** — wires the server into an identity provider and deploys it.
- **Operator** — ongoing day-to-day maintenance of the server, data, and integrations.
- **End user** — a salesperson using Claude to spin up a roleplay.

Each story uses `As a <role>, I want <capability>, so that <outcome>.` Acceptance criteria are concrete and testable.

Status key: ✅ done · 🟡 partial · ⬜ todo

---

## 1. Setup & deployment

### 1.1 Fork and deploy
**As an** admin, **I want** to deploy my own copy of the MCP server, **so that** I control the data, logs, and identity boundary.

Acceptance:
- Clone `https://github.com/toughcustomerai/mcp`, run `npm install`, `npm run build` — no errors.
- `npx vercel --prod` produces a `*.vercel.app` URL that responds to `POST /mcp` with a JSON-RPC manifest.
- Landing page at `/` lists the registered resources, tools, and prompts.

Status: ✅

### 1.2 Configure backend (Salesforce)
**As an** admin, **I want** to point the MCP server at Salesforce so every read and write runs as the end user with FLS + sharing enforced, **so that** the CRM itself is the policy engine — no second engine to get wrong.

Implementation: **Salesforce REST GraphQL API**, not Apex. GraphQL enforces FLS + sharing for all profiles including admins, giving us the same security guarantee `WITH USER_MODE` gives in Apex without an Apex deploy. Multi-mutation requests run in a single SF transaction (all-or-nothing rollback).

Acceptance:
- `lib/tc-service.ts` dispatches on `auth.mock`: mock → in-memory; live → `lib/tc-salesforce.ts`.
- `lib/tc-salesforce.ts` calls only `/services/data/vXX.X/graphql`. No Apex REST. No raw `/query`.
- Custom objects + fields documented in `docs/SALESFORCE_OBJECTS.md` exist in the SF org. Point-and-click setup; no Apex classes, no SFDX project.
- Env vars set in Vercel: `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_API_VERSION` (optional), `MCP_PUBLIC_URL`.
- Connected App exists in SF with PKCE required, scopes `api refresh_token openid`.
- A non-admin rep testing against the MCP server only sees their own opportunities; an admin testing with an FLS-restricted permission set sees only the fields that permission set allows.

Status: 🟡 (GraphQL scaffolding shipped; custom objects + Connected App are manual setup in Salesforce per `docs/SALESFORCE_SETUP.md`)

### 1.3 Connect to Claude Desktop / claude.ai
**As an** end user, **I want** to add the MCP server as a connector in Claude, **so that** I can use it from any chat.

Acceptance:
- Settings → Connectors → Add custom connector → paste URL → connector appears with the expected tools/resources/prompts.
- After a successful connect, `list_opportunities`, `list_voices`, `list_scenarios`, `get_opportunity_contacts`, `create_roleplay_session`, and the `setup_sales_roleplay` prompt are all visible.
- Server changes require a connector reinstall (uninstall → quit Claude → reinstall) to refresh the cached manifest.

Status: ✅

### 1.4 MCP Inspector smoke test
**As an** admin, **I want** to verify the server with MCP Inspector, **so that** I can debug without involving Claude.

Acceptance:
- `npx @modelcontextprotocol/inspector` → Streamable HTTP → server URL → successfully lists tools, resources, and prompts.
- Calling each tool with valid inputs returns structured content without errors.

Status: ⬜ (works, but not documented in README)

### 1.5 Custom domain for the auth surface (Supabase)
**As an** admin, **I want** the OAuth authorization endpoints (login, token, well-known metadata) to live under our own brand domain, **so that** end users see `auth.toughcustomer.ai` — not a `*.supabase.co` URL — when Claude opens the consent screen.

The MCP server itself stays on Vercel (`mcp.toughcustomer.ai`). What this story covers is the **Supabase Auth surface and any Edge Functions** we host as part of the AS — token exchange, account-linking callbacks, the OAuth consent UI — being reachable under our own subdomain.

Acceptance:
- Supabase project has a custom hostname configured (Pro plan feature: Project Settings → Custom Domains → register `auth.toughcustomer.ai`).
- DNS: `CNAME auth.toughcustomer.ai → <project-ref>.supabase.co` (or the value Supabase provisions). Verified via `dig CNAME auth.toughcustomer.ai`.
- Supabase issues + auto-renews the TLS certificate; cert reachable via `curl -vI https://auth.toughcustomer.ai`.
- Any Supabase Edge Functions in the auth path (e.g. `link-salesforce`, `token-exchange`) are reachable at `https://auth.toughcustomer.ai/functions/v1/<name>` with no `*.supabase.co` redirect.
- Supabase Auth's `SITE_URL` and OAuth redirect URLs are updated to the custom domain so issued tokens carry `iss: https://auth.toughcustomer.ai/auth/v1` (not the project-ref host).
- MCP server's `/.well-known/oauth-protected-resource` advertises `authorization_servers: ["https://auth.toughcustomer.ai"]`.
- Salesforce Connected App callback URL is updated to `https://auth.toughcustomer.ai/auth/v1/callback` (the Supabase-side OAuth callback that completes the SF account-link).
- Rotation runbook documented: if Supabase rotates the CNAME target, the runbook in `docs/CUSTOM_DOMAIN.md` covers the DNS update + token-issuer re-verification.

Status: ⬜

---

## 2. Authentication & authorization

### 2.1 Trust model (Model B — Supabase as Authorization Server)
**As an** admin, **I want** to understand the trust model, **so that** I know what's enforced and by whom.

Target architecture ("Model B"):

- **Supabase Auth is the OAuth 2.1 Authorization Server** that Claude logs into. Claude never sees a Salesforce token.
- **The MCP server is a pure Resource Server.** It validates incoming Supabase JWTs (via Supabase's JWKS), then on each request mints a fresh SF access token from a per-user **stored refresh token**, calls SF REST GraphQL as that SF user, and discards the SF access token.
- **Salesforce is a downstream backend**, linked to a Supabase user via a one-time account-link flow (see 2.2). It is not the AS for Claude.
- **SF REST GraphQL enforces FLS + sharing for all profiles**, including admins with "View All Data". This is the same security guarantee Apex `WITH USER_MODE` would give us, achieved at the API layer instead of the code layer — no Apex deploy required.

Why this is the architecturally correct choice over "SF as AS":

- Claude / Anthropic infrastructure never holds a credential to the customer's Salesforce tenant. The token Claude carries is only valid against `mcp.toughcustomer.ai`.
- Tokens issued to Claude can be narrowly scoped (`roleplay:create`, `opportunity:read`) instead of SF's coarse `api` scope.
- Multi-backend ready: HubSpot, Dynamics, etc. plug in the same way (another linked-identity row).
- One revocation surface (Supabase) covers all linked backends.

What the MCP server takes on as cost (covered by 2.7):

- It becomes a **custodian of per-user SF refresh tokens**. The vault is the new high-value asset; encryption-at-rest, server-only access, and revocation propagation are required.

Acceptance:
- No tool accepts an identity claim as an input. Identity comes from the verified Supabase JWT.
- The MCP server never logs or returns a SF access token, refresh token, or any credential material.
- A SF token issued during a request is held only in memory for the duration of the downstream GraphQL call.
- Mock mode (no auth, in-memory data) is preserved for local dev and clearly labelled on the landing page.

Status: 🟡 (mock/SF-as-AS prototype shipped; Model B is the target)

### 2.2 OAuth 2.1 via Supabase Auth (Authorization Server)
**As an** admin, **I want** Supabase Auth to be the OAuth authorization server that Claude negotiates with, **so that** Claude holds a token issued by us, not a raw Salesforce token.

Acceptance:
- Supabase project has **OAuth Apps / OAuth Server** enabled. A registered OAuth App represents the MCP server; clients (Claude, ChatGPT, MCP Inspector) obtain tokens from it.
- Supabase exposes `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` at the custom domain (`https://auth.toughcustomer.ai`, see 1.5). Discovery, authorize, token, JWKS, and revocation endpoints all live there.
- The MCP server's `/.well-known/oauth-protected-resource` (RFC 9728) advertises `authorization_servers: ["https://auth.toughcustomer.ai"]`.
- Unauthenticated `POST /mcp` returns `401` with `WWW-Authenticate: Bearer resource_metadata="…"`. Claude follows the chain to Supabase, runs PKCE, and gets back a Supabase access token.
- Dynamic Client Registration (RFC 7591) is enabled on Supabase so MCP clients can self-register without admin intervention.
- Scopes issued: `roleplay:create`, `opportunity:read`, `voice:read`, `scenario:read` (or similar narrow set). Not raw SF scopes.
- MCP server validates each incoming Supabase JWT via JWKS (offline) — no per-request callback to Supabase. Claims used: `sub` (Supabase user ID), `email`, `aud`, `exp`.
- Access-token TTL ≤ 1 hour; refresh-token rotation enabled.

Sub-flow — **one-time Salesforce account linking**:

- After signing into Supabase, the user is presented with "Connect your Salesforce" in a browser (NOT in Claude — this happens in our own UI at `https://app.toughcustomer.ai/connect`).
- Standard SF Connected App PKCE flow runs in the browser. SF redirects back to `https://auth.toughcustomer.ai/auth/v1/callback`.
- The Supabase Edge Function `link-salesforce` receives the SF authorization code, exchanges it for `{access_token, refresh_token}`, and writes a row to `identity_links` (see 2.7). Only the encrypted refresh token is persisted.
- Acceptance: the linking page shows "Connected as `<sf-email>` in org `<sf-org-id>`" once linked; "Disconnect" deletes the row.

Status: ⬜ (replaces the prototype's "SF as AS" path; SF Connected App is repurposed as a downstream backend, not the AS)

### 2.3 Row-level security via Salesforce GraphQL API
**As an** admin, **I want** Salesforce itself to enforce that users only see records and fields their profile allows, **so that** there is no second policy engine to get wrong.

How identity flows through the stack, in Model B:

1. MCP request arrives with a Supabase JWT → `supabase_user_id`.
2. MCP looks up `identity_links` row → encrypted SF refresh token.
3. MCP calls `https://login.salesforce.com/services/oauth2/token` with that refresh token → fresh SF access token bound to the linked SF user.
4. MCP calls SF REST GraphQL (`/services/data/vXX.X/graphql`) with the SF access token. SF resolves the token to the SF user; the GraphQL execution layer enforces FLS + sharing for that user automatically — for ALL profiles, including admins with "View All Data".
5. The query returns only records and fields the linked SF user is allowed to see.

The MCP server passes no user ID to SF. Identity is carried by the SF access token. We never use Apex `WITH USER_MODE`; SF GraphQL gives us the same admin-FLS guarantee at the API layer.

Acceptance:
- Every Salesforce call in `lib/tc-salesforce.ts` goes through `lib/sf-graphql.ts`. No SOQL `/query` calls. No Apex REST calls.
- A test rep with a restricted profile cannot retrieve records outside their role hierarchy via the MCP server.
- A test admin running the MCP server cannot see fields hidden by a custom FLS-restricted permission set.
- **No shared / integration-user credential is ever used.** Each SF call uses the linked end user's refresh-token-derived access token.
- A user whose SF refresh token is missing, expired, or revoked sees a `TCUnauthorizedError` and is prompted to re-link Salesforce — they do NOT silently fall back to any other identity.
- Multi-mutation writes (e.g. session + child participants) execute in a single GraphQL request and roll back together on any error.

Status: 🟡 (GraphQL client + tool implementations shipped; custom objects are manual SF setup; refresh-token-on-server flow gated on 2.7)

### 2.4 Workspace / domain allow-listing
**As an** admin, **I want** to restrict the MCP server to specific email domains (e.g. `@toughcustomer.ai`), **so that** only my team can connect.

Acceptance:
- Env var `MCP_ALLOWED_DOMAINS="toughcustomer.ai,partner.com"`.
- Auth middleware rejects tokens whose `email_verified=true` domain is not in the list, with a `403` and a clear error.
- Unit test covers both accept and reject cases.

Status: ⬜

### 2.5 Audit log
**As an** admin, **I want** every tool call logged with verified user identity, tool name, inputs, and result, **so that** I have a real audit trail.

Acceptance:
- Each tool call writes a row to an append-only log (Supabase `mcp_audit_log` or equivalent) with: `user_id`, `email`, `tool`, `inputs` (redacted secrets), `success`, `latency_ms`, `timestamp`.
- Failed auth attempts are logged too (with the rejected email, if extractable).
- Log retention ≥ 90 days.

Status: ⬜

### 2.6 Token revocation
**As an** admin, **I want** to revoke a user's access immediately when they leave the company, **so that** stale tokens can't be used against the MCP server.

Two layers, both must work:

1. **Supabase token revocation** — disabling / deleting the Supabase user invalidates their access token at next refresh; subsequent Claude calls fail at JWT validation in the MCP server with `401`.
2. **Salesforce link revocation** — the user's row in `identity_links` is deleted, AND the SF refresh token is revoked at SF's `/services/oauth2/revoke` endpoint. This shuts down the path even if the Supabase token is somehow still valid.

Acceptance:
- Disabling a user in Supabase causes the next MCP call (within access-token TTL) to fail with `401`.
- Calling the admin-only `revoke_link` action deletes the `identity_links` row AND POSTs to SF's revoke endpoint; verified by attempting the refresh — SF returns `invalid_grant`.
- Access-token TTLs ≤ 1 hour. Refresh-token rotation enabled in Supabase.
- A SF admin disabling the SF user causes the next refresh exchange to fail; the MCP server detects `invalid_grant`, deletes the `identity_links` row, and surfaces `TCUnauthorizedError` to Claude with a "reconnect Salesforce" hint.

Status: ⬜

### 2.7 Credential vault (per-user Salesforce refresh tokens)
**As an** admin, **I want** the MCP server to be a safe custodian of per-user Salesforce refresh tokens, **so that** Model B's "Claude never holds an SF token" guarantee doesn't just relocate the risk to a poorly protected database.

This is the central new responsibility introduced by Model B. The vault is the highest-value asset on the server.

Schema (Supabase Postgres):

```sql
create table identity_links (
  supabase_user_id   uuid primary key references auth.users(id) on delete cascade,
  provider           text not null check (provider in ('salesforce')),
  external_user_id   text not null,         -- e.g. SF 005x... id
  external_org_id    text not null,
  external_email     text not null,
  refresh_token_enc  bytea not null,        -- envelope-encrypted
  refresh_token_kid  text  not null,        -- which DEK encrypted this row
  instance_url       text not null,         -- SF instance origin
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);
```

Acceptance:
- **Envelope encryption.** Each refresh token is encrypted with a per-row data-encryption key (DEK), the DEK wrapped by a key in Supabase Vault (or an external KMS). Plain refresh tokens never sit in DB, backups, replicas, or logs.
- **RLS on `identity_links`** — only the service role can read; no user (including the row's owner) can SELECT via the anon/authenticated role. The MCP server reads it via the service-role key, never the anon key.
- **Server-side only access.** No `NEXT_PUBLIC_` variable touches the vault. The decryption code path lives in a single helper (`lib/identity-vault.ts`) audited as the trust boundary.
- **No logging of credential material.** Structured logs assert at lint time that they don't carry `refresh_token`, `access_token`, or `Authorization` keys (custom redactor).
- **Rotation:** when SF returns a new refresh token on token exchange (rotation is on), the new value is written atomically (single transaction; old value never readable after commit).
- **Revocation hooks:** trigger on `auth.users` deletion → cascade deletes `identity_links` row AND POSTs to SF revoke. (See 2.6.)
- **TTL audit:** rows with `last_used_at` older than 90 days are flagged for revocation by a daily cron.
- **Backup hygiene:** Supabase point-in-time-recovery snapshots are accepted to inherit the encryption (encrypted at rest by Supabase) — `refresh_token_enc` is already ciphertext at the application layer, so a backup leak does not yield usable tokens without the wrapping key.
- **Penetration test item:** "extract a usable SF refresh token given read-only DB access" must fail.

Status: ⬜

---

## 3. End-user stories (the salesperson in Claude)

### 3.1 Guided setup via prompt
**As a** salesperson, **I want** to click "Set Up a Sales Roleplay" in Claude's prompt menu, **so that** I'm walked through the whole flow without remembering tool names.

Acceptance:
- The `setup_sales_roleplay` prompt appears under the Tough Customer connector.
- After invoking it, Claude asks for my email (today) or uses the OAuth identity (post-2.2), then lists opportunities, then contacts, then voice + scenario, then offers backstory, then creates the session.
- Claude always refers to things by name, not ID.

Status: ✅

### 3.2 Ad-hoc discovery
**As a** salesperson, **I want** to say "list my Tough Customer opportunities" in a free-form chat, **so that** I don't have to use the prompt menu.

Acceptance:
- Claude calls `list_opportunities` without additional coaching.
- If it hesitates (answers from general knowledge), a nudge like "use the Tough Customer connector" is enough.

Status: ✅ (works, occasional coaching needed)

### 3.3 Pick a deal
**As a** salesperson, **I want** to see my opportunities with stage and deal size, **so that** I can pick which one to practice.

Acceptance:
- `list_opportunities` returns id, name, stage, amount for each.
- Claude renders a table or numbered list.
- User can reply with a number, a name, or "the GlobalTech one" and Claude resolves it to the ID internally.

Status: ✅

### 3.4 Pick a contact
**As a** salesperson, **I want** to see only the contacts on the deal I picked, **so that** I roleplay against the right buyer.

Acceptance:
- `get_opportunity_contacts` returns only contacts for that opportunity.
- Contacts include name and title.
- Invalid opportunityId returns a clean `TCNotFoundError`.

Status: ✅

### 3.5 Pick voice and scenario
**As a** salesperson, **I want** to see all available voices and scenarios in one step, **so that** picking is fast.

Acceptance:
- `list_voices` returns name, gender, description for each voice.
- `list_scenarios` returns name and description.
- Claude suggests a sensible default scenario based on the deal's stage (e.g. Negotiation → Pricing Negotiation).

Status: ✅

### 3.6 Add optional backstory
**As a** salesperson, **I want** to add free-text context ("Tom just lost his CISO headcount budget"), **so that** the AI buyer behaves realistically.

Acceptance:
- `create_roleplay_session` accepts an optional `backstory` field up to 4000 chars.
- Backstory appears in the returned deal-context summary.
- Omitting backstory produces a clean session with no placeholder text.

Status: ✅

### 3.7 Launch the session
**As a** salesperson, **I want** a shareable session URL I can click to start the roleplay, **so that** I can go straight from chat to practice.

Acceptance:
- `create_roleplay_session` returns a `https://www.toughcustomer.ai/session/sess_xxx` URL.
- Claude renders it as a clickable link in its response.
- The session response includes the full deal context so Claude can prep me before I click.

Status: ✅ (URL is currently mocked)

### 3.8 Pre-call coaching
**As a** salesperson, **I want** Claude to give me 3–5 bullet points of prep based on the deal context, **so that** I'm ready when the roleplay starts.

Acceptance:
- After `create_roleplay_session` returns, Claude summarizes the buyer, scenario, and any backstory.
- Coaching bullets are concrete ("expect pushback on 'why now'") not generic.

Status: ✅ (behavior of the current prompt)

### 3.9 Errors surface cleanly
**As a** salesperson, **I want** to see a readable error if something goes wrong, **so that** I know whether to retry, pick again, or ask my admin.

Acceptance:
- `TCNotFoundError`, `TCUnauthorizedError`, and generic errors all return `isError: true` with a single `text` message prefixed `Error:`.
- Claude shows the error to me and offers the next reasonable action (pick again, re-auth, etc.).

Status: ✅

### 3.10 Session continuity across chats
**As a** salesperson, **I want** Claude to remember who I am across chats (post-OAuth), **so that** I don't get asked for my email every conversation.

Acceptance (post-2.2):
- The Supabase access + refresh tokens are stored at connector level, not chat level.
- A new chat with Tough Customer tools enabled does not prompt for identity.
- Token refresh happens silently against Supabase; the user does not see a re-auth dialog.
- The Salesforce link persists across chats and Claude sessions — once linked at `app.toughcustomer.ai/connect`, the user is not asked to reconnect Salesforce until they explicitly disconnect or SF revokes the refresh token.

Status: ⬜

---

## 4. Operator stories

### 4.1 Add / remove opportunities without redeploy
**As an** operator, **I want** the opportunity list to come from a live source, **so that** I don't redeploy the MCP server every time sales data changes.

Acceptance:
- `listOpportunities()` fetches from the real Tough Customer API (or Supabase).
- Cache TTL is short (≤ 60s) or explicitly bypassed.

Status: ⬜

### 4.2 Manage voices and scenarios
**As an** operator, **I want** to add new voices and scenarios without a code deploy, **so that** I can iterate on the product offering.

Acceptance:
- Voices and scenarios live in a Tough Customer admin table, not a TypeScript constant.
- A new row appears in `list_voices` / `list_scenarios` within one cache TTL.

Status: ⬜

### 4.3 Observability
**As an** operator, **I want** tool-call latency and error-rate metrics, **so that** I can catch regressions.

Acceptance:
- p50/p95 latency and error rate per tool visible in Vercel analytics or an external APM.
- Alert fires if error rate > 5% over 5 minutes.

Status: ⬜

### 4.4 Rate limiting
**As an** operator, **I want** per-user rate limits on `create_roleplay_session`, **so that** a runaway agent can't spin up thousands of sessions.

Acceptance:
- ≤ N sessions per user per hour (config via env var).
- Over-limit returns `429` with a `Retry-After` hint.

Status: ⬜

---

## 5. Non-goals (explicitly out of scope)

- Inline UI widgets in Claude (ui:// rawHtml resources) — Claude Desktop and claude.ai don't render them yet.
- HubSpot / Dynamics / other CRM backends — Model B is designed to support them later via additional `identity_links` providers, but they are not in scope for v1.
- Multi-tenant data in a single deployment — each tenant should fork-and-deploy for now.
- Streaming tool responses — current responses are small enough to return whole.
- **Salesforce as the OAuth Authorization Server for Claude** — explicitly *replaced* by Model B (Supabase as AS). The prototype's SF-as-AS path remains in `main` only until Model B is shipped, then deleted.
- **Service-account / JWT Bearer Flow against Salesforce** — every SF call runs as the linked end user. A shared integration credential is never introduced.

---

## 6. Roadmap (by priority)

1. **Supabase as AS + custom domain (2.2 + 1.5)** — replaces the prototype's SF-as-AS path. Unblocks everything else.
2. **Credential vault (2.7)** — required before any production Salesforce connection. Cannot ship Model B without this.
3. **SF account-linking flow (sub-flow of 2.2)** — `app.toughcustomer.ai/connect` page + `link-salesforce` Edge Function.
4. **SF REST GraphQL end-to-end (1.2 + 2.3)** — wire the linked-token path through to real SF data; create custom objects + fields per `docs/SALESFORCE_OBJECTS.md`.
5. **Token revocation (2.6) + domain allow-listing (2.4)** — close the boundary.
6. **Audit log (2.5) + observability (4.3)** — production readiness.
7. **Live data sources (4.1, 4.2)** — operator ergonomics.
8. **Rate limiting (4.4)** — cost control.

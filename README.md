# Tough Customer MCP

Remote **MCP server** (Next.js on Vercel) that exposes the Tough Customer
roleplay setup workflow to LLM clients (Claude, ChatGPT, MCP Inspector).

Auth model: **Model B** — Supabase Auth is the OAuth Authorization Server.
Claude carries a Supabase-issued JWT, never a raw Salesforce token.
Salesforce is a downstream backend; users link it once at `/connect`, and
the MCP server stores an envelope-encrypted refresh token and mints
short-lived SF access tokens per request. SOQL runs `WITH USER_MODE`, so
Salesforce enforces FLS + sharing as the linked end user.

See `userstories.md` (especially §2.1, §2.2, §2.7) for the full architecture
and security rationale.

## Endpoints

| Route | Purpose |
| --- | --- |
| `/mcp` | MCP streamable-HTTP endpoint (connect Claude here) |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata pointing at the Supabase AS |
| `/connect` | One-time Salesforce account-linking UI |
| `/connect/start` | Begins SF PKCE flow |
| `/connect/callback` | SF redirect target — server-side token exchange + vault save |
| `/connect/disconnect` | Removes SF link, revokes refresh token at SF |
| `/auth/signin`, `/auth/callback`, `/auth/signout` | Supabase Google OAuth glue |
| `/` | Landing page |

## Tools exposed

- `list_opportunities`
- `list_voices`
- `list_scenarios`
- `get_opportunity_contacts`
- `create_roleplay_session`
- Prompt: `setup_sales_roleplay`

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
# http://localhost:3000
# MCP endpoint: http://localhost:3000/mcp
```

For local dev without Supabase / Salesforce, set `TC_MODE=mock` — the server
serves in-memory data and skips auth.

Inspect with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL: http://localhost:3000/mcp
```

## Deploy to Vercel

```bash
gh repo create mcp --public --source=. --remote=origin --push
npx vercel link
npx vercel --prod
```

Provision Supabase via the **Vercel Marketplace** integration so
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` are auto-populated across all environments.

Apply database migrations:

```bash
supabase db push
```

Custom domains (production):

- `mcp.toughcustomer.ai` → this Vercel project
- `app.toughcustomer.ai` → this Vercel project (alias; serves `/connect`)
- `auth.toughcustomer.ai` → Supabase (custom hostname; see `docs/CUSTOM_DOMAIN.md`)

## Salesforce setup

The Connected App is a **downstream backend**, not the AS for Claude.
See `docs/SALESFORCE_SETUP.md` for the Connected App runbook and
`docs/SALESFORCE_OBJECTS.md` for the custom objects + fields the SF admin
must create. **No Apex deploy required** — the MCP server uses SF REST
GraphQL exclusively, which enforces FLS + sharing for all profiles
including admins.

## Vault graduation

v1 encrypts SF refresh tokens with AES-256-GCM keyed by the `VAULT_KEY_V1`
env var. Before any non-internal customer connects real Salesforce data,
graduate to Supabase Vault or external KMS — see `docs/VAULT_V2.md`.

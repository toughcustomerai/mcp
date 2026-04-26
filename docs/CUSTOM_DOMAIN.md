# Custom domain — Supabase Auth at `auth.toughcustomer.ai`

userstories.md §1.5. The Supabase Auth surface (login, token, JWKS,
well-known metadata) and the `link-salesforce` callback path live under our
own brand domain so Claude users see `auth.toughcustomer.ai` — not a
`*.supabase.co` URL — when consenting.

## One-time setup

1. **Supabase Pro plan.** Custom Domains is a Pro feature.
2. **Project Settings → Custom Domains** → register `auth.toughcustomer.ai`.
   Supabase displays the CNAME target.
3. **DNS:** add a CNAME at your DNS provider:
   ```
   auth.toughcustomer.ai  CNAME  <project-ref>.supabase.co.
   ```
   Verify with:
   ```bash
   dig CNAME auth.toughcustomer.ai
   ```
4. **TLS:** Supabase issues + auto-renews. Verify:
   ```bash
   curl -vI https://auth.toughcustomer.ai
   ```
   Must return a Supabase-issued cert valid for the host.
5. **Update `SITE_URL`** in Supabase Auth settings to `https://auth.toughcustomer.ai`. This changes the `iss` claim on issued JWTs.
6. **Update OAuth redirect URLs:**
   - Google OAuth (Supabase Auth's provider) — set redirect to
     `https://auth.toughcustomer.ai/auth/v1/callback`.
   - Salesforce Connected App — set the callback URL to whatever the MCP
     project advertises for `/connect/callback` (e.g.
     `https://app.toughcustomer.ai/connect/callback`). The SF callback does
     NOT go through Supabase in our setup; see `app/connect/callback/route.ts`.
7. **Vercel env vars:**
   ```
   AUTH_BASE_URL=https://auth.toughcustomer.ai
   ```
   `app/.well-known/oauth-protected-resource/route.ts` reads this and
   advertises it as the `authorization_servers` entry to MCP clients.

## CNAME rotation runbook

If Supabase rotates the CNAME target (rare; happens during Supabase
infrastructure changes), the steps are:

1. Watch for a notice in the Supabase dashboard or via support.
2. Update the CNAME at the DNS provider to the new target.
3. Wait for DNS propagation (`dig CNAME auth.toughcustomer.ai` reflects the
   new target on at least two resolvers).
4. Confirm `https://auth.toughcustomer.ai/auth/v1/.well-known/openid-configuration`
   returns the expected JSON.
5. Confirm one MCP login through Claude end-to-end.

## Verification (after first deploy)

- `dig CNAME auth.toughcustomer.ai` matches the Supabase-provisioned target.
- `curl https://auth.toughcustomer.ai/auth/v1/.well-known/jwks.json` returns
  the project JWKS.
- `curl https://mcp.toughcustomer.ai/.well-known/oauth-protected-resource`
  shows `"authorization_servers": ["https://auth.toughcustomer.ai"]`.
- A token issued by Supabase has `iss: https://auth.toughcustomer.ai/auth/v1`.

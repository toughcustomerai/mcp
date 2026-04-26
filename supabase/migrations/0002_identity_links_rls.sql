-- RLS for identity_links: service-role-only.
--
-- Even the row's owner MUST NOT be able to SELECT their own refresh token via
-- the anon or authenticated role. The MCP server reads this table from a
-- single helper (lib/identity-vault.ts) using the service-role key. Any
-- other access path is a bug.
--
-- We rely on default-deny: enable RLS, define no policies for anon /
-- authenticated. The service role bypasses RLS, so the MCP server still
-- works. Explicit revokes below are belt-and-braces.

alter table public.identity_links enable row level security;

revoke all on table public.identity_links from anon;
revoke all on table public.identity_links from authenticated;
revoke all on table public.identity_links from public;

-- No policies defined for anon or authenticated → default deny.

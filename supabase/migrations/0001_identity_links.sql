-- Per-user account links to downstream provider identities (Salesforce in v1).
-- The encrypted refresh token stored here is the highest-value asset on the
-- server. See userstories.md §2.7 and docs/VAULT_V2.md for the encryption
-- graduation plan.
--
-- Identity model recap (Model B):
--   Supabase Auth issues the JWT Claude carries.
--   This table maps {supabase_user_id} → {provider, encrypted refresh_token,
--   instance_url}. The MCP server reads it via the service role to mint a
--   fresh SF access token per request.

create table public.identity_links (
  supabase_user_id   uuid primary key references auth.users(id) on delete cascade,
  provider           text not null check (provider in ('salesforce')),
  external_user_id   text not null,
  external_org_id    text not null,
  external_email     text not null,
  refresh_token_enc  bytea not null,
  refresh_token_kid  text  not null,
  instance_url       text not null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);

create index identity_links_provider_idx
  on public.identity_links(provider);

create index identity_links_external_user_idx
  on public.identity_links(provider, external_user_id);

comment on table public.identity_links is
  'Per-user encrypted refresh tokens for downstream identity providers. Service-role read only — RLS in 0002.';

comment on column public.identity_links.refresh_token_kid is
  'Key id used to encrypt refresh_token_enc. lib/identity-vault.ts switches on this so v1 ciphertext keeps decrypting after key rotation / vault graduation.';

# Vault v2 — production crypto graduation

## Status
Deferred decision. v1 ships with **AES-256-GCM** keyed by `VAULT_KEY_V1` (32 bytes, base64 in a server-only env var). The encryption itself is sound, but the wrapping key sits in env-var stores; key rotation requires re-encrypting every row, and an env-var leak compromises every refresh token in the table.

## Gating criterion
**Graduate to v2 before the first non-internal customer onboards.**
Internal-only / staff testing on v1 is acceptable. Any external Salesforce org connecting via Tough Customer must be sitting on v2.

## Candidates

| Option | Pros | Cons |
|---|---|---|
| **Supabase Vault** | Native to Supabase, currently `public alpha`. The wrapping key is held in Supabase's secured backend, **not in your Postgres** ("the encryption key is never stored in the database alongside the encrypted data" — [docs](https://supabase.com/docs/guides/database/vault#encryption-key-location)). API: `vault.create_secret(...)`, `vault.update_secret(...)`, `vault.decrypted_secrets` view. Per-user envelope = one Vault secret per `identity_links` row. | `public alpha` status. No documented self-serve key rotation. The decrypted-secrets view must be locked down via SQL privileges — ours already is via service-role-only RLS. |
| **External KMS (AWS KMS / GCP KMS)** | Wrapping key in a dedicated vendor with IAM, audit, and rotation. Strongest separation of duties. Per-row envelope encryption (DEK wrapped by KMS) is the standard pattern. | Adds a vendor + IAM setup. KMS call on every encrypt/decrypt. Higher operational burden. |

**Important:** do NOT use `pgsodium` directly. Per the [pgsodium extension docs](https://supabase.com/docs/guides/database/extensions/pgsodium): *"Supabase DOES NOT RECOMMEND any new usage of `pgsodium`. The `pgsodium` extension is expected to go through a deprecation cycle in the near future."* Vault itself is keeping its public API — its internal implementation is moving off pgsodium — so target Vault, not pgsodium primitives. Transparent Column Encryption is also explicitly discouraged.

Default lean: **Supabase Vault**, unless a customer security review explicitly demands an external KMS.

## Migration shape

The interface in `lib/identity-vault.ts` is structured so the swap is a one-file change. No schema migration needed — `identity_links.refresh_token_kid` already discriminates.

1. Add a new `kid` constant in `lib/identity-vault.ts` (e.g. `v2-vault` or `v2-kms`).
2. Implement the v2 branch of `encryptRefreshToken` / `decryptRefreshToken`.
3. New writes go through the v2 path. Reads still switch on `kid`, so v1 ciphertext keeps decrypting transparently.
4. Run a one-shot re-encryption job: for every row where `refresh_token_kid = 'v1-env'`, decrypt with v1, re-encrypt with v2, update `(refresh_token_enc, refresh_token_kid)` atomically.
5. Once `select count(*) from identity_links where refresh_token_kid = 'v1-env'` returns 0, delete the v1 branch from `decryptRefreshToken` and remove `VAULT_KEY_V1` from env.

## Open questions for v2

- KMS vendor (AWS vs GCP), if external KMS is chosen.
- Whether to encrypt other columns (e.g. `external_email`). Currently only `refresh_token_enc` is sensitive enough to warrant the extra cost.
- Whether to enforce per-row DEKs (envelope encryption) vs direct encryption with the wrapping key. Per-row DEKs are the standard pattern and what AWS/GCP examples show; we'd cache decrypted DEKs in-memory for the function instance lifetime to keep latency low.
- Backup story: confirm that ciphertext-only PITR snapshots are sufficient for the customer security review checklist.

## Acceptance for v2 graduation

- All `identity_links` rows have `refresh_token_kid != 'v1-env'`.
- `VAULT_KEY_V1` removed from every Vercel environment.
- Pen-test item from userstories.md §2.7 passes: a read-only Postgres role + a leaked Vercel env-var dump cannot together yield a usable SF refresh token.
- Runbook in `docs/CUSTOM_DOMAIN.md`-style sibling: `docs/VAULT_ROTATION.md` covers ongoing key rotation.

// Single trust boundary for per-user Salesforce refresh tokens.
//
// v1 encryption: AES-256-GCM, key from VAULT_KEY_V1 env var (32 bytes,
// base64). Functional but the wrapping key sits in env-var stores; this is
// acceptable for internal/alpha use only. v2 graduation (Supabase Vault or
// external KMS) is gated on the first non-internal customer — see
// docs/VAULT_V2.md.
//
// The decryptRefreshToken switch is keyed on `kid` so v1 ciphertext keeps
// decrypting after v2 ships. Plaintext refresh tokens never leave this file
// except via loadIdentityLink's return value, which the caller is expected
// to use immediately and not log.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const KID_V1 = "v1-env";

// On-disk layout (single bytea column):
//   [iv (12)] [authTag (16)] [ciphertext (n)]
const IV_LEN = 12;
const TAG_LEN = 16;

export interface IdentityLink {
  instanceUrl: string;
  externalUserId: string;
  externalOrgId: string;
  externalEmail: string;
  refreshTokenPlaintext: string;
}

export interface CipherBlob {
  ciphertext: Buffer;
  kid: string;
}

function loadVaultKey(): Buffer {
  const b64 = process.env.VAULT_KEY_V1;
  if (!b64) {
    throw new Error(
      "VAULT_KEY_V1 is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("VAULT_KEY_V1 must decode to 32 bytes (AES-256)");
  }
  return key;
}

export function encryptRefreshToken(plaintext: string): CipherBlob {
  const key = loadVaultKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([iv, tag, enc]), kid: KID_V1 };
}

export function decryptRefreshToken(blob: CipherBlob): string {
  switch (blob.kid) {
    case KID_V1: {
      const key = loadVaultKey();
      const iv = blob.ciphertext.subarray(0, IV_LEN);
      const tag = blob.ciphertext.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const enc = blob.ciphertext.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString("utf8");
    }
    default:
      throw new Error(`Unknown vault kid: ${blob.kid}`);
  }
}

// ─── Supabase service-role client (server-only) ──────────────────────────

let serviceClient: SupabaseClient | null = null;

function svc(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service-role env vars missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

// ─── Vault API ────────────────────────────────────────────────────────────

export async function loadIdentityLink(
  supabaseUserId: string,
): Promise<IdentityLink | null> {
  const { data, error } = await svc()
    .from("identity_links")
    .select(
      "instance_url, external_user_id, external_org_id, external_email, refresh_token_enc, refresh_token_kid",
    )
    .eq("supabase_user_id", supabaseUserId)
    .eq("provider", "salesforce")
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // supabase-js returns bytea as a string with a `\x` hex prefix in some
  // configurations; normalize to Buffer.
  const raw =
    typeof data.refresh_token_enc === "string"
      ? Buffer.from((data.refresh_token_enc as string).replace(/^\\x/, ""), "hex")
      : Buffer.from(data.refresh_token_enc as Uint8Array);

  const refreshTokenPlaintext = decryptRefreshToken({
    ciphertext: raw,
    kid: data.refresh_token_kid,
  });

  // Touch last_used_at; fire-and-forget, do not block the request on it.
  void svc()
    .from("identity_links")
    .update({ last_used_at: new Date().toISOString() })
    .eq("supabase_user_id", supabaseUserId);

  return {
    instanceUrl: data.instance_url,
    externalUserId: data.external_user_id,
    externalOrgId: data.external_org_id,
    externalEmail: data.external_email,
    refreshTokenPlaintext,
  };
}

export interface SaveIdentityLinkInput {
  supabaseUserId: string;
  externalUserId: string;
  externalOrgId: string;
  externalEmail: string;
  refreshToken: string;
  instanceUrl: string;
}

export async function saveIdentityLink(
  input: SaveIdentityLinkInput,
): Promise<void> {
  const { ciphertext, kid } = encryptRefreshToken(input.refreshToken);
  const { error } = await svc().from("identity_links").upsert(
    {
      supabase_user_id: input.supabaseUserId,
      provider: "salesforce",
      external_user_id: input.externalUserId,
      external_org_id: input.externalOrgId,
      external_email: input.externalEmail,
      refresh_token_enc: ciphertext,
      refresh_token_kid: kid,
      instance_url: input.instanceUrl,
      revoked_at: null,
    },
    { onConflict: "supabase_user_id" },
  );
  if (error) throw error;
}

/**
 * Remove a user's link. Best-effort revoke at Salesforce, then delete the row.
 * SF revoke failure is non-fatal — the local row is the source of truth for
 * whether we'll mint new SF access tokens, so deleting the row is sufficient.
 */
export async function deleteIdentityLink(
  supabaseUserId: string,
): Promise<void> {
  const link = await loadIdentityLink(supabaseUserId);
  if (link) {
    const sfLogin = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
    try {
      await fetch(`${sfLogin}/services/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: link.refreshTokenPlaintext }),
      });
    } catch {
      // Swallow; row deletion below is what actually closes the path.
    }
  }
  const { error } = await svc()
    .from("identity_links")
    .delete()
    .eq("supabase_user_id", supabaseUserId);
  if (error) throw error;
}

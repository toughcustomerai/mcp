#!/usr/bin/env bash
# tests/oauth-flow.sh — End-to-end log of the MCP OAuth handshake.
#
# Walks the 6 steps Claude / MCP Inspector goes through when connecting
# to /mcp on this server:
#
#   1. POST /mcp (no auth)               → 401 + WWW-Authenticate
#   2. GET resource_metadata URL         → RFC 9728 protected-resource doc
#   3. GET AS metadata + OIDC + JWKS     → discover endpoints & signing keys
#   4. POST registration_endpoint        → Dynamic Client Registration (RFC 7591)
#   5. Build authorize URL               → manual browser step (logs the URL)
#   6. Token exchange                    → informational (needs auth code from step 5)
#
# Steps 1–4 are fully automated; if any assertion fails the script exits 1.
# Steps 5–6 print URLs / payloads for hand-driving the browser portion.
#
# Usage:
#   bash tests/oauth-flow.sh                              # default: production
#   bash tests/oauth-flow.sh https://other.example.com    # arbitrary deploy
#   MCP_URL=https://...vercel.app bash tests/oauth-flow.sh
#   SKIP_DCR=1 bash tests/oauth-flow.sh                   # don't register a client
#
# Dependencies: curl, jq, openssl. All present on macOS by default.

set -uo pipefail

MCP_URL="${1:-${MCP_URL:-https://mcp-umber-three.vercel.app}}"
SKIP_DCR="${SKIP_DCR:-0}"

# ─── Output helpers ──────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

ok()      { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
fail()    { printf "  ${RED}✗${RESET} %s\n" "$*"; FAILURES=$((FAILURES+1)); }
note()    { printf "  ${DIM}%s${RESET}\n" "$*"; }
heading() { printf "\n${BOLD}${YELLOW}── %s ──${RESET}\n" "$*"; }

FAILURES=0

printf "${BOLD}MCP OAuth handshake trace${RESET}\n"
printf "  target: %s\n" "$MCP_URL"

# ═══ Step 1 ══════════════════════════════════════════════════════════════
heading "Step 1 / 6 — POST /mcp without credentials"
note "Expected: 401 with WWW-Authenticate: Bearer realm=\"mcp\" resource_metadata=\"…\""

TMP_HEADERS=$(mktemp)
trap 'rm -f "$TMP_HEADERS"' EXIT

curl --silent --output /dev/null --dump-header "$TMP_HEADERS" \
  -X POST "$MCP_URL/mcp" \
  -H "content-type: application/json" \
  -d '{}'

STATUS=$(awk 'NR==1 {print $2}' "$TMP_HEADERS")
WWW_AUTH=$(grep -i '^www-authenticate:' "$TMP_HEADERS" | head -1 | sed 's/^[^:]*: //I' | tr -d '\r')

if [ "$STATUS" = "401" ]; then
  ok "HTTP 401 returned"
else
  fail "expected 401, got $STATUS"
fi

if [ -n "$WWW_AUTH" ]; then
  ok "WWW-Authenticate: $WWW_AUTH"
else
  fail "no WWW-Authenticate header — Claude won't know to start OAuth"
fi

RESOURCE_METADATA_URL=$(printf '%s' "$WWW_AUTH" | sed -nE 's/.*resource_metadata="([^"]+)".*/\1/p')
if [ -n "$RESOURCE_METADATA_URL" ]; then
  ok "resource_metadata: $RESOURCE_METADATA_URL"
else
  fail "no resource_metadata URL in WWW-Authenticate — bailing"
  exit 1
fi

# ═══ Step 2 ══════════════════════════════════════════════════════════════
heading "Step 2 / 6 — Fetch RFC 9728 protected-resource metadata"
note "GET $RESOURCE_METADATA_URL"

META=$(curl --silent "$RESOURCE_METADATA_URL")

if echo "$META" | jq -e '.authorization_servers' >/dev/null 2>&1; then
  ok "JSON valid, authorization_servers present"
else
  fail "metadata invalid or missing authorization_servers"
  echo "$META" | head -5
  exit 1
fi

AS_URL=$(echo "$META" | jq -r '.authorization_servers[0]')
AS_METADATA_URL=$(echo "$META" | jq -r '.authorization_server_metadata // empty')
OIDC_URL=$(echo "$META" | jq -r '.openid_configuration // empty')
SCOPES=$(echo "$META" | jq -r '.scopes_supported // [] | join(" ")')

ok "authorization server: $AS_URL"
ok "scopes advertised:    $SCOPES"
[ -n "$AS_METADATA_URL" ] && ok "AS metadata URL:      $AS_METADATA_URL" \
                          || note "(no explicit AS metadata URL; will probe canonical path)"

# ═══ Step 3 ══════════════════════════════════════════════════════════════
heading "Step 3 / 6 — Authorization-server discovery + JWKS"

# 3a. AS metadata
if [ -n "$AS_METADATA_URL" ]; then
  note "GET $AS_METADATA_URL"
  AS_META=$(curl --silent "$AS_METADATA_URL")
else
  CANON="$AS_URL/.well-known/oauth-authorization-server"
  note "GET $CANON  (no explicit URL — trying canonical path)"
  AS_META=$(curl --silent "$CANON")
fi

if echo "$AS_META" | jq -e '.token_endpoint' >/dev/null 2>&1; then
  ok "AS metadata document loaded"
else
  fail "AS metadata invalid"
  echo "$AS_META" | head -5
  exit 1
fi

AUTHZ_EP=$(echo "$AS_META" | jq -r '.authorization_endpoint')
TOKEN_EP=$(echo "$AS_META" | jq -r '.token_endpoint')
REG_EP=$(echo "$AS_META" | jq -r '.registration_endpoint // empty')
JWKS_URI=$(echo "$AS_META" | jq -r '.jwks_uri')

ok "authorization_endpoint: $AUTHZ_EP"
ok "token_endpoint:         $TOKEN_EP"
if [ -n "$REG_EP" ]; then
  ok "registration_endpoint:  $REG_EP"
else
  note "registration_endpoint:  (not advertised — DCR disabled)"
fi
ok "jwks_uri:               $JWKS_URI"

# 3b. OIDC discovery (sanity)
if [ -n "$OIDC_URL" ]; then
  note "GET $OIDC_URL"
  OIDC=$(curl --silent "$OIDC_URL")
  if echo "$OIDC" | jq -e '.issuer' >/dev/null 2>&1; then
    OIDC_ISSUER=$(echo "$OIDC" | jq -r '.issuer')
    ok "OIDC issuer: $OIDC_ISSUER"
  else
    fail "OIDC discovery doc invalid"
  fi
fi

# 3c. JWKS — must be non-empty for offline JWT verification to work
note "GET $JWKS_URI"
JWKS=$(curl --silent "$JWKS_URI")
KEY_COUNT=$(echo "$JWKS" | jq '.keys | length' 2>/dev/null || echo "0")
if [ "$KEY_COUNT" -gt 0 ] 2>/dev/null; then
  KEY_ALGS=$(echo "$JWKS" | jq -r '[.keys[].alg] | unique | join(",")')
  ok "JWKS has $KEY_COUNT key(s), algs: $KEY_ALGS"
else
  fail "JWKS empty — project is on legacy HS256, offline JWT verification will fail"
  fail "  → fix: Authentication → JWT Keys → migrate to asymmetric signing keys"
fi

# ═══ Step 4 ══════════════════════════════════════════════════════════════
heading "Step 4 / 6 — Dynamic Client Registration"

CLIENT_ID=""
REG_CLIENT_URI=""
REG_TOKEN=""

if [ "$SKIP_DCR" = "1" ]; then
  note "skipped (SKIP_DCR=1)"
elif [ -z "$REG_EP" ]; then
  fail "no registration_endpoint advertised — Claude can't self-register"
  fail "  → fix: Supabase → Authentication → OAuth Server → Allow Dynamic OAuth Apps"
else
  note "POST $REG_EP"
  REG_BODY=$(jq -n \
    --arg name "MCP smoke test (auto-cleanup)" \
    --arg scope "$SCOPES" \
    '{
      client_name: $name,
      redirect_uris: ["http://localhost:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: $scope
    }')

  REG_RESP=$(curl --silent -X POST "$REG_EP" \
    -H "content-type: application/json" \
    -d "$REG_BODY")

  CLIENT_ID=$(echo "$REG_RESP" | jq -r '.client_id // empty')
  REG_CLIENT_URI=$(echo "$REG_RESP" | jq -r '.registration_client_uri // empty')
  REG_TOKEN=$(echo "$REG_RESP" | jq -r '.registration_access_token // empty')

  if [ -n "$CLIENT_ID" ]; then
    ok "registered, client_id: $CLIENT_ID"
    GRANTED_SCOPES=$(echo "$REG_RESP" | jq -r '.scope // ""')
    [ -n "$GRANTED_SCOPES" ] && ok "granted scopes: $GRANTED_SCOPES"
  else
    fail "DCR response missing client_id"
    echo "$REG_RESP" | jq . 2>/dev/null | head -10 || echo "$REG_RESP" | head -10
  fi
fi

# ═══ Step 5 ══════════════════════════════════════════════════════════════
heading "Step 5 / 6 — Authorize URL (manual browser step)"

if [ -n "$CLIENT_ID" ]; then
  STATE=$(openssl rand -hex 16)
  # PKCE code_verifier: 43-128 chars from [A-Z][a-z][0-9]-._~
  CODE_VERIFIER=$(openssl rand -base64 64 | tr -d '=+/\n' | head -c 64)
  CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | \
    openssl dgst -sha256 -binary | \
    openssl base64 | tr -d '=\n' | tr '/+' '_-')

  # URL-encode the redirect_uri and scope
  ENC_REDIRECT=$(printf 'http://localhost:9999/callback' | jq -sRr @uri)
  ENC_SCOPE=$(printf '%s' "$SCOPES" | jq -sRr @uri)

  AUTH_URL="${AUTHZ_EP}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${ENC_REDIRECT}&scope=${ENC_SCOPE}&state=${STATE}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"

  ok "open this URL in a browser to drive consent:"
  printf "    ${BLUE}%s${RESET}\n" "$AUTH_URL"
  note "flow:"
  note "  1. sign in to Supabase (Google OAuth)"
  note "  2. you'll land on $MCP_URL/oauth/consent — click Approve"
  note "  3. browser will be redirected to http://localhost:9999/callback?code=...&state=..."
  note "  4. (the localhost callback will fail — expected; copy the ?code= value for step 6)"
  echo ""
  ok "PKCE values for step 6 (save these):"
  note "  code_verifier=$CODE_VERIFIER"
  note "  state=$STATE"
else
  note "skipped (no client_id from step 4)"
fi

# ═══ Step 6 ══════════════════════════════════════════════════════════════
heading "Step 6 / 6 — Token exchange (informational)"

if [ -n "$CLIENT_ID" ]; then
  note "after copying ?code=… from step 5, run:"
  cat <<EOF

    curl -s -X POST $TOKEN_EP \\
      -H 'content-type: application/x-www-form-urlencoded' \\
      --data-urlencode 'grant_type=authorization_code' \\
      --data-urlencode 'code=<paste from step 5>' \\
      --data-urlencode 'redirect_uri=http://localhost:9999/callback' \\
      --data-urlencode 'client_id=$CLIENT_ID' \\
      --data-urlencode 'code_verifier=$CODE_VERIFIER' | jq .

EOF
  note "expected response:"
  note "  { access_token: <JWT>, refresh_token: <opaque>, token_type: 'Bearer', expires_in: 3600 }"
  echo ""
  note "then test the MCP endpoint with that JWT:"
  cat <<EOF

    curl -s -X POST $MCP_URL/mcp \\
      -H 'authorization: Bearer <access_token>' \\
      -H 'content-type: application/json' \\
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .

EOF
fi

# ═══ Cleanup ═════════════════════════════════════════════════════════════
heading "Cleanup"
if [ -n "$REG_CLIENT_URI" ] && [ -n "$REG_TOKEN" ]; then
  CLEANUP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    -X DELETE "$REG_CLIENT_URI" \
    -H "authorization: Bearer $REG_TOKEN")
  if [ "$CLEANUP_STATUS" = "204" ] || [ "$CLEANUP_STATUS" = "200" ]; then
    ok "deleted test client (RFC 7592 DELETE → $CLEANUP_STATUS)"
  else
    note "could not auto-clean test client (DELETE → $CLEANUP_STATUS)"
    note "  → manual cleanup: Supabase dashboard → Authentication → OAuth Apps → delete $CLIENT_ID"
  fi
elif [ -n "$CLIENT_ID" ]; then
  note "no registration_client_uri returned — clean up manually:"
  note "  Supabase dashboard → Authentication → OAuth Apps → delete $CLIENT_ID"
else
  note "nothing to clean up"
fi

# ═══ Summary ═════════════════════════════════════════════════════════════
heading "Summary"
if [ "$FAILURES" -eq 0 ]; then
  printf "  ${GREEN}${BOLD}all automated steps (1-4) passed${RESET}\n"
  printf "  ${DIM}steps 5-6 require a browser + Supabase user session${RESET}\n"
  exit 0
else
  printf "  ${RED}${BOLD}%d step(s) failed${RESET}\n" "$FAILURES"
  exit 1
fi

# tests/

Smoke tests for the MCP server's OAuth handshake.

## `oauth-flow.sh` — end-to-end OAuth handshake trace

Walks the 6-step OAuth dance Claude / MCP Inspector goes through when
connecting to `/mcp`, logging each step. Useful as a regression test after
any auth-related change and for debugging when a real MCP client can't
connect.

```bash
# Default: hits production (mcp-umber-three.vercel.app)
bash tests/oauth-flow.sh

# Against an arbitrary deploy
bash tests/oauth-flow.sh https://mcp-<hash>-toughcustomerai.vercel.app

# Against a local dev server
MCP_URL=http://localhost:3000 bash tests/oauth-flow.sh

# Skip the DCR step (won't register/cleanup a transient OAuth client)
SKIP_DCR=1 bash tests/oauth-flow.sh
```

### What it covers

| Step | Automated? | What's checked |
|---|---|---|
| 1. `POST /mcp` returns 401 + WWW-Authenticate | ✅ yes | status, header presence, `resource_metadata` URL extracted |
| 2. RFC 9728 protected-resource metadata | ✅ yes | JSON valid, `authorization_servers`, `scopes_supported` |
| 3a. AS metadata (RFC 8414) | ✅ yes | `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `jwks_uri` |
| 3b. OIDC discovery | ✅ yes | `issuer` |
| 3c. JWKS | ✅ yes | non-empty key set; flags legacy HS256 projects |
| 4. Dynamic Client Registration (RFC 7591) | ✅ yes | POST returns `client_id`; cleans up via RFC 7592 DELETE |
| 5. Authorize URL with PKCE | logs only | URL is built and printed; user opens in browser |
| 6. Token exchange | logs only | curl template printed with the PKCE `code_verifier` |

### Exit codes

- `0` — steps 1–4 all passed
- `1` — at least one step failed (specific failures printed inline)

### Common failure modes

- **`expected 401, got 200`** — `TC_MODE` is `mock` on this deploy, the auth gate is a pass-through. Set `TC_MODE=live` in Vercel for the env you're testing.
- **`JWKS empty`** — Supabase project is still on legacy HS256 signing. Migrate via Supabase dashboard → Authentication → JWT Keys.
- **`no registration_endpoint advertised`** — DCR is off. Supabase dashboard → Authentication → OAuth Server → toggle "Allow Dynamic OAuth Apps".
- **`DCR response missing client_id`** — usually means OAuth Server itself isn't enabled, or the project doesn't have a configured Site URL. Check the OAuth Server settings page.

### Manual portion (steps 5–6)

The script can't drive a browser, so steps 5 and 6 are logged for hand-running. The script prints:

- The full authorize URL (open in a browser)
- The PKCE `code_verifier` to use in the token exchange
- The exact `curl` command for the token exchange, with the `code_verifier` already substituted
- A second `curl` showing how to call `POST /mcp` with the resulting access token

Step 5's redirect lands on `http://localhost:9999/callback` (a port that isn't running anything, by design — the browser will show a connection error, which is expected; just copy the `?code=` from the URL bar).

// Strips credential-bearing keys from anything we log.
//
// Always route log payloads through redact() before they hit console.* or
// any structured logger. Add new sensitive keys here; never log credentials
// directly bypassing this helper.

const SENSITIVE_KEYS = new Set([
  "refresh_token",
  "refreshtoken",
  "access_token",
  "accesstoken",
  "authorization",
  "token",
  "password",
  "client_secret",
  "code_verifier",
  "id_token",
  "idtoken",
]);

const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|x-.*-token|.*-secret)$/i;

export function redact<T>(value: T): T {
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => walk(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || SENSITIVE_HEADER_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = walk(v, seen);
    }
  }
  return out;
}

/** Convenience: stringify safely for log lines. */
export function redactJSON(value: unknown): string {
  return JSON.stringify(redact(value));
}

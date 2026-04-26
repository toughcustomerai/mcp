// Email-domain allow-list for the MCP server.
//
// userstories.md §2.4. Reads `MCP_ALLOWED_DOMAINS` (comma-separated). If set,
// only callers whose verified email domain is in the list are admitted; if
// unset, the gate is open (no restriction).

export class TCForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TCForbiddenError";
  }
}

function allowedDomains(): string[] | null {
  const raw = process.env.MCP_ALLOWED_DOMAINS;
  if (!raw) return null;
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string): boolean {
  const list = allowedDomains();
  if (!list) return true;
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@")[1].toLowerCase();
  return list.includes(domain);
}

export function assertAllowed(email: string): void {
  if (!isAllowed(email)) {
    throw new TCForbiddenError(
      `Email domain not on the allow list. Contact your administrator.`,
    );
  }
}

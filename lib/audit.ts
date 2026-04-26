// Append-only audit writer. userstories.md §2.5.
//
// Every MCP tool call ends with auditToolCall(). Failures are still logged.
// Writes are fire-and-forget — never block the user-visible response on the
// log write. If the DB is down we degrade to console.error rather than fail
// the request.

import { getSupabaseServiceClient } from "./supabase-server";
import { redact } from "./log-redactor";

export interface AuditCallInput {
  userId: string | null;
  email: string | null;
  tool: string;
  success: boolean;
  latencyMs: number;
  errorKind?: string;
  errorMessage?: string;
  inputsSummary?: Record<string, unknown>;
}

export function auditToolCall(input: AuditCallInput): void {
  // Redact the inputs summary defensively even though callers should already
  // have stripped credentials. Belt and braces.
  const safeInputs = input.inputsSummary
    ? redact(input.inputsSummary)
    : null;

  void getSupabaseServiceClient()
    .from("mcp_audit_log")
    .insert({
      user_id: input.userId,
      email: input.email,
      tool: input.tool,
      success: input.success,
      latency_ms: input.latencyMs,
      error_kind: input.errorKind ?? null,
      error_message: input.errorMessage ?? null,
      inputs_summary: safeInputs,
    })
    .then(({ error }) => {
      if (error) {
        console.error(
          "[audit] insert failed",
          redact({ error: error.message, tool: input.tool }),
        );
      }
    });
}

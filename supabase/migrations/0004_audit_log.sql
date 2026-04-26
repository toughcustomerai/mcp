-- Append-only audit log for MCP tool calls. userstories.md §2.5.
--
-- Every tool invocation writes one row. Failed auth attempts are also
-- logged (with the rejected email if extractable). Inputs are summarized,
-- never logged in full — they may carry user-supplied free text. The
-- redactor in lib/log-redactor.ts strips credential keys defensively.

create table public.mcp_audit_log (
  id            bigserial primary key,
  user_id       uuid,                     -- supabase user id, null on anon failures
  email         text,
  tool          text not null,            -- 'list_opportunities', 'auth_check', etc.
  success       boolean not null,
  latency_ms    integer,
  error_kind    text,                     -- 'TCUnauthorizedError', 'TCNotFoundError', ...
  error_message text,
  inputs_summary jsonb,                   -- e.g. { "opportunityId": "opp_globaltech_..." }
  occurred_at   timestamptz not null default now()
);

create index mcp_audit_log_user_idx on public.mcp_audit_log(user_id, occurred_at desc);
create index mcp_audit_log_tool_idx on public.mcp_audit_log(tool, occurred_at desc);
create index mcp_audit_log_failures_idx on public.mcp_audit_log(occurred_at desc) where success = false;

alter table public.mcp_audit_log enable row level security;
revoke all on table public.mcp_audit_log from anon;
revoke all on table public.mcp_audit_log from authenticated;
revoke all on table public.mcp_audit_log from public;
-- Service-role only. No policies for anon/authenticated → default deny.

comment on table public.mcp_audit_log is
  'Append-only audit trail of MCP tool calls. Service-role write only. Retain >= 90 days per userstories.md §2.5.';

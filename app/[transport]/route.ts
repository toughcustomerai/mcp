import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  createRoleplaySession,
  getOpportunityContacts,
  listOpportunities,
  listScenarios,
  listVoices,
  TCNotFoundError,
  TCUnauthorizedError,
} from "@/lib/tc-service";
import { getCallerIdentity, getSfAuth, isMockMode, type SfAuth } from "@/lib/sf-auth";
import { auditToolCall } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

function handleError(err: unknown): string {
  if (err instanceof TCUnauthorizedError) return `Error: ${err.message}`;
  if (err instanceof TCNotFoundError) return `Error: ${err.message}`;
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: true;
  // mcp-handler expects an open-ended return shape with a string index sig.
  [key: string]: unknown;
}

/**
 * Common wrapper for every tool handler. Resolves identity (so audit has a
 * user even on auth failures from getSfAuth), runs the tool body, and
 * writes one mcp_audit_log row per call (success or failure).
 */
async function runMcpTool(
  toolName: string,
  inputsSummary: Record<string, unknown>,
  body: (auth: SfAuth) => Promise<ToolResult>,
): Promise<ToolResult> {
  const start = Date.now();
  let userId: string | null = null;
  let email: string | null = null;
  try {
    if (!isMockMode()) {
      const id = await getCallerIdentity();
      userId = id.supabaseUserId;
      email = id.email;
    }
    const auth = await getSfAuth();
    const out = await body(auth);
    auditToolCall({
      userId,
      email,
      tool: toolName,
      success: true,
      latencyMs: Date.now() - start,
      inputsSummary,
    });
    return out;
  } catch (err) {
    const e = err as Error;
    auditToolCall({
      userId,
      email,
      tool: toolName,
      success: false,
      latencyMs: Date.now() - start,
      errorKind: e?.name,
      errorMessage: e?.message,
      inputsSummary,
    });
    return {
      isError: true,
      content: [{ type: "text" as const, text: handleError(err) }],
    };
  }
}

const handler = createMcpHandler(
  (server) => {
    // ─── Resources ──────────────────────────────────────────────────────────
    //
    // Resources are kept registered for MCP clients that render them
    // (MCP Inspector, future Claude UI). They still go through auth.

    server.registerResource(
      "opportunities",
      "toughcustomer://opportunities",
      {
        title: "Opportunities",
        description: "List of active sales opportunities for the current user.",
        mimeType: "application/json",
      },
      async (uri) => {
        const auth = await getSfAuth();
        const opportunities = await listOpportunities(auth);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(opportunities, null, 2),
            },
          ],
        };
      },
    );

    server.registerResource(
      "scenarios",
      "toughcustomer://scenarios",
      {
        title: "Scenarios",
        description: "Roleplay scenarios the user can choose from.",
        mimeType: "application/json",
      },
      async (uri) => {
        const auth = await getSfAuth();
        const scenarios = await listScenarios(auth);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(scenarios, null, 2),
            },
          ],
        };
      },
    );

    server.registerResource(
      "voices",
      "toughcustomer://voices",
      {
        title: "Voices",
        description: "Available AI buyer voices.",
        mimeType: "application/json",
      },
      async (uri) => {
        const auth = await getSfAuth();
        const voices = await listVoices(auth);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(voices, null, 2),
            },
          ],
        };
      },
    );

    // ─── Tools ──────────────────────────────────────────────────────────────
    //
    // Identity comes from the Bearer token on the incoming request,
    // NOT from a tool argument. getSfAuth() verifies the token with
    // Salesforce and throws TCUnauthorizedError if it's missing or
    // invalid — that error surfaces to Claude as `isError: true`.

    server.registerTool(
      "list_opportunities",
      {
        title: "List Opportunities",
        description:
          "List all active sales opportunities the CURRENT USER has access to in Salesforce. " +
          "Call this first to let the user pick a deal. Results are scoped by Salesforce sharing rules + FLS.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () =>
        runMcpTool("list_opportunities", {}, async (auth) => {
          const opportunities = await listOpportunities(auth);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(opportunities, null, 2) },
            ],
            structuredContent: {
              opportunities: opportunities.map((o) => ({ ...o })),
            },
          };
        }),
    );

    server.registerTool(
      "list_voices",
      {
        title: "List Voices",
        description: "List all available AI buyer voices.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () =>
        runMcpTool("list_voices", {}, async (auth) => {
          const voices = await listVoices(auth);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(voices, null, 2) },
            ],
            structuredContent: { voices: voices.map((v) => ({ ...v })) },
          };
        }),
    );

    server.registerTool(
      "list_scenarios",
      {
        title: "List Scenarios",
        description: "List all available roleplay scenarios.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () =>
        runMcpTool("list_scenarios", {}, async (auth) => {
          const scenarios = await listScenarios(auth);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(scenarios, null, 2) },
            ],
            structuredContent: { scenarios: scenarios.map((s) => ({ ...s })) },
          };
        }),
    );

    server.registerTool(
      "get_opportunity_contacts",
      {
        title: "Get Opportunity Contacts",
        description:
          "Fetch the list of contacts (buying committee members) attached to a specific opportunity. " +
          "Only contacts visible to the current user under Salesforce sharing rules are returned.",
        inputSchema: {
          opportunityId: z
            .string()
            .min(1)
            .describe(
              "The Salesforce Opportunity Id (15- or 18-char) from list_opportunities. Never invented.",
            ),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ opportunityId }) =>
        runMcpTool("get_opportunity_contacts", { opportunityId }, async (auth) => {
          const contacts = await getOpportunityContacts(auth, opportunityId);
          if (contacts.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No contacts found for opportunity ${opportunityId}.`,
                },
              ],
              structuredContent: { opportunityId, contacts: [] },
            };
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(contacts, null, 2) },
            ],
            structuredContent: { opportunityId, contacts: [...contacts] },
          };
        }),
    );

    server.registerTool(
      "create_roleplay_session",
      {
        title: "Create Roleplay Session",
        description:
          "Initialize a Tough Customer roleplay session. Call this only after the user has chosen " +
          "an opportunity, contact, voice, and scenario. Returns the session URL and compiled deal context. " +
          "Session is created on behalf of the current user.",
        inputSchema: {
          opportunityId: z.string().min(1).describe("Selected opportunity ID."),
          contactId: z.string().min(1).describe("Selected contact ID (must belong to the opportunity)."),
          voiceId: z.string().min(1).describe("Selected voice ID."),
          scenarioId: z.string().min(1).describe("Selected scenario ID."),
          backstory: z
            .string()
            .max(4000)
            .optional()
            .describe("Optional custom backstory / extra context provided by the user."),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (input) =>
        runMcpTool(
          "create_roleplay_session",
          {
            opportunityId: input.opportunityId,
            contactId: input.contactId,
            voiceId: input.voiceId,
            scenarioId: input.scenarioId,
            // backstory length only — never log content; redactor would strip
            // anyway but the audit table doesn't need free text
            backstoryLength: input.backstory?.length ?? 0,
          },
          async (auth) => {
            const session = await createRoleplaySession(auth, input);
            const summary =
              `Session created successfully!\n\n` +
              `URL: ${session.url}\n\n` +
              `Deal context:\n` +
              `- Opportunity: ${session.dealContext.opportunity.name} (${session.dealContext.opportunity.stage}, $${session.dealContext.opportunity.amount.toLocaleString()})\n` +
              `- Contact: ${session.dealContext.contact.name}, ${session.dealContext.contact.title}\n` +
              `- Voice: ${session.dealContext.voice.name} (${session.dealContext.voice.gender}) — ${session.dealContext.voice.description}\n` +
              `- Scenario: ${session.dealContext.scenario.name}` +
              (session.dealContext.backstory ? `\n- Backstory: ${session.dealContext.backstory}` : "");
            return {
              content: [{ type: "text" as const, text: summary }],
              structuredContent: {
                id: session.id,
                url: session.url,
                createdAt: session.createdAt,
                dealContext: {
                  opportunity: { ...session.dealContext.opportunity },
                  contact: { ...session.dealContext.contact },
                  voice: { ...session.dealContext.voice },
                  scenario: { ...session.dealContext.scenario },
                  ...(session.dealContext.backstory
                    ? { backstory: session.dealContext.backstory }
                    : {}),
                },
              },
            };
          },
        ),
    );

    // ─── Prompts ────────────────────────────────────────────────────────────

    server.registerPrompt(
      "setup_sales_roleplay",
      {
        title: "Set Up a Sales Roleplay",
        description:
          "Walks the user through configuring and launching a Tough Customer roleplay session.",
        argsSchema: {
          focus: z
            .string()
            .optional()
            .describe("Optional focus area the user wants to practice (e.g. pricing, discovery)."),
        },
      },
      async ({ focus }) => {
        const focusLine = focus
          ? `The user wants to focus on: ${focus}. Keep this in mind when recommending scenarios.\n\n`
          : "";
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text:
                  `You are the Tough Customer roleplay coordinator. Help the user configure and start a sales roleplay session.\n\n` +
                  focusLine +
                  `Identity: the MCP server authenticates the user via Salesforce OAuth. You never need to ask for an email — every tool call runs as the signed-in Salesforce user, and data is scoped by Salesforce sharing rules + FLS.\n\n` +
                  `Follow this flow exactly — do not skip steps:\n\n` +
                  `1. Call \`list_opportunities\` and present the list. Ask the user which deal they want to practice.\n` +
                  `2. Once they pick one, call \`get_opportunity_contacts\` with that opportunityId. Present the contacts and ask who they want to roleplay against.\n` +
                  `3. Call \`list_voices\` and \`list_scenarios\`. Let the user pick one of each (suggest a sensible default based on the deal stage).\n` +
                  `4. Ask if they want to add an optional backstory / extra context.\n` +
                  `5. Call \`create_roleplay_session\` with all selected IDs. Share the resulting session URL and give a short pre-call coaching summary.\n\n` +
                  `Rules:\n` +
                  `- Always show human-readable names, not IDs.\n` +
                  `- If a tool returns an authorization error, tell the user their Salesforce session may have expired and to reconnect the connector.\n` +
                  `- Don't invent opportunities, contacts, voices, or scenarios — only use what the tools return.`,
              },
            },
          ],
        };
      },
    );
  },
  {},
  {
    basePath: "",
    maxDuration: 60,
    verboseLogs: false,
  },
);

// ─── Auth gate ────────────────────────────────────────────────────────────
//
// MCP spec (2025-06-18+) requires protected resources to respond with
// HTTP 401 and a `WWW-Authenticate: Bearer resource_metadata="…"` header
// when a request has no credentials. MCP clients use this to trigger
// the OAuth flow automatically.
//
// In live mode (default) the gate is ALWAYS on: every request must carry
// `Authorization: Bearer <supabase-jwt>`. In TC_MODE=mock the gate is a
// pass-through so local dev / connector smoke tests work without auth.
//
// Token *validity* (not just presence) is checked inside each tool handler
// via getSfAuth() → getCallerIdentity() (JWKS validation). That path returns
// `isError: true` to Claude, which is what you want once the user has a
// token — only the missing-token case needs protocol-level 401 to kick off
// OAuth.

function publicBaseUrl(): string {
  if (process.env.MCP_PUBLIC_URL) return process.env.MCP_PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

function unauthenticatedResponse(): Response {
  const metadataUrl = `${publicBaseUrl()}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized. Sign in via Tough Customer.",
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${metadataUrl}"`,
      },
    },
  );
}

function withAuthGate(
  inner: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (!isMockMode()) {
      const authz = req.headers.get("authorization") ?? req.headers.get("Authorization");
      if (!authz || !/^Bearer\s+.+/i.test(authz)) {
        return unauthenticatedResponse();
      }
    }
    return inner(req);
  };
}

const guardedHandler = withAuthGate(handler as (req: Request) => Promise<Response>);

export {
  guardedHandler as GET,
  guardedHandler as POST,
  guardedHandler as DELETE,
};

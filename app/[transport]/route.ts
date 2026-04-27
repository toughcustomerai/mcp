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
import { preflightResponse, withCors } from "@/lib/cors";

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
          "Generate a launch URL for a Tough Customer roleplay on a Salesforce " +
          "opportunity. The Learning LWC at the URL handles scenario / contact / " +
          "voice selection itself once the user clicks Start, so only " +
          "`opportunityId` is required.\n\n" +
          "Optional inputs are for **enriching pre-call coaching** — pass them " +
          "ONLY if the user explicitly told you what they wanted; otherwise " +
          "skip them and let the LWC pick:\n" +
          "  - `contactId` — validates the contact is on the opp; surfaces in dealContext\n" +
          "  - `scenarioId` — validates and surfaces the scenario\n" +
          "  - `voiceId` — power-user, exact voice name from list_voices\n" +
          "  - `voiceGender` (\"male\" | \"female\" | \"any\") — surfaces a preference; LWC picks concrete\n" +
          "  - `backstory` — free-text context for the AI buyer\n\n" +
          "Default behavior: with just `opportunityId`, return the launch URL " +
          "and Claude can offer a brief coaching summary based on the opp's " +
          "name / stage / amount alone.",
        inputSchema: {
          opportunityId: z.string().min(1).describe("Selected opportunity ID. Required."),
          contactId: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Optional contact ID. Pass only if the user picked a specific contact; otherwise skip and let the LWC pick.",
            ),
          scenarioId: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Optional scenario ID. Pass only if the user picked a specific scenario; otherwise skip.",
            ),
          voiceId: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Optional specific voice ID from list_voices (power-user). Skip in favor of voiceGender for most users.",
            ),
          voiceGender: z
            .enum(["male", "female", "any"])
            .optional()
            .describe(
              "Optional voice-gender preference. Pass only if the user expressed one.",
            ),
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
            hasContactId: !!input.contactId,
            hasScenarioId: !!input.scenarioId,
            voiceId: input.voiceId,
            voiceGender: input.voiceGender,
            backstoryLength: input.backstory?.length ?? 0,
          },
          async (auth) => {
            const session = await createRoleplaySession(auth, input);
            const opp = session.dealContext.opportunity;
            const lines: string[] = [
              `Session ready! Click the URL to launch:`,
              ``,
              `URL: ${session.url}`,
              ``,
              `Deal: ${opp.name}${opp.accountName ? ` (${opp.accountName})` : ""} — ${opp.stage}, $${opp.amount.toLocaleString()}`,
            ];
            if (session.dealContext.contact) {
              lines.push(
                `Contact: ${session.dealContext.contact.name}, ${session.dealContext.contact.title}`,
              );
            }
            if (session.dealContext.scenario) {
              lines.push(`Scenario: ${session.dealContext.scenario.name}`);
            }
            if (session.dealContext.voice) {
              lines.push(
                `Voice: ${session.dealContext.voice.name} (${session.dealContext.voice.gender}) — ${session.dealContext.voice.description}`,
              );
            } else if (session.dealContext.voicePreference) {
              lines.push(
                `Voice: ${session.dealContext.voicePreference.gender} (picked at session start)`,
              );
            }
            if (session.dealContext.backstory) {
              lines.push(`Backstory: ${session.dealContext.backstory}`);
            }
            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
              structuredContent: {
                id: session.id,
                url: session.url,
                createdAt: session.createdAt,
                dealContext: {
                  opportunity: { ...session.dealContext.opportunity },
                  ...(session.dealContext.contact
                    ? { contact: { ...session.dealContext.contact } }
                    : {}),
                  ...(session.dealContext.voice
                    ? { voice: { ...session.dealContext.voice } }
                    : {}),
                  ...(session.dealContext.voicePreference
                    ? {
                        voicePreference: {
                          ...session.dealContext.voicePreference,
                        },
                      }
                    : {}),
                  ...(session.dealContext.scenario
                    ? { scenario: { ...session.dealContext.scenario } }
                    : {}),
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
                  `You are the Tough Customer roleplay coordinator. Help the user pick an opportunity and launch a sales roleplay session.\n\n` +
                  focusLine +
                  `Identity: the MCP server authenticates the user via Salesforce OAuth. You never need to ask for an email — every tool call runs as the signed-in Salesforce user, and data is scoped by Salesforce sharing rules + FLS.\n\n` +
                  `Default flow — fast path, minimal questions:\n\n` +
                  `1. Call \`list_opportunities\` and present the list. Ask the user which deal they want to practice.\n` +
                  `2. Once they pick one, call \`create_roleplay_session\` with just the \`opportunityId\`. Share the resulting launch URL.\n` +
                  `3. Give a short pre-call coaching summary based on the opportunity name, stage, and account.\n\n` +
                  `Optional details — only ask about these if the user **explicitly** wants to customize:\n\n` +
                  `- Specific contact: call \`get_opportunity_contacts\`, let them pick, pass \`contactId\`.\n` +
                  `- Specific scenario: call \`list_scenarios\`, let them pick, pass \`scenarioId\`.\n` +
                  `- Voice gender preference: pass \`voiceGender\` ("male" | "female" | "any").\n` +
                  `- Specific voice by name: call \`list_voices\`, pass \`voiceId\` (power-user).\n` +
                  `- Backstory: pass \`backstory\` with their free-text context.\n\n` +
                  `Don't volunteer the optional questions — the Learning LWC handles contact / scenario / voice picking client-side at session start. Only enrich \`create_roleplay_session\` when the user themselves brings up one of those choices (e.g. "I want to roleplay with the CTO" → fetch contacts; "Try a female voice" → pass voiceGender).\n\n` +
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
    // CORS preflight short-circuit. Browser-hosted MCP clients (claude.ai,
    // chatgpt.com) preflight before sending the real request; without CORS
    // headers on the preflight, the browser drops the response and the
    // OAuth handshake never starts.
    if (req.method === "OPTIONS") return preflightResponse(req);

    if (!isMockMode()) {
      const authz = req.headers.get("authorization") ?? req.headers.get("Authorization");
      if (!authz || !/^Bearer\s+.+/i.test(authz)) {
        return withCors(unauthenticatedResponse(), req);
      }
    }
    const inner_res = await inner(req);
    return withCors(inner_res, req);
  };
}

const guardedHandler = withAuthGate(handler as (req: Request) => Promise<Response>);

export {
  guardedHandler as GET,
  guardedHandler as POST,
  guardedHandler as DELETE,
  guardedHandler as OPTIONS,
};

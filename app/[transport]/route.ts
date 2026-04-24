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

export const runtime = "nodejs";
export const maxDuration = 60;

function handleError(err: unknown): string {
  if (err instanceof TCUnauthorizedError) return `Error: ${err.message}`;
  if (err instanceof TCNotFoundError) return `Error: ${err.message}`;
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

// Shared param: every tool requires the calling user's email so the
// backend can enforce row-level security / role-based access control.
const userEmailSchema = z
  .string()
  .email()
  .describe(
    "The email address of the CURRENT USER making the request. Used for RLS/RBAC. " +
      "Ask the user for their email at the start of the session if you don't already know it, " +
      "then pass the same value to every tool call.",
  );

const handler = createMcpHandler(
  (server) => {
    // ─── Resources ──────────────────────────────────────────────────────────
    // Resources are kept for MCP clients that render them. They use a
    // placeholder email — Claude Desktop doesn't auto-read resources,
    // so the tools below are the primary path.

    const RESOURCE_USER = "resource-browser@toughcustomer.ai";

    server.registerResource(
      "opportunities",
      "toughcustomer://opportunities",
      {
        title: "Opportunities",
        description: "List of active sales opportunities for the current user.",
        mimeType: "application/json",
      },
      async (uri) => {
        const opportunities = await listOpportunities(RESOURCE_USER);
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
        const scenarios = await listScenarios(RESOURCE_USER);
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
        description: "Available AI buyer voices grouped by gender.",
        mimeType: "application/json",
      },
      async (uri) => {
        const voices = await listVoices(RESOURCE_USER);
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

    server.registerTool(
      "list_opportunities",
      {
        title: "List Opportunities",
        description:
          "List all active sales opportunities the user can roleplay against. " +
          "Call this first to let the user pick a deal. Returns id, name, stage, and amount for each.",
        inputSchema: {
          userEmail: userEmailSchema,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ userEmail }) => {
        try {
          const opportunities = await listOpportunities(userEmail);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(opportunities, null, 2) }],
            structuredContent: { opportunities: opportunities.map((o) => ({ ...o })) },
          };
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: handleError(err) }] };
        }
      },
    );

    server.registerTool(
      "list_voices",
      {
        title: "List Voices",
        description:
          "List all available AI buyer voices. Call this when the user needs to pick a voice for the roleplay.",
        inputSchema: {
          userEmail: userEmailSchema,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ userEmail }) => {
        try {
          const voices = await listVoices(userEmail);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(voices, null, 2) }],
            structuredContent: { voices: voices.map((v) => ({ ...v })) },
          };
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: handleError(err) }] };
        }
      },
    );

    server.registerTool(
      "list_scenarios",
      {
        title: "List Scenarios",
        description:
          "List all available roleplay scenarios. Call this when the user needs to pick a scenario.",
        inputSchema: {
          userEmail: userEmailSchema,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ userEmail }) => {
        try {
          const scenarios = await listScenarios(userEmail);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(scenarios, null, 2) }],
            structuredContent: { scenarios: scenarios.map((s) => ({ ...s })) },
          };
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: handleError(err) }] };
        }
      },
    );

    server.registerTool(
      "get_opportunity_contacts",
      {
        title: "Get Opportunity Contacts",
        description:
          "Fetch the list of contacts (buying committee members) attached to a specific opportunity. " +
          "Call this after the user selects an opportunity from list_opportunities.",
        inputSchema: {
          userEmail: userEmailSchema,
          opportunityId: z
            .string()
            .min(1)
            .describe("The ID of the selected opportunity (e.g. opp_globaltech_platform)."),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ userEmail, opportunityId }) => {
        try {
          const contacts = await getOpportunityContacts(userEmail, opportunityId);
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
              {
                type: "text" as const,
                text: JSON.stringify(contacts, null, 2),
              },
            ],
            structuredContent: { opportunityId, contacts: [...contacts] },
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: handleError(err) }],
          };
        }
      },
    );

    server.registerTool(
      "create_roleplay_session",
      {
        title: "Create Roleplay Session",
        description:
          "Initialize a Tough Customer roleplay session. Call this only after the user has chosen " +
          "an opportunity, contact, voice, and scenario. Returns the session URL and compiled deal context.",
        inputSchema: {
          userEmail: userEmailSchema,
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
      async (input) => {
        try {
          const session = await createRoleplaySession(input);
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
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: handleError(err) }],
          };
        }
      },
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
                  `FIRST: ask the user for their work email address. Every tool call requires a \`userEmail\` parameter for RLS/RBAC — reuse the same email for every call in this session. Do NOT guess or fabricate an email.\n\n` +
                  `Then follow this flow exactly — do not skip steps:\n\n` +
                  `1. Call the \`list_opportunities\` tool (passing userEmail) and present the list. Ask the user which deal they want to practice.\n` +
                  `2. Once they pick one, call \`get_opportunity_contacts\` with userEmail + opportunityId. Present the contacts and ask who they want to roleplay against.\n` +
                  `3. Call \`list_voices\` and \`list_scenarios\` (both with userEmail). Let the user pick one of each (suggest a sensible default based on the deal).\n` +
                  `4. Ask if they want to add an optional backstory / extra context.\n` +
                  `5. Call \`create_roleplay_session\` with userEmail + all selected IDs. Share the resulting session URL and summarise the compiled deal context.\n\n` +
                  `Rules:\n` +
                  `- Always show human-readable names, not IDs, when talking to the user. Keep IDs internal.\n` +
                  `- If a tool returns an error, surface it plainly and ask the user to pick again.\n` +
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

export { handler as GET, handler as POST, handler as DELETE };

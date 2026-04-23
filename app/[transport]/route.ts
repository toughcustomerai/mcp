import { createUIResource } from "@mcp-ui/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { generateRoleplayLink, TEMPLATES } from "@/lib/roleplays";

export const runtime = "nodejs";
export const maxDuration = 60;

function getApiBase(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "toughcustomer_open_roleplay_app",
      {
        title: "Open Roleplay App",
        description:
          "Open the Tough Customer roleplay configurator UI inline. User picks a persona/scenario and generates a shareable roleplay link.",
        inputSchema: {
          persona: z
            .string()
            .max(500)
            .optional()
            .describe("Optional persona to pre-fill in the form."),
          scenario: z
            .string()
            .max(2000)
            .optional()
            .describe("Optional scenario to pre-fill."),
          difficulty: z
            .enum(["easy", "medium", "hard"])
            .optional()
            .describe("Optional difficulty to pre-select."),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ persona, scenario, difficulty }) => {
        const base = getApiBase();
        const qs = new URLSearchParams();
        if (persona) qs.set("persona", persona);
        if (scenario) qs.set("scenario", scenario);
        if (difficulty) qs.set("difficulty", difficulty);
        const hostedUrl = `${base}/app${qs.toString() ? `?${qs}` : ""}`;

        const uiResource = await createUIResource({
          uri: `ui://toughcustomer/roleplay/${Date.now()}` as `ui://${string}`,
          content: { type: "externalUrl", iframeUrl: hostedUrl },
          encoding: "text",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Open the Tough Customer roleplay configurator: ${hostedUrl}`,
            },
            uiResource,
          ],
          _meta: {
            "mcpui.dev/ui-resource": uiResource.resource.uri,
            "openai/outputTemplate": uiResource.resource.uri,
          },
        };
      },
    );

    server.registerTool(
      "toughcustomer_create_roleplay_link",
      {
        title: "Create Roleplay Link",
        description:
          "Generate a Tough Customer roleplay link for a given persona, scenario, and difficulty. Returns the URL and also renders the configurator UI with the result.",
        inputSchema: {
          persona: z.string().min(1).max(500).describe("Buyer persona."),
          scenario: z.string().min(1).max(2000).describe("Scenario setup."),
          difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
          objections: z
            .array(z.string().max(200))
            .max(20)
            .optional()
            .describe("Optional list of objection themes."),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (input) => {
        const link = generateRoleplayLink({
          persona: input.persona,
          scenario: input.scenario,
          difficulty: input.difficulty ?? "medium",
          objections: input.objections,
        });
        const base = getApiBase();
        const hostedUrl = `${base}/app?persona=${encodeURIComponent(link.persona)}&scenario=${encodeURIComponent(link.scenario)}&difficulty=${link.difficulty}`;
        const uiResource = await createUIResource({
          uri: `ui://toughcustomer/roleplay/${link.id}` as `ui://${string}`,
          content: { type: "externalUrl", iframeUrl: hostedUrl },
          encoding: "text",
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Roleplay link: ${link.url}\n\n` +
                `Open the configurator UI: ${hostedUrl}`,
            },
            uiResource,
          ],
          structuredContent: { ...link },
          _meta: {
            "mcpui.dev/ui-resource": uiResource.resource.uri,
            "openai/outputTemplate": uiResource.resource.uri,
          },
        };
      },
    );

    server.registerTool(
      "toughcustomer_list_templates",
      {
        title: "List Roleplay Templates",
        description:
          "List the built-in Tough Customer roleplay templates (persona + scenario presets).",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => ({
        content: [
          { type: "text", text: JSON.stringify(TEMPLATES, null, 2) },
        ],
        structuredContent: { templates: [...TEMPLATES] },
      }),
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

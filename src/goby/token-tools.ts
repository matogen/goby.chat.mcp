import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describeCredentials, maskKey, normalizeDir, resolveCredentials, type TokenStore } from "./config.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

const apiKey = z
  .string()
  .regex(/^gk_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/, "Goby API keys look like gk_<publicId>_<secret>")
  .describe("Goby API key, gk_<publicId>_<secret>, minted under Admin → API keys");
const dir = z
  .string()
  .optional()
  .describe(
    "Absolute project directory. Defaults to the directory this server was started in (the Claude Code project). Pass it explicitly when unsure."
  );
const baseUrl = z
  .string()
  .url()
  .optional()
  .describe("Your Goby instance origin, e.g. https://acme.goby.chat. Required unless a default URL is stored (goby-mcp token set-default --base-url ...) or GOBY_BASE_URL is set.");

export interface TokenToolsContext {
  store: TokenStore;
  cwd: string;
  env: Record<string, string | undefined>;
}

/** Tools for managing one Goby token per project directory. */
export function registerTokenTools(server: McpServer, ctx: TokenToolsContext) {
  const { store, cwd, env } = ctx;

  const overview = (): string => {
    const r = resolveCredentials({ env, cwd, store });
    const file = store.read();
    const lines = [`Current directory: ${cwd}`, describeCredentials(r, cwd, store.path), ""];
    const dirs = Object.keys(file.projects).sort();
    if (file.apiKey || file.baseUrl) lines.push(`default: ${file.apiKey ? maskKey(file.apiKey) : "(no token)"}${file.baseUrl ? ` → ${file.baseUrl}` : ""}`);
    if (dirs.length === 0) lines.push("No per-project tokens stored.");
    for (const d of dirs) {
      const p = file.projects[d];
      lines.push(`${d}: ${maskKey(p.apiKey)}${p.baseUrl ? ` → ${p.baseUrl}` : ""}${r.projectDir === d ? "  (active)" : ""}`);
    }
    if (env.GOBY_API_KEY) lines.push("", "Note: GOBY_API_KEY is set in the environment and overrides every stored token.");
    return lines.join("\n");
  };

  server.registerTool(
    "list-project-tokens",
    {
      title: "List project tokens",
      description:
        "Show which Goby token (masked) is active for the current project directory, where it came from, and every stored per-project token. Use this first when a Goby call fails with unauthorized or 'no token configured'.",
      inputSchema: {},
    },
    async () => ok(overview())
  );

  server.registerTool(
    "set-project-token",
    {
      title: "Set project token",
      description:
        "Store a Goby API key for a project directory so every Goby tool run from that directory (or any subdirectory) uses it. Takes effect immediately, no restart. Tokens are written to the user's config file, never into the repo.",
      inputSchema: { api_key: apiKey, dir, base_url: baseUrl },
    },
    async ({ api_key, dir: d, base_url }) => {
      const key = store.setProject(d ?? cwd, { apiKey: api_key, baseUrl: base_url });
      return ok(`Stored token ${maskKey(api_key)} for ${key} in ${store.path}.\n\n${overview()}`);
    }
  );

  server.registerTool(
    "remove-project-token",
    {
      title: "Remove project token",
      description: "Forget the stored Goby token for a project directory (defaults to the current one).",
      inputSchema: { dir },
    },
    async ({ dir: d }) => {
      const key = normalizeDir(d ?? cwd);
      if (!store.removeProject(key)) return fail(`No token stored for ${key}.\n\n${overview()}`);
      return ok(`Removed token for ${key}.\n\n${overview()}`);
    }
  );
}

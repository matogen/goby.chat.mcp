#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runTokenCli } from "./cli.js";
import { GobyClient } from "./goby/client.js";
import { NO_URL_HINT, TokenStore, describeCredentials, resolveCredentials, storePath } from "./goby/config.js";
import { registerTokenTools } from "./goby/token-tools.js";
import { registerGobyTools } from "./goby/tools.js";

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

const argv = process.argv.slice(2);
if (argv[0] === "token" || argv[0] === "--help" || argv[0] === "-h") {
  process.exit(runTokenCli(argv));
}

const cwd = process.cwd();
const store = new TokenStore(storePath());
const server = new McpServer({ name: "goby-mcp", version: "0.2.0" });

// One client per distinct (baseUrl, apiKey); re-resolved on every call so a
// token stored while the server runs is picked up without a restart.
let current: { key: string; client: GobyClient } | null = null;
function getClient(): GobyClient {
  const r = resolveCredentials({ env: process.env, cwd, store });
  if (!r.apiKey) throw new Error(describeCredentials(r, cwd, store.path));
  if (!r.baseUrl) throw new Error(`Goby token found but ${NO_URL_HINT}.`);
  const key = `${r.baseUrl}\n${r.apiKey}`;
  if (!current || current.key !== key) {
    current = { key, client: new GobyClient({ baseUrl: r.baseUrl, apiKey: r.apiKey }) };
  }
  return current.client;
}

registerGobyTools(server, getClient);
registerTokenTools(server, { store, cwd, env: process.env });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const r = resolveCredentials({ env: process.env, cwd, store });
  console.error(`goby-mcp started in ${cwd}: ${describeCredentials(r, cwd, store.path)}`);
}

main().catch((error) => {
  console.error("Error running main:", error);
  process.exit(1);
});

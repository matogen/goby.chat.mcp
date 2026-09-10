import { TokenStore, maskKey, normalizeDir, resolveCredentials, storePath } from "./goby/config.js";

const USAGE = `goby-mcp — MCP server for Goby, with one API token per project directory.

Usage:
  goby-mcp                                  start the MCP server (stdio)
  goby-mcp token set <gk_key> [--dir DIR] [--base-url URL]
                                            store a token for DIR (default: current directory)
  goby-mcp token set-default [gk_key] [--base-url URL]
                                            token and/or instance URL used when a project has none
  goby-mcp token list                       show stored tokens (masked) and which one is active here
  goby-mcp token remove [--dir DIR]         forget the token for DIR (default: current directory)
  goby-mcp token remove-default             forget the default token

Tokens live in ${storePath()} (override with GOBY_MCP_CONFIG).
GOBY_API_KEY / GOBY_BASE_URL in the environment override everything stored.`;

function parse(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      flags[k] = inline ?? args[++i] ?? "";
    } else positional.push(a);
  }
  return { positional, flags };
}

/** Returns the process exit code. */
export function runTokenCli(argv: string[], out = console.log, err = console.error): number {
  if (argv[0] !== "token" || argv.length < 2) {
    out(USAGE);
    return argv[0] === "token" ? 2 : 0;
  }
  const store = new TokenStore(storePath());
  const { positional, flags } = parse(argv.slice(2));
  const cmd = argv[1];
  const dir = normalizeDir(flags.dir ?? process.cwd());

  switch (cmd) {
    case "set": {
      const key = positional[0];
      if (!key || !/^gk_[A-Za-z0-9]+_/.test(key)) {
        err("token set: expected a key like gk_<publicId>_<secret>");
        return 2;
      }
      const saved = store.setProject(dir, { apiKey: key, baseUrl: flags["base-url"] });
      out(`Stored ${maskKey(key)} for ${saved} in ${store.path}`);
      return 0;
    }
    case "set-default": {
      const key = positional[0];
      if (key && !/^gk_[A-Za-z0-9]+_/.test(key)) {
        err("token set-default: expected a key like gk_<publicId>_<secret>");
        return 2;
      }
      if (!key && !flags["base-url"]) {
        err("token set-default: give a key, --base-url URL, or both");
        return 2;
      }
      store.setDefault({ apiKey: key, baseUrl: flags["base-url"] });
      out(`Stored default${key ? ` ${maskKey(key)}` : ""}${flags["base-url"] ? ` url ${flags["base-url"]}` : ""} in ${store.path}`);
      return 0;
    }
    case "remove": {
      if (!store.removeProject(dir)) {
        err(`No token stored for ${dir}`);
        return 1;
      }
      out(`Removed token for ${dir}`);
      return 0;
    }
    case "remove-default": {
      if (!store.removeDefault()) {
        err("No default token stored");
        return 1;
      }
      out("Removed default token");
      return 0;
    }
    case "list": {
      const file = store.read();
      const r = resolveCredentials({ env: process.env, cwd: dir, store });
      out(`Store: ${store.path}`);
      out(`Active for ${dir}: ${r.apiKey ? `${maskKey(r.apiKey)} (${r.source}${r.projectDir ? ` ${r.projectDir}` : ""}) → ${r.baseUrl ?? "(no url)"}` : "none"}`);
      if (file.apiKey || file.baseUrl) out(`default: ${file.apiKey ? maskKey(file.apiKey) : "(no token)"}${file.baseUrl ? ` → ${file.baseUrl}` : ""}`);
      const dirs = Object.keys(file.projects).sort();
      if (dirs.length === 0) out("(no per-project tokens)");
      for (const d of dirs) {
        const p = file.projects[d];
        out(`${d}: ${maskKey(p.apiKey)}${p.baseUrl ? ` → ${p.baseUrl}` : ""}`);
      }
      return 0;
    }
    default:
      err(`Unknown token command "${cmd}"\n\n${USAGE}`);
      return 2;
  }
}

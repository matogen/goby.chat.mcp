/**
 * Per-project credential store.
 *
 * A Goby API key belongs to exactly one team, so a developer who works on
 * several Claude Code projects that map to different Goby teams needs one
 * token per project directory. Tokens live in a single JSON file under the
 * user's config dir (never inside a repo):
 *
 *   {
 *     "baseUrl": "https://acme.goby.chat",               // optional default instance
 *     "apiKey": "gk_...",                                // optional default
 *     "projects": {
 *       "/home/me/src/app": { "apiKey": "gk_...", "baseUrl": "..." }
 *     }
 *   }
 *
 * Resolution order for the running server (cwd = the project Claude Code was
 * started in): GOBY_API_KEY env → longest matching project dir → store default.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectCredentials {
  apiKey: string;
  baseUrl?: string;
}

export interface StoreFile {
  baseUrl?: string;
  apiKey?: string;
  projects: Record<string, ProjectCredentials>;
}

export type CredentialSource = "env" | "project" | "default" | "none";

export interface ResolvedCredentials {
  apiKey: string | null;
  /** null when no instance URL is configured anywhere (env, project, default). */
  baseUrl: string | null;
  source: CredentialSource;
  /** Set when source === "project". */
  projectDir?: string;
}

type Env = Record<string, string | undefined>;

export function storePath(env: Env = process.env): string {
  if (env.GOBY_MCP_CONFIG) return env.GOBY_MCP_CONFIG;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "goby-mcp", "config.json");
}

export function maskKey(key: string): string {
  const m = /^(gk_[A-Za-z0-9]+)_/.exec(key);
  return m ? `${m[1]}_****` : "****";
}

export function normalizeDir(dir: string): string {
  const r = path.resolve(dir);
  return r.length > 1 ? r.replace(/[\\/]+$/, "") : r;
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

export function matchProject(
  projects: Record<string, ProjectCredentials>,
  cwd: string
): { dir: string; creds: ProjectCredentials } | null {
  const c = normalizeDir(cwd);
  let best: { dir: string; creds: ProjectCredentials } | null = null;
  for (const [rawDir, creds] of Object.entries(projects)) {
    const dir = normalizeDir(rawDir);
    const contains = c === dir || c.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
    if (contains && (!best || dir.length > best.dir.length)) best = { dir, creds };
  }
  return best;
}

export class TokenStore {
  constructor(public readonly path: string) {}

  read(): StoreFile {
    let raw: string;
    try {
      raw = fs.readFileSync(this.path, "utf8");
    } catch {
      return { projects: {} };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return {
        ...(parsed.baseUrl ? { baseUrl: parsed.baseUrl } : {}),
        ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
        projects: parsed.projects && typeof parsed.projects === "object" ? parsed.projects : {},
      };
    } catch {
      return { projects: {} };
    }
  }

  write(store: StoreFile): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.path);
    fs.chmodSync(this.path, 0o600);
  }

  setProject(dir: string, creds: ProjectCredentials): string {
    const s = this.read();
    const key = normalizeDir(dir);
    s.projects[key] = { apiKey: creds.apiKey, ...(creds.baseUrl ? { baseUrl: stripSlash(creds.baseUrl) } : {}) };
    this.write(s);
    return key;
  }

  removeProject(dir: string): boolean {
    const s = this.read();
    const key = normalizeDir(dir);
    if (!(key in s.projects)) return false;
    delete s.projects[key];
    this.write(s);
    return true;
  }

  setDefault(creds: Partial<ProjectCredentials>): void {
    const s = this.read();
    if (creds.apiKey) s.apiKey = creds.apiKey;
    if (creds.baseUrl) s.baseUrl = stripSlash(creds.baseUrl);
    this.write(s);
  }

  removeDefault(): boolean {
    const s = this.read();
    if (!s.apiKey) return false;
    delete s.apiKey;
    this.write(s);
    return true;
  }
}

export function resolveCredentials(opts: { env: Env; cwd: string; store: TokenStore }): ResolvedCredentials {
  const { env, cwd, store } = opts;
  const file = store.read();
  const envUrl = env.GOBY_BASE_URL ? stripSlash(env.GOBY_BASE_URL) : undefined;
  const fallbackUrl = envUrl ?? (file.baseUrl ? stripSlash(file.baseUrl) : null);

  if (env.GOBY_API_KEY) {
    return { apiKey: env.GOBY_API_KEY, baseUrl: fallbackUrl, source: "env" };
  }
  const hit = matchProject(file.projects, cwd);
  if (hit) {
    return {
      apiKey: hit.creds.apiKey,
      baseUrl: envUrl ?? hit.creds.baseUrl ?? fallbackUrl,
      source: "project",
      projectDir: hit.dir,
    };
  }
  if (file.apiKey) {
    return { apiKey: file.apiKey, baseUrl: fallbackUrl, source: "default" };
  }
  return { apiKey: null, baseUrl: fallbackUrl, source: "none" };
}

export const NO_URL_HINT =
  "no instance URL — set GOBY_BASE_URL, pass base_url/--base-url when storing the token, or store a default with `goby-mcp token set-default --base-url https://<team>.goby.chat`";

/** Human-readable one-liner about where the current credentials come from. */
export function describeCredentials(r: ResolvedCredentials, cwd: string, storeFile: string): string {
  const url = r.baseUrl ?? NO_URL_HINT;
  switch (r.source) {
    case "env":
      return `Token from GOBY_API_KEY env (${maskKey(r.apiKey!)}) → ${url}`;
    case "project":
      return `Token for project ${r.projectDir} (${maskKey(r.apiKey!)}) → ${url}`;
    case "default":
      return `Default token from ${storeFile} (${maskKey(r.apiKey!)}) → ${url}`;
    case "none":
      return `No Goby token configured for ${cwd}. Add one with the set-project-token tool or \`goby-mcp token set gk_... --base-url https://<team>.goby.chat --dir ${cwd}\` (store: ${storeFile}).`;
  }
}

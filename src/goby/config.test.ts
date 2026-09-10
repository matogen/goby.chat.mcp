import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TokenStore,
  maskKey,
  matchProject,
  normalizeDir,
  resolveCredentials,
  storePath,
} from "./config.js";

function tmpStore(): TokenStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goby-mcp-test-"));
  return new TokenStore(path.join(dir, "nested", "config.json"));
}

test("storePath honours GOBY_MCP_CONFIG, then XDG_CONFIG_HOME, then ~/.config", () => {
  assert.equal(storePath({ GOBY_MCP_CONFIG: "/x/c.json" }), "/x/c.json");
  assert.equal(storePath({ XDG_CONFIG_HOME: "/xdg" }), "/xdg/goby-mcp/config.json");
  assert.equal(storePath({}), path.join(os.homedir(), ".config", "goby-mcp", "config.json"));
});

test("maskKey keeps the public id and hides the secret", () => {
  assert.equal(maskKey("gk_abc123_supersecret"), "gk_abc123_****");
  assert.equal(maskKey("weird"), "****");
});

test("normalizeDir resolves and strips trailing slashes", () => {
  assert.equal(normalizeDir("/a/b/"), "/a/b");
  assert.equal(normalizeDir("/a/b/../c"), "/a/c");
});

test("matchProject picks the longest directory that contains cwd", () => {
  const projects = {
    "/home/u/src": { apiKey: "gk_root_1" },
    "/home/u/src/app": { apiKey: "gk_app_1" },
  };
  assert.equal(matchProject(projects, "/home/u/src/app/sub")?.dir, "/home/u/src/app");
  assert.equal(matchProject(projects, "/home/u/src/app")?.dir, "/home/u/src/app");
  assert.equal(matchProject(projects, "/home/u/src/other")?.dir, "/home/u/src");
  assert.equal(matchProject(projects, "/home/u/src-other"), null);
  assert.equal(matchProject(projects, "/elsewhere"), null);
});

test("TokenStore round-trips projects and defaults, creating the file with mode 0600", () => {
  const s = tmpStore();
  assert.deepEqual(s.read(), { projects: {} });
  s.setProject("/p/one/", { apiKey: "gk_one_s" });
  s.setProject("/p/two", { apiKey: "gk_two_s", baseUrl: "https://two.goby.chat" });
  s.setDefault({ apiKey: "gk_def_s" });
  const r = s.read();
  assert.deepEqual(r.projects, {
    "/p/one": { apiKey: "gk_one_s" },
    "/p/two": { apiKey: "gk_two_s", baseUrl: "https://two.goby.chat" },
  });
  assert.equal(r.apiKey, "gk_def_s");
  assert.equal(fs.statSync(s.path).mode & 0o777, 0o600);
  assert.equal(s.removeProject("/p/one"), true);
  assert.equal(s.removeProject("/p/one"), false);
  assert.deepEqual(Object.keys(s.read().projects), ["/p/two"]);
});

test("resolveCredentials: env wins, then project, then store default, else none", () => {
  const s = tmpStore();
  const none = resolveCredentials({ env: {}, cwd: "/p/app", store: s });
  assert.deepEqual(none, { apiKey: null, baseUrl: null, source: "none" });

  s.setDefault({ apiKey: "gk_def_s", baseUrl: "https://def.goby.chat" });
  const def = resolveCredentials({ env: {}, cwd: "/p/app", store: s });
  assert.deepEqual(def, { apiKey: "gk_def_s", baseUrl: "https://def.goby.chat", source: "default" });

  s.setProject("/p/app", { apiKey: "gk_app_s" });
  const proj = resolveCredentials({ env: {}, cwd: "/p/app/src", store: s });
  assert.deepEqual(proj, {
    apiKey: "gk_app_s",
    baseUrl: "https://def.goby.chat",
    source: "project",
    projectDir: "/p/app",
  });

  const env = resolveCredentials({
    env: { GOBY_API_KEY: "gk_env_s", GOBY_BASE_URL: "https://env.goby.chat/" },
    cwd: "/p/app",
    store: s,
  });
  assert.deepEqual(env, { apiKey: "gk_env_s", baseUrl: "https://env.goby.chat", source: "env" });
});

test("resolveCredentials: a project token without any url resolves baseUrl null", () => {
  const s = tmpStore();
  s.setProject("/p/app", { apiKey: "gk_app_s" });
  const r = resolveCredentials({ env: {}, cwd: "/p/app", store: s });
  assert.equal(r.apiKey, "gk_app_s");
  assert.equal(r.baseUrl, null);
  s.setDefault({ baseUrl: "https://acme.goby.chat/" });
  assert.equal(resolveCredentials({ env: {}, cwd: "/p/app", store: s }).baseUrl, "https://acme.goby.chat");
});

test("resolveCredentials: GOBY_BASE_URL alone overrides the url of a project token", () => {
  const s = tmpStore();
  s.setProject("/p/app", { apiKey: "gk_app_s", baseUrl: "https://proj.goby.chat" });
  const r = resolveCredentials({ env: { GOBY_BASE_URL: "https://env.goby.chat" }, cwd: "/p/app", store: s });
  assert.equal(r.apiKey, "gk_app_s");
  assert.equal(r.baseUrl, "https://env.goby.chat");
  assert.equal(r.source, "project");
});

test("TokenStore tolerates a missing or corrupt file", () => {
  const s = tmpStore();
  fs.mkdirSync(path.dirname(s.path), { recursive: true });
  fs.writeFileSync(s.path, "{not json");
  assert.deepEqual(s.read(), { projects: {} });
});

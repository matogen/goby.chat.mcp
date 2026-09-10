import { test } from "node:test";
import assert from "node:assert/strict";
import { GobyClient, GobyApiError } from "./client.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(
  responses: Array<{ status: number; body?: unknown }>,
  calls: Call[] = []
): { fetch: typeof fetch; calls: Call[] } {
  let i = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    const text = r.body === undefined ? null : JSON.stringify(r.body);
    return new Response(text, {
      status: r.status,
      headers: r.body === undefined ? {} : { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const cfg = { baseUrl: "https://x.goby.chat/", apiKey: "gk_a_b" };

test("builds URL under /api/v1 and sends bearer auth", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { key: {}, team: {}, owner: {} } }]);
  const c = new GobyClient({ ...cfg, fetch, sleep: async () => {} });
  await c.whoami();
  assert.equal(calls[0].url, "https://x.goby.chat/api/v1/whoami");
  const h = new Headers(calls[0].init.headers);
  assert.equal(h.get("authorization"), "Bearer gk_a_b");
});

test("serialises list-tasks query params, joining arrays with commas", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { tasks: [], nextCursor: null } }]);
  const c = new GobyClient({ ...cfg, fetch, sleep: async () => {} });
  await c.listTasks({ semantic: "todo", keys: ["OPS-1", "OPS-2"], includeDone: true, limit: 5 });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/api/v1/tasks");
  assert.equal(u.searchParams.get("semantic"), "todo");
  assert.equal(u.searchParams.get("keys"), "OPS-1,OPS-2");
  assert.equal(u.searchParams.get("includeDone"), "true");
  assert.equal(u.searchParams.get("limit"), "5");
});

test("maps the error envelope to GobyApiError", async () => {
  const { fetch } = fakeFetch([
    { status: 403, body: { error: { code: "forbidden", message: "needs tasks:write" } } },
  ]);
  const c = new GobyClient({ ...cfg, fetch, sleep: async () => {} });
  await assert.rejects(c.getTask("OPS-1"), (e: unknown) => {
    assert.ok(e instanceof GobyApiError);
    assert.equal(e.code, "forbidden");
    assert.equal(e.status, 403);
    assert.match(e.message, /needs tasks:write/);
    return true;
  });
});

test("retries once on 429 then succeeds", async () => {
  const slept: number[] = [];
  const { fetch, calls } = fakeFetch([
    { status: 429, body: { error: { code: "rate_limited", message: "slow down" } } },
    { status: 201, body: { key: "OPS-9" } },
  ]);
  const c = new GobyClient({ ...cfg, fetch, sleep: async (ms) => { slept.push(ms); } });
  const t = await c.createTask({ title: "x" });
  assert.equal(t.key, "OPS-9");
  assert.equal(calls.length, 2);
  assert.equal(slept.length, 1);
});

test("createTask sends JSON body and idempotency-key header when given", async () => {
  const { fetch, calls } = fakeFetch([{ status: 201, body: { key: "OPS-9" } }]);
  const c = new GobyClient({ ...cfg, fetch, sleep: async () => {} });
  await c.createTask({ title: "x", priority: 1 }, "idem-1");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { title: "x", priority: 1 });
  assert.equal(new Headers(calls[0].init.headers).get("idempotency-key"), "idem-1");
});

test("deleteWebhook tolerates an empty 204", async () => {
  const { fetch, calls } = fakeFetch([{ status: 204 }]);
  const c = new GobyClient({ ...cfg, fetch, sleep: async () => {} });
  await c.deleteWebhook("abc");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].url, "https://x.goby.chat/api/v1/webhooks/abc");
});

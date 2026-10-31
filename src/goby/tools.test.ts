import { test } from "node:test";
import assert from "node:assert/strict";
import { GobyApiError } from "./client.js";
import { teamLabels } from "./tools.js";
import type { Label, TaskPage } from "./types.js";

const unused: Label = { id: "l1", name: "unused", color: "#111111" };
const used: Label = { id: "l2", name: "used", color: "#222222" };

test("teamLabels uses GET /labels, so a label no task carries is included", async () => {
  let harvestedTasks = false;
  const r = await teamLabels({
    listLabels: async () => [unused, used],
    listTasks: async () => {
      harvestedTasks = true;
      return { tasks: [], nextCursor: null } as TaskPage;
    },
  });
  assert.deepEqual(r, { labels: [unused, used], harvested: false });
  assert.equal(harvestedTasks, false);
});

test("teamLabels falls back to harvesting from tasks when the server has no /labels (404)", async () => {
  const r = await teamLabels({
    listLabels: async () => {
      throw new GobyApiError(404, "not_found", "Cannot GET /api/v1/labels");
    },
    listTasks: async () => ({ tasks: [{ labels: [used] }, { labels: [used] }], nextCursor: null }) as unknown as TaskPage,
  });
  assert.deepEqual(r, { labels: [used], harvested: true });
});

test("teamLabels surfaces any other error rather than silently harvesting", async () => {
  await assert.rejects(
    teamLabels({
      listLabels: async () => {
        throw new GobyApiError(403, "forbidden", "needs tasks:read");
      },
      listTasks: async () => ({ tasks: [], nextCursor: null }) as TaskPage,
    }),
    /forbidden/
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTaskLine, formatTask, formatComment, formatHistoryEntry } from "./format.js";
import type { Task, Comment, HistoryEntry } from "./types.js";

const task: Task = {
  key: "OPS-42",
  id: "id",
  title: "Renew the TLS cert",
  description: "It expires on the 1st.",
  status: { id: "s", name: "In Progress", semantic: "in_progress" },
  priority: 2,
  dueAt: "2026-09-01T00:00:00.000Z",
  estimateHours: 3,
  assignees: [{ id: "u", name: "Sam Lead" }],
  labels: [{ id: "l", name: "infra", color: "#000" }],
  parentKey: null,
  childCount: 0,
  customFields: [],
  externalKey: "JIRA-123",
  createdAt: "2026-08-20T09:30:00.000Z",
  updatedAt: "2026-08-27T08:00:00.000Z",
  url: "https://x/app/t/OPS-42",
};

test("formatTaskLine is one compact line", () => {
  const line = formatTaskLine(task);
  assert.equal(line.includes("\n"), false);
  assert.match(line, /^OPS-42 \[In Progress\] P2 Renew the TLS cert/);
  assert.match(line, /@Sam Lead/);
  assert.match(line, /#infra/);
  assert.match(line, /due 2026-09-01/);
});

test("formatTask includes description, url and external key", () => {
  const out = formatTask(task);
  assert.match(out, /It expires on the 1st\./);
  assert.match(out, /https:\/\/x\/app\/t\/OPS-42/);
  assert.match(out, /JIRA-123/);
});

test("formatComment shows kind, author, time and body", () => {
  const c: Comment = {
    id: "c",
    taskKey: "OPS-42",
    author: { id: "u", name: "Sam Lead", kind: "user" },
    body: "Deployed.",
    createdAt: "2026-08-27T08:00:00.000Z",
  };
  assert.match(formatComment(c), /\[user\] Sam Lead .*2026-08-27T08:00:00.000Z.*\n\s*Deployed\./s);
});

test("formatHistoryEntry renders a status transition", () => {
  const h: HistoryEntry = {
    id: "h",
    taskKey: "OPS-42",
    type: "status_changed",
    actor: { id: null, name: null, kind: "system" },
    from: { id: "a", label: "To Do" },
    to: { id: "b", label: "In Progress" },
    automation: true,
    occurredAt: "2026-08-27T08:00:00.000Z",
  };
  const out = formatHistoryEntry(h);
  assert.match(out, /status_changed/);
  assert.match(out, /To Do → In Progress/);
  assert.match(out, /automation/);
});

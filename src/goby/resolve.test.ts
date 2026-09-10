import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLabel, resolveMember, resolveStatus } from "./resolve.js";
import type { Label, Member, Status } from "./types.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const statuses: Status[] = [
  { id: UUID_A, name: "To Do", semantic: "todo", sortOrder: 1 },
  { id: UUID_B, name: "In Progress", semantic: "in_progress", sortOrder: 2 },
  { id: UUID_C, name: "Done", semantic: "done", sortOrder: 3 },
];

test("resolveStatus: uuid passes through, semantic and name match case-insensitively", () => {
  assert.equal(resolveStatus(UUID_B, statuses), UUID_B);
  assert.equal(resolveStatus("in_progress", statuses), UUID_B);
  assert.equal(resolveStatus("in progress", statuses), UUID_B);
  assert.equal(resolveStatus("DONE", statuses), UUID_C);
});

test("resolveStatus: unknown value throws listing the legal values", () => {
  assert.throws(() => resolveStatus("Blocked", statuses), /Unknown status "Blocked".*To Do.*in_progress/s);
});

const members: Member[] = [
  { id: UUID_A, name: "Sam Lead", email: "sam@example.com", role: "lead" },
  { id: UUID_B, name: "Sarah T.", email: "sarah@example.com", role: "member" },
  { id: UUID_C, name: "Sarah", email: null, role: "member" },
];

test("resolveMember: uuid, email, exact name, then unique prefix", () => {
  assert.equal(resolveMember(UUID_A, members), UUID_A);
  assert.equal(resolveMember("SAM@example.com", members), UUID_A);
  assert.equal(resolveMember("sarah t.", members), UUID_B);
  assert.equal(resolveMember("sam", members), UUID_A);
});

test("resolveMember: ambiguous name throws naming the candidates", () => {
  assert.throws(() => resolveMember("sar", members), /ambiguous.*Sarah T\..*Sarah/s);
});

test("resolveMember: exact name wins over a prefix that would be ambiguous", () => {
  assert.equal(resolveMember("Sarah", members), UUID_C);
});

const labels: Label[] = [
  { id: UUID_A, name: "infra", color: "#000" },
  { id: UUID_B, name: "bug", color: "#f00" },
];

test("resolveLabel: uuid or case-insensitive name", () => {
  assert.equal(resolveLabel(UUID_B, labels), UUID_B);
  assert.equal(resolveLabel("Infra", labels), UUID_A);
  assert.throws(() => resolveLabel("feature", labels), /Unknown label "feature".*infra.*bug/s);
});

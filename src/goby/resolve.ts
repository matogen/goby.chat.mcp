import type { Label, Member, Status } from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

/** Accepts a status uuid, a semantic (`todo`, `in_progress`, …) or a column name. */
export function resolveStatus(value: string, statuses: Status[]): string {
  if (isUuid(value)) return value;
  const v = norm(value);
  const hit =
    statuses.find((s) => norm(s.semantic) === v) ??
    statuses.find((s) => norm(s.name) === v);
  if (hit) return hit.id;
  const legal = statuses.map((s) => `"${s.name}" (${s.semantic})`).join(", ");
  throw new Error(`Unknown status "${value}". Legal values: ${legal}`);
}

/** Accepts a member uuid, an email, an exact display name, or a unique name prefix. */
export function resolveMember(value: string, members: Member[]): string {
  if (isUuid(value)) return value;
  const v = value.trim().toLowerCase();
  const byEmail = members.find((m) => m.email?.toLowerCase() === v);
  if (byEmail) return byEmail.id;
  const byName = members.filter((m) => (m.name ?? "").trim().toLowerCase() === v);
  if (byName.length === 1) return byName[0].id;
  const byPrefix = members.filter((m) => (m.name ?? "").trim().toLowerCase().startsWith(v));
  if (byPrefix.length === 1) return byPrefix[0].id;
  const candidates = (byName.length > 1 ? byName : byPrefix)
    .map((m) => `${m.name ?? "(no name)"} <${m.email ?? "no email"}>`)
    .join(", ");
  if (candidates) {
    throw new Error(`Member "${value}" is ambiguous — matches: ${candidates}. Use the email.`);
  }
  const legal = members.map((m) => `${m.name ?? "(no name)"} <${m.email ?? "no email"}>`).join(", ");
  throw new Error(`Unknown member "${value}". Team members: ${legal}`);
}

/** Accepts a label uuid or a case-insensitive label name. */
export function resolveLabel(value: string, labels: Label[]): string {
  if (isUuid(value)) return value;
  const v = value.trim().toLowerCase();
  const hit = labels.find((l) => l.name.trim().toLowerCase() === v);
  if (hit) return hit.id;
  const legal = labels.map((l) => l.name).join(", ") || "(none found on existing tasks)";
  throw new Error(`Unknown label "${value}". Known labels: ${legal}`);
}

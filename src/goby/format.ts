import type { Comment, Deliverable, HistoryEntry, Task, Webhook } from "./types.js";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function formatTaskLine(t: Task): string {
  const parts = [
    t.key,
    `[${t.status?.name ?? "no status"}]`,
    t.priority ? `P${t.priority}` : "P-",
    t.title,
  ];
  if (t.assignees.length) parts.push(t.assignees.map((a) => `@${a.name ?? a.id}`).join(" "));
  if (t.labels.length) parts.push(t.labels.map((l) => `#${l.name}`).join(" "));
  if (t.dueAt) parts.push(`due ${day(t.dueAt)}`);
  if (t.estimateHours != null) parts.push(`${t.estimateHours}h`);
  if (t.childCount) parts.push(`(${t.childCount} children)`);
  return parts.join(" ");
}

export function formatTask(t: Task): string {
  const lines = [
    `${t.key}: ${t.title}`,
    `Status: ${t.status ? `${t.status.name} (${t.status.semantic})` : "none"}`,
    `Priority: ${t.priority ?? "none"}`,
    `Assignees: ${t.assignees.map((a) => a.name ?? a.id).join(", ") || "unassigned"}`,
    `Labels: ${t.labels.map((l) => l.name).join(", ") || "none"}`,
    `Due: ${t.dueAt ?? "none"}`,
    `Estimate: ${t.estimateHours != null ? `${t.estimateHours}h` : "none"}`,
  ];
  if (t.parentKey) lines.push(`Parent: ${t.parentKey}`);
  if (t.childCount) lines.push(`Children: ${t.childCount}`);
  if (t.externalKey) lines.push(`External key: ${t.externalKey}`);
  if (t.customFields?.length) {
    lines.push(`Custom fields: ${t.customFields.map((f) => `${f.name}=${f.value}`).join(", ")}`);
  }
  lines.push(`Created: ${t.createdAt}`, `Updated: ${t.updatedAt}`);
  if (t.url) lines.push(`URL: ${t.url}`);
  lines.push("", "Description:", t.description ?? "(none)");
  return lines.join("\n");
}

export function formatComment(c: Comment): string {
  const who = c.author.name ?? (c.author.kind === "agent" ? "agent" : c.author.id ?? "unknown");
  return `[${c.author.kind}] ${who} — ${c.createdAt}\n  ${c.body.replace(/\n/g, "\n  ")}`;
}

function refLabel(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.label === "string") return o.label;
    if (typeof o.name === "string") return o.name;
    if (Array.isArray(v)) return v.map(refLabel).join(", ") || "∅";
    return JSON.stringify(v);
  }
  return String(v);
}

export function formatHistoryEntry(h: HistoryEntry): string {
  const who = h.automation ? "automation" : (h.actor.name ?? h.actor.kind);
  return `${h.occurredAt} ${h.type} by ${who}: ${refLabel(h.from)} → ${refLabel(h.to)}`;
}

export function formatWebhook(w: Webhook): string {
  const flags = [
    w.enabled ? "enabled" : "disabled",
    w.autoDisabledAt ? `AUTO-DISABLED at ${w.autoDisabledAt}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `${w.id} "${w.name}" → ${w.url} [${flags}]`,
    `  events: ${w.events.join(", ")}`,
    `  last success: ${w.lastSuccessAt ?? "never"} | last failure: ${w.lastFailureAt ?? "never"} | created: ${w.createdAt}`,
  ].join("\n");
}

export function formatDeliverable(d: Deliverable): string {
  const parts = [`${d.position}.`, `[${d.state}]`, d.title, `(${d.id})`];
  if (d.description) parts.push(`— ${d.description}`);
  if (d.artifactId) parts.push(`file:${d.artifactId}`);
  return parts.join(" ");
}

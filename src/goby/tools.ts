import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GobyApiError, GobyClient } from "./client.js";
import { formatComment, formatHistoryEntry, formatTask, formatTaskLine, formatWebhook } from "./format.js";
import { resolveLabel, resolveMember, resolveStatus } from "./resolve.js";
import { WEBHOOK_EVENTS, type CreateTask, type Label, type UpdateTask } from "./types.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function describeError(e: unknown): string {
  if (e instanceof GobyApiError) {
    const hints: Partial<Record<string, string>> = {
      unauthorized: "The active token was rejected. Run list-project-tokens to see which token is in use, then set-project-token with a valid gk_<publicId>_<secret> key.",
      forbidden:
        "The key lacks the scope, or its owner is not a participant/lead on this task. Mint integration keys owned by a team lead.",
      rate_limited: "Writes are limited to 60/key/minute. Wait and retry.",
    };
    const hint = hints[e.code];
    return `Goby API error (${e.status}) ${e.message}${hint ? `\n${hint}` : ""}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Wrap a tool handler so any thrown error becomes an isError result. */
const guarded =
  <A>(fn: (args: A) => Promise<ToolResult>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(describeError(e));
    }
  };

const semantic = z.enum(["todo", "in_progress", "blocked", "done"]);
const priority = z.number().int().min(1).max(3);
const isoDate = z
  .string()
  .describe("ISO 8601 timestamp, e.g. 2026-09-01T00:00:00Z (a bare date like 2026-09-01 is accepted too)");

function toIso(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${v}" — use ISO 8601`);
  return d.toISOString();
}

/**
 * Supplies the client for the current call. Credentials are resolved lazily so
 * a token added while the server is running (set-project-token) takes effect
 * immediately, and a server without any token still starts and can explain
 * what is missing. Must throw a descriptive Error when no token is configured.
 */
export type ClientProvider = () => GobyClient;

export function registerGobyTools(server: McpServer, getClient: ClientProvider) {
  // Small per-process caches: statuses and members change rarely. They are
  // tied to the client instance they were fetched with, so a token change
  // (new client) drops them.
  let cacheOwner: GobyClient | null = null;
  let statusesCache: Promise<Awaited<ReturnType<GobyClient["listStatuses"]>>> | null = null;
  let membersCache: Promise<Awaited<ReturnType<GobyClient["listMembers"]>>> | null = null;
  const client = () => {
    const c = getClient();
    if (c !== cacheOwner) {
      cacheOwner = c;
      statusesCache = null;
      membersCache = null;
    }
    return c;
  };
  const statuses = () => (statusesCache ??= client().listStatuses().catch((e) => { statusesCache = null; throw e; }));
  const members = () => (membersCache ??= client().listMembers().catch((e) => { membersCache = null; throw e; }));

  /** There is no /labels endpoint: harvest labels from the tasks the key can see. */
  async function knownLabels(): Promise<Label[]> {
    const seen = new Map<string, Label>();
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await client().listTasks({ includeDone: true, limit: 100, cursor });
      for (const t of r.tasks) for (const l of t.labels) seen.set(l.id, l);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return [...seen.values()];
  }

  async function resolveAssignees(values: string[]): Promise<string[]> {
    const ms = await members();
    return values.map((v) => resolveMember(v, ms));
  }

  async function resolveLabels(values: string[]): Promise<string[]> {
    const ls = await knownLabels();
    return values.map((v) => resolveLabel(v, ls));
  }

  // ---- identity ---------------------------------------------------------

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Verify the Goby API key and learn which team it belongs to, its task key prefix (e.g. OPS), the key's scopes and whose access it borrows.",
      inputSchema: {},
    },
    guarded(async () => {
      const w = await client().whoami();
      return ok(
        [
          `Key: "${w.key.name}" (${w.key.publicId}) scopes: ${w.key.scopes.join(", ")}`,
          `Team: ${w.team.name} (prefix ${w.team.taskKeyPrefix}, id ${w.team.id})`,
          `Owner: ${w.owner.name ?? "(no name)"} — role ${w.owner.role} (id ${w.owner.id})`,
        ].join("\n")
      );
    })
  );

  // ---- lookups ----------------------------------------------------------

  server.registerTool(
    "list-statuses",
    {
      title: "List statuses",
      description: "The team's board columns — the legal status values for create-task / update-task / list-tasks.",
      inputSchema: {},
    },
    guarded(async () => {
      statusesCache = null;
      const s = await statuses();
      return ok(
        s
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((x) => `${x.name} (semantic: ${x.semantic}) id=${x.id}`)
          .join("\n")
      );
    })
  );

  server.registerTool(
    "list-members",
    {
      title: "List members",
      description: "The team's members — legal assignee values. Prefer matching people by email; names can be ambiguous.",
      inputSchema: {},
    },
    guarded(async () => {
      membersCache = null;
      const m = await members();
      return ok(m.map((x) => `${x.name ?? "(no name)"} <${x.email ?? "no email"}> role=${x.role} id=${x.id}`).join("\n"));
    })
  );

  server.registerTool(
    "list-labels",
    {
      title: "List labels",
      description:
        "Labels in use on the team's tasks (harvested from existing tasks — Goby has no labels endpoint, so a label nobody has used yet will not appear).",
      inputSchema: {},
    },
    guarded(async () => {
      const ls = await knownLabels();
      return ok(ls.length ? ls.map((l) => `${l.name} (${l.color}) id=${l.id}`).join("\n") : "No labels found on any visible task.");
    })
  );

  // ---- tasks ------------------------------------------------------------

  server.registerTool(
    "list-tasks",
    {
      title: "List / search tasks",
      description:
        "List the team's tasks, newest-updated first. Completed tasks are excluded unless include_done is true. All filters are optional and combine with AND (status/status_in union; assignee/unassigned union).",
      inputSchema: {
        status: z.string().optional().describe("Status uuid, semantic (todo|in_progress|blocked|done) or column name"),
        status_in: z.array(z.string()).optional().describe("Several statuses (uuid, semantic or name); unions with status"),
        semantic: semantic.optional().describe("Filter by what a column MEANS rather than its name — the portable filter"),
        assignee: z.string().optional().describe("Member uuid, email or name"),
        unassigned: z.boolean().optional().describe("true → tasks with nobody on them (unions with assignee)"),
        label: z.string().optional().describe("Label uuid or name"),
        keys: z.array(z.string()).max(50).optional().describe("Fetch these exact keys, e.g. [\"OPS-1\",\"OPS-2\"] (max 50, one prefix)"),
        updated_since: isoDate.optional().describe("Only tasks updated at/after this time — the polling parameter"),
        updated_before: isoDate.optional().describe("Only tasks untouched since this time — staleness sweeps"),
        include_done: z.boolean().optional().describe("Include completed tasks (default false)"),
        q: z.string().optional().describe("Free-text search over title"),
        sort: z.enum(["updated", "created", "key", "title", "status", "priority", "due", "estimate", "rank"]).optional(),
        direction: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Page size, max 100 (default server-side)"),
        cursor: z.string().optional().describe("nextCursor from the previous page"),
      },
    },
    guarded(async (a) => {
      const needStatuses = a.status || a.status_in?.length;
      const st = needStatuses ? await statuses() : [];
      const page = await client().listTasks({
        status: a.status ? resolveStatus(a.status, st) : undefined,
        statusIn: a.status_in?.length ? a.status_in.map((s) => resolveStatus(s, st)) : undefined,
        semantic: a.semantic,
        assignee: a.assignee ? (await resolveAssignees([a.assignee]))[0] : undefined,
        unassigned: a.unassigned,
        label: a.label ? (await resolveLabels([a.label]))[0] : undefined,
        keys: a.keys?.length ? a.keys : undefined,
        updatedSince: a.updated_since ? toIso(a.updated_since) : undefined,
        updatedBefore: a.updated_before ? toIso(a.updated_before) : undefined,
        includeDone: a.include_done,
        q: a.q,
        sort: a.sort,
        direction: a.direction,
        limit: a.limit,
        cursor: a.cursor,
      });
      if (page.tasks.length === 0) return ok("No tasks matched.");
      const lines = page.tasks.map(formatTaskLine);
      if (page.nextCursor) lines.push("", `More results — pass cursor: ${page.nextCursor}`);
      return ok(lines.join("\n"));
    })
  );

  server.registerTool(
    "get-task",
    {
      title: "Get task",
      description: "Fetch one task by its key (e.g. OPS-42), including its description.",
      inputSchema: { key: z.string().min(1).describe("Task key like OPS-42") },
    },
    guarded(async ({ key }) => ok(formatTask(await client().getTask(key))))
  );

  server.registerTool(
    "create-task",
    {
      title: "Create task",
      description:
        "Create a Goby task. The key (e.g. OPS-43) is assigned by the server. Status, assignees and labels accept friendly values (semantic/name, email/name, label name) as well as uuids. Goby has no issue types or sprints — use priority (1 highest … 3) and labels.",
      inputSchema: {
        title: z.string().min(1).max(200),
        description: z.string().max(10000).optional().describe("Becomes the task's opening message (markdown)"),
        status: z.string().optional().describe("Status uuid, semantic (todo|in_progress|blocked|done) or column name. Defaults to the team's first todo column"),
        priority: priority.optional().describe("1 (highest) to 3"),
        due_at: isoDate.optional(),
        assignees: z.array(z.string()).optional().describe("Member uuids, emails or names"),
        labels: z.array(z.string()).optional().describe("Label uuids or names (must already exist on some task)"),
        estimate_hours: z.number().nonnegative().optional(),
        idempotency_key: z.string().max(200).optional().describe("Send the same key on a retry to avoid creating the task twice"),
      },
    },
    guarded(async (a) => {
      const body: CreateTask = { title: a.title };
      if (a.description !== undefined) body.description = a.description;
      if (a.status) body.statusId = resolveStatus(a.status, await statuses());
      if (a.priority !== undefined) body.priority = a.priority as 1 | 2 | 3;
      if (a.due_at) body.dueAt = toIso(a.due_at);
      if (a.assignees?.length) body.assigneeIds = await resolveAssignees(a.assignees);
      if (a.labels?.length) body.labelIds = await resolveLabels(a.labels);
      if (a.estimate_hours !== undefined) body.estimateHours = a.estimate_hours;
      const t = await client().createTask(body, a.idempotency_key);
      return ok(`Created ${t.key}${t.url ? ` — ${t.url}` : ""}\n\n${formatTask(t)}`);
    })
  );

  server.registerTool(
    "update-task",
    {
      title: "Update task",
      description:
        "Update any subset of a task's fields (PATCH semantics: omitted fields are untouched). Use the clear_* flags to clear a field. Editing requires the key's owner to be a participant or a team lead.",
      inputSchema: {
        key: z.string().min(1).describe("Task key like OPS-42"),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(10000).optional(),
        status: z.string().optional().describe("Status uuid, semantic (todo|in_progress|blocked|done) or column name"),
        priority: priority.optional(),
        due_at: isoDate.optional(),
        assignees: z.array(z.string()).optional().describe("Replaces the assignee set. Member uuids, emails or names; [] to unassign"),
        labels: z.array(z.string()).optional().describe("Replaces the label set. Label uuids or names; [] to remove all"),
        estimate_hours: z.number().nonnegative().optional(),
        clear_description: z.boolean().optional(),
        clear_priority: z.boolean().optional(),
        clear_due_at: z.boolean().optional(),
        clear_estimate_hours: z.boolean().optional(),
      },
    },
    guarded(async (a) => {
      const body: UpdateTask = {};
      if (a.title !== undefined) body.title = a.title;
      if (a.description !== undefined) body.description = a.description;
      if (a.status) body.statusId = resolveStatus(a.status, await statuses());
      if (a.priority !== undefined) body.priority = a.priority as 1 | 2 | 3;
      if (a.due_at) body.dueAt = toIso(a.due_at);
      if (a.assignees !== undefined) body.assigneeIds = a.assignees.length ? await resolveAssignees(a.assignees) : [];
      if (a.labels !== undefined) body.labelIds = a.labels.length ? await resolveLabels(a.labels) : [];
      if (a.estimate_hours !== undefined) body.estimateHours = a.estimate_hours;
      if (a.clear_description) body.description = null;
      if (a.clear_priority) body.priority = null;
      if (a.clear_due_at) body.dueAt = null;
      if (a.clear_estimate_hours) body.estimateHours = null;
      if (Object.keys(body).length === 0) return fail("Nothing to update — provide at least one field.");
      const t = await client().updateTask(a.key, body);
      return ok(`Updated ${t.key}\n\n${formatTask(t)}`);
    })
  );

  // ---- comments & history ----------------------------------------------

  server.registerTool(
    "get-comments",
    {
      title: "Get comments",
      description: "The task's conversation, oldest first (user, agent and system messages). Needs the comments:read scope.",
      inputSchema: { key: z.string().min(1).describe("Task key like OPS-42") },
    },
    guarded(async ({ key }) => {
      const cs = await client().listComments(key);
      return ok(cs.length ? cs.map(formatComment).join("\n\n") : `No comments on ${key}.`);
    })
  );

  server.registerTool(
    "add-comment",
    {
      title: "Add comment",
      description:
        "Post a comment on a task. By default the comment is written WITHOUT waking the Goby agent (no provider spend) — set start_agent_run=true to have the agent respond, exactly as if a person typed into the thread. Needs the comments:write scope. A comment still moves a todo task to in_progress.",
      inputSchema: {
        key: z.string().min(1).describe("Task key like OPS-42"),
        body: z.string().min(1).max(10000).describe("Comment text (markdown)"),
        start_agent_run: z.boolean().optional().describe("true → the agent reads and acts on the comment (spends provider budget). Default false"),
        pinned: z.boolean().optional().describe("Pin to the top of the thread — for reference material such as a spec"),
        idempotency_key: z.string().max(200).optional(),
      },
    },
    guarded(async (a) => {
      const c = await client().addComment(
        a.key,
        { body: a.body, suppressAgent: !a.start_agent_run, pinned: a.pinned ?? false },
        a.idempotency_key
      );
      return ok(`Comment ${c.id} added to ${c.taskKey}${a.start_agent_run ? " (agent run started)" : ""}.\n\n${formatComment(c)}`);
    })
  );

  server.registerTool(
    "get-task-history",
    {
      title: "Get task history",
      description: "A task's recorded workflow changes (status, assignee, due date), newest first. Carries no message content.",
      inputSchema: {
        key: z.string().min(1).describe("Task key like OPS-42"),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    guarded(async (a) => {
      const page = await client().getHistory(a.key, { limit: a.limit, cursor: a.cursor });
      if (!page.history.length) return ok(`No history for ${a.key}.`);
      const lines = page.history.map(formatHistoryEntry);
      if (page.nextCursor) lines.push("", `More results — pass cursor: ${page.nextCursor}`);
      return ok(lines.join("\n"));
    })
  );

  // ---- webhooks ---------------------------------------------------------

  const events = z.array(z.enum(WEBHOOK_EVENTS));

  server.registerTool(
    "list-webhooks",
    {
      title: "List webhooks",
      description: "This team's webhook endpoints. Needs the webhooks:write scope.",
      inputSchema: {},
    },
    guarded(async () => {
      const ws = await client().listWebhooks();
      return ok(ws.length ? ws.map(formatWebhook).join("\n\n") : "No webhooks registered.");
    })
  );

  server.registerTool(
    "create-webhook",
    {
      title: "Create webhook",
      description:
        "Register an HTTPS endpoint to receive task events. The signing secret is returned ONCE here and can never be read back — store it. Needs the webhooks:write scope.",
      inputSchema: {
        name: z.string().min(1).max(80),
        url: z.string().url().describe("https URL"),
        events: events.optional().describe("Defaults to a sensible set when omitted"),
      },
    },
    guarded(async (a) => {
      const r = await client().createWebhook({ name: a.name, url: a.url, events: a.events });
      return ok(`Created webhook.\nSECRET (shown once, store it now): ${r.secret}\n\n${formatWebhook(r.webhook)}`);
    })
  );

  server.registerTool(
    "update-webhook",
    {
      title: "Update webhook",
      description: "Update a webhook's name, url, events or enabled flag (any subset). Re-enable an auto-disabled endpoint with enabled=true after fixing the receiver.",
      inputSchema: {
        id: z.string().min(1).describe("Webhook uuid"),
        name: z.string().min(1).max(80).optional(),
        url: z.string().url().optional(),
        events: events.optional(),
        enabled: z.boolean().optional(),
      },
    },
    guarded(async ({ id, ...rest }) => {
      const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(body).length === 0) return fail("Nothing to update — provide at least one field.");
      const w = await client().updateWebhook(id, body);
      return ok(`Updated webhook.\n\n${formatWebhook(w)}`);
    })
  );

  server.registerTool(
    "delete-webhook",
    {
      title: "Delete webhook",
      description: "Delete a webhook endpoint permanently (this is also how you rotate a secret: delete, then create again).",
      inputSchema: { id: z.string().min(1).describe("Webhook uuid") },
    },
    guarded(async ({ id }) => {
      await client().deleteWebhook(id);
      return ok(`Deleted webhook ${id}.`);
    })
  );
}

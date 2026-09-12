import type {
  Comment,
  CreateComment,
  CreateTask,
  CreateWebhook,
  HistoryPage,
  ListTasksQuery,
  Member,
  Status,
  Task,
  TaskPage,
  UpdateTask,
  UpdateWebhook,
  Webhook,
  Whoami,
  CreateDeliverable,
  Deliverable,
  UpdateDeliverable,
} from "./types.js";

export type GobyErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "internal"
  | "unknown";

export class GobyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: GobyErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = "GobyApiError";
  }
}

export interface GobyClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Back-off before the single retry on 429. Default 1000 ms. */
  rateLimitBackoffMs?: number;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

export class GobyClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoff: number;

  constructor(opts: GobyClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "") + "/api/v1";
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.backoff = opts.rateLimitBackoffMs ?? 1000;
  }

  // ---- core -------------------------------------------------------------

  private url(path: string, query?: Query): string {
    const u = new URL(this.base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        u.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
      }
    }
    return u.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; headers?: Record<string, string> } = {},
    attempt = 0
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
      ...opts.headers,
    };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const res = await this.fetchImpl(this.url(path, opts.query), init);

    if (res.status === 429 && attempt === 0) {
      await this.sleep(this.backoff);
      return this.request<T>(method, path, opts, attempt + 1);
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!res.ok) {
      const env = json as { error?: { code?: string; message?: string } } | undefined;
      const code = (env?.error?.code ?? "unknown") as GobyErrorCode;
      const message =
        env?.error?.message ?? (text || `${res.status} ${res.statusText}`);
      throw new GobyApiError(res.status, code, message);
    }

    return json as T;
  }

  // ---- endpoints --------------------------------------------------------

  whoami(): Promise<Whoami> {
    return this.request("GET", "/whoami");
  }

  listTasks(q: ListTasksQuery = {}): Promise<TaskPage> {
    return this.request("GET", "/tasks", { query: q as Query });
  }

  getTask(key: string): Promise<Task> {
    return this.request("GET", `/tasks/${encodeURIComponent(key)}`);
  }

  createTask(body: CreateTask, idempotencyKey?: string): Promise<Task> {
    return this.request("POST", "/tasks", {
      body,
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    });
  }

  updateTask(key: string, body: UpdateTask): Promise<Task> {
    return this.request("PATCH", `/tasks/${encodeURIComponent(key)}`, { body });
  }

  async listComments(key: string): Promise<Comment[]> {
    const r = await this.request<{ comments: Comment[] }>(
      "GET",
      `/tasks/${encodeURIComponent(key)}/comments`
    );
    return r.comments;
  }

  addComment(key: string, body: CreateComment, idempotencyKey?: string): Promise<Comment> {
    return this.request("POST", `/tasks/${encodeURIComponent(key)}/comments`, {
      body,
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    });
  }

  getHistory(key: string, q: { limit?: number; cursor?: string } = {}): Promise<HistoryPage> {
    return this.request("GET", `/tasks/${encodeURIComponent(key)}/history`, { query: q });
  }

  listDeliverables(key: string): Promise<Deliverable[]> {
    return this.request<Deliverable[]>("GET", `/tasks/${encodeURIComponent(key)}/deliverables`);
  }

  createDeliverable(key: string, body: CreateDeliverable): Promise<Deliverable> {
    return this.request<Deliverable>("POST", `/tasks/${encodeURIComponent(key)}/deliverables`, { body });
  }

  updateDeliverable(key: string, id: string, body: UpdateDeliverable): Promise<Deliverable> {
    return this.request<Deliverable>(
      "PATCH",
      `/tasks/${encodeURIComponent(key)}/deliverables/${encodeURIComponent(id)}`,
      { body },
    );
  }

  listStatuses(): Promise<Status[]> {
    return this.request("GET", "/statuses");
  }

  listMembers(): Promise<Member[]> {
    return this.request("GET", "/members");
  }

  async listWebhooks(): Promise<Webhook[]> {
    const r = await this.request<Webhook[] | { webhooks: Webhook[] }>("GET", "/webhooks");
    return Array.isArray(r) ? r : r.webhooks;
  }

  createWebhook(body: CreateWebhook): Promise<{ webhook: Webhook; secret: string }> {
    return this.request("POST", "/webhooks", { body });
  }

  async updateWebhook(id: string, body: UpdateWebhook): Promise<Webhook> {
    const r = await this.request<Webhook | { webhook: Webhook }>(
      "PATCH",
      `/webhooks/${encodeURIComponent(id)}`,
      { body }
    );
    return "webhook" in r ? r.webhook : r;
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request<void>("DELETE", `/webhooks/${encodeURIComponent(id)}`);
  }
}

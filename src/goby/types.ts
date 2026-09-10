export type Semantic = "todo" | "in_progress" | "blocked" | "done";
export type ActorKind = "user" | "agent" | "system";

export interface Whoami {
  key: { publicId: string; name: string; scopes: string[] };
  team: { id: string; name: string; taskKeyPrefix: string };
  owner: { id: string; name: string | null; role: string };
}

export interface Status {
  id: string;
  name: string;
  semantic: Semantic;
  sortOrder: number;
}

export interface Member {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  key: string;
  id: string;
  title: string;
  description: string | null;
  status: { id: string; name: string; semantic: Semantic } | null;
  priority: 1 | 2 | 3 | null;
  dueAt: string | null;
  estimateHours: number | null;
  assignees: { id: string; name: string | null }[];
  labels: Label[];
  parentKey: string | null;
  childCount: number;
  externalKey: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface TaskPage {
  tasks: Task[];
  nextCursor: string | null;
}

export interface CreateTask {
  title: string;
  description?: string;
  statusId?: string;
  priority?: 1 | 2 | 3 | null;
  dueAt?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
  estimateHours?: number | null;
}

export interface UpdateTask {
  title?: string;
  description?: string | null;
  statusId?: string;
  priority?: 1 | 2 | 3 | null;
  dueAt?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
  estimateHours?: number | null;
}

export interface Comment {
  id: string;
  taskKey: string;
  author: { id: string | null; name: string | null; kind: ActorKind };
  body: string;
  createdAt: string;
}

export interface CreateComment {
  body: string;
  suppressAgent?: boolean;
  pinned?: boolean;
}

export type HistoryType = "status_changed" | "assigned" | "due_changed";

export interface HistoryEntry {
  id: string;
  taskKey: string;
  type: HistoryType;
  actor: { id: string | null; name: string | null; kind: ActorKind };
  from?: unknown;
  to?: unknown;
  automation: boolean;
  occurredAt: string;
}

export interface HistoryPage {
  history: HistoryEntry[];
  nextCursor: string | null;
}

export const WEBHOOK_EVENTS = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.completed",
  "task.comment_created",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  autoDisabledAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export interface CreateWebhook {
  name: string;
  url: string;
  events?: WebhookEvent[];
}

export interface UpdateWebhook {
  name?: string;
  url?: string;
  events?: WebhookEvent[];
  enabled?: boolean;
}

export interface ListTasksQuery {
  status?: string;
  statusIn?: string[];
  semantic?: Semantic;
  assignee?: string;
  unassigned?: boolean;
  label?: string;
  keys?: string[];
  updatedSince?: string;
  updatedBefore?: string;
  includeDone?: boolean;
  q?: string;
  sort?: string;
  direction?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

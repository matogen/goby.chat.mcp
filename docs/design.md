# goby-mcp — MCP server for the Goby public API v1

## Purpose
Let Claude (Claude Code, Desktop) create, read, update and comment on Goby tasks
from any MCP client. One stdio MCP server,
one Goby team per API key, one key per project directory.

## Configuration
| Env | Meaning |
|---|---|
| `GOBY_BASE_URL` | Instance origin, e.g. `https://acme.goby.chat`. `/api/v1` is appended. Overrides stored URLs. |
| `GOBY_API_KEY` | `gk_<publicId>_<secret>` minted under Admin → API keys. Owner should be a team lead so the key can edit any task. Overrides stored tokens. |
| `GOBY_MCP_CONFIG` | Token store path (default `$XDG_CONFIG_HOME/goby-mcp/config.json`). |

### Per-project tokens (added 2026-09-10)
A key belongs to one team, so the server is registered once (user scope, no env) and holds
**one token per project directory** in the token store (`{ baseUrl?, apiKey?, projects: { "/abs/dir": { apiKey, baseUrl? } } }`,
file mode 0600). At every tool call the server resolves credentials for its `cwd` (Claude Code
starts stdio servers in the project directory): env → longest matching project dir → store
default → none. Without a token the server still starts; tools return an `isError` result that
says how to add one. Clients are cached per (baseUrl, apiKey) so a token change drops the
statuses/members caches. Managed by tools `list-project-tokens` / `set-project-token` /
`remove-project-token` and the CLI `goby-mcp token set|set-default|list|remove|remove-default`.

## Layout
```
src/index.ts          server bootstrap, stdio transport
src/goby/client.ts    GobyClient: fetch wrapper, bearer auth, error envelope → GobyApiError, 429 retry
src/goby/types.ts     resource shapes from the OpenAPI spec
src/goby/resolve.ts   status (semantic|name|id), member (email|name|id), label (name|id) → uuid
src/goby/format.ts    compact text rendering of tasks / comments / history
src/goby/tools.ts     registerGobyTools(server, getClient)
src/goby/config.ts    TokenStore, resolveCredentials (per-project tokens)
src/goby/token-tools.ts  list/set/remove-project-token
src/cli.ts            `goby-mcp token …` subcommands
```

## Tools
| Tool | Endpoint | Notes |
|---|---|---|
| `whoami` | GET /whoami | verify key, learn team + prefix |
| `list-tasks` | GET /tasks | every documented filter; returns compact lines + nextCursor |
| `get-task` | GET /tasks/{key} | full JSON |
| `create-task` | POST /tasks | `status`, `assignees`, `labels` accept friendly values; optional `idempotency_key` |
| `update-task` | PATCH /tasks/{key} | same friendly values; explicit `clear_*` flags send `null` |
| `get-comments` | GET /tasks/{key}/comments | needs comments:read |
| `add-comment` | POST /tasks/{key}/comments | `start_agent_run` default **false** → `suppressAgent: true`; `pinned` |
| `get-task-history` | GET /tasks/{key}/history | |
| `list-statuses` | GET /statuses | |
| `list-members` | GET /members | |
| `list-webhooks` / `create-webhook` / `update-webhook` / `delete-webhook` | /webhooks | secret surfaced once on create |

## Error handling
API errors become `{ isError: true, content: [{ type: "text", text: "<code>: <message>" }] }`.
Resolution failures (unknown status/member/label) list the legal values in the message.
429 is retried once after the documented back-off (1 s), then surfaced.

## Testing
`node:test` over the compiled build with an injected `fetch` — client envelope/error mapping,
resolver matching rules, formatter output. Live check: `whoami` against the instance.

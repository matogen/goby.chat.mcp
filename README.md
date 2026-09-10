# goby-mcp

An [MCP](https://modelcontextprotocol.io) server for the [Goby](https://goby.chat) public API v1.
Lets Claude Code (or any MCP client) list, search, create, update and comment on Goby tasks,
and manage webhooks.

Register it once, then store **one API token per project directory**: a Goby key belongs to a
single team, so different projects on your machine can talk to different Goby teams without
re-registering anything.

## Install

Requires Node 22+.

```bash
git clone https://github.com/matogen/goby.chat.mcp.git
cd goby.chat.mcp
npm install
npm run build        # → build/index.js
```

### Register with Claude Code (once, user scope)

```bash
claude mcp add --scope user goby-mcp -- node /absolute/path/to/goby.chat.mcp/build/index.js
```

Equivalent `~/.claude.json` entry:

```json
"goby-mcp": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/goby.chat.mcp/build/index.js"]
}
```

No key goes in the registration. The server starts without one; every tool explains what is
missing until a token is added.

### Mint an API key

In your Goby instance (`https://<team>.goby.chat`) open **Admin → API keys**. A key belongs to
one team and borrows its owner's access — **make a team lead the owner** so the key can edit any
task on the board. Scopes you will want: `tasks:read`, `tasks:write`, `comments:read`,
`comments:write` (and `webhooks:write` to manage webhooks).

### Add a token per project

Claude Code starts the server in the project directory. The server uses the token stored for the
longest matching directory, so a token for `~/src/acme` also covers `~/src/acme/api`.
Tokens live in `~/.config/goby-mcp/config.json` (file mode 0600; override the path with
`GOBY_MCP_CONFIG`) — never inside a repository.

From inside Claude Code, in the project:

> use set-project-token with api_key gk_… and base_url https://acme.goby.chat

Or from a shell:

```bash
node build/index.js token set gk_... --base-url https://acme.goby.chat --dir ~/src/acme
node build/index.js token list                          # masked; shows which token is active here
node build/index.js token remove --dir ~/src/acme
node build/index.js token set-default --base-url https://acme.goby.chat   # url used when a project has none
node build/index.js token set-default gk_...            # token used when no project matches
```

Resolution order, evaluated on every call (no restart needed):

| | Token | Instance URL |
|---|---|---|
| 1 | `GOBY_API_KEY` env | `GOBY_BASE_URL` env |
| 2 | project directory token | that project's `base_url` |
| 3 | stored default token | stored default URL |

A `.env` in the project directory is also read (see `.env.example`).

## Tools

| Tool | What it does |
|---|---|
| `whoami` | Verify the active key; learn team, key prefix, scopes, owner |
| `list-statuses` | Board columns (legal status values) |
| `list-members` | Team members (legal assignees) — match by email |
| `list-labels` | Labels seen on existing tasks (Goby has no labels endpoint) |
| `list-tasks` | Search/filter: status, semantic, assignee, unassigned, label, keys, updated_since/before, include_done, q, sort, paging |
| `get-task` | One task by key (`OPS-42`) with description |
| `create-task` | Create a task; `status`/`assignees`/`labels` accept names, emails, semantics or uuids |
| `update-task` | PATCH any subset; `clear_*` flags send `null` |
| `get-comments` | Task thread (needs `comments:read`) |
| `add-comment` | Post a note. **Does not wake the Goby agent unless `start_agent_run: true`** |
| `get-task-history` | Status / assignee / due-date transitions |
| `list-webhooks`, `create-webhook`, `update-webhook`, `delete-webhook` | Webhook endpoints (needs `webhooks:write`); secret shown once on create |
| `list-project-tokens` | Which (masked) token is active for this directory, where it came from, all stored tokens |
| `set-project-token` | Store a `gk_` key (and `base_url`) for a project directory, default the current one |
| `remove-project-token` | Forget a project's token |

Notes
- Goby has no issue types or sprints — use `priority` (1 = highest … 3) and labels.
- Comments start a paid agent run in Goby unless suppressed; this server suppresses by default.
- Writes are rate-limited to 60/key/minute; the server retries once on 429.
- Pass `idempotency_key` on a create you might retry.

## Development

```bash
npm test             # tsc + node:test unit tests (fake fetch, temp token store)
```

Layout and design notes: [docs/design.md](docs/design.md).

## License

[MIT](LICENSE)

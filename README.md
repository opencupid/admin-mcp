# OpenCupid Admin MCP

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets LLMs (Claude, etc.) query OpenCupid admin KPIs and the moderation queue.

It is a thin proxy over the backend admin API (`/api/admin/*`): it only issues `GET` requests, holds no database credentials and has no write tools. It is served over **Streamable HTTP** (stateless, `POST /mcp`), which works with Claude Code, the Claude API MCP connector and any spec-compliant MCP client.

## Tools

All tools are annotated `readOnlyHint: true`. All timestamps are UTC.

| Tool                     | Admin API endpoint        | Description                                                                                                                            |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `get_kpi_summary`        | `GET /stats`              | Active profiles, 7-day signups, blocked users, reported profiles, activity segment distribution                                        |
| `get_daily_kpis`         | `GET /stats/daily`        | Zero-filled daily series for the last 7 days: signups, daily active, blocked, reported, interactions, matches, messages                |
| `get_activity_breakdown` | `GET /stats/breakdown`    | `interactions` (likes / anonymous / matches) or `messages` (messages / new conversations), over `24h` / `72h` (hourly) or `7d` (daily) |
| `list_trust_flags`       | `GET /trust-flags`        | Moderation queue: flagged profiles, reason, flaggedBy, evidence, cleared status. Filter by `reason`, `includeCleared`, paginated       |
| `get_profile`            | `GET /profiles/:id`       | Full profile, owning user status, images, active trust flags                                                                           |
| `search_profiles`        | `GET /profiles`           | Search by name / city / country / id / email / phone; filter by `country`, activity `segments`                                         |
| `get_user`               | `GET /users/:id`          | User account status, roles, language, origin, lastSeenAt, linked profile summary                                                       |
| `search_users`           | `GET /users`              | Search accounts by id / email / phone; `hasProfile=false` finds signups that never onboarded                                           |
| `list_profile_countries` | `GET /profiles/countries` | Distinct profile country codes                                                                                                         |
| `list_user_origins`      | `GET /users/origins`      | Distinct signup brand domains                                                                                                          |
| `list_tags`              | `GET /tags`               | Interest tags by popularity with translations                                                                                          |

Deliberately **not** exposed: every mutating endpoint (`PATCH`/`POST`/`DELETE`, including clearing or setting trust flags), `/subscribers` (bulk email export) and message templates.

Historical depth is whatever the admin API serves today (7 days daily, 72 hours hourly).

## Configuration

| Variable               | Required | Default   | Description                                                                                                            |
| ---------------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_API_URL`        | yes      |           | Internal admin API base URL, e.g. `http://backend:3000/api/admin`                                                      |
| `MCP_AUTH_TOKEN`       | yes      |           | Bearer token clients must send (min. 32 chars). Generate with `openssl rand -hex 32`                                   |
| `PORT`                 |          | `8080`    | Listen port                                                                                                            |
| `HOST`                 |          | `0.0.0.0` | Listen address                                                                                                         |
| `MCP_ALLOWED_HOSTS`    |          | (empty)   | Comma-separated `Host` header allowlist (DNS rebinding protection), e.g. `mcp.admin.example.org`                       |
| `EXPOSE_CONTACT_PII`   |          | `false`   | When `false`, every `email` and `phonenumber` field is stripped from tool output. Searching by email/phone still works |
| `ADMIN_API_TIMEOUT_MS` |          | `15000`   | Upstream request timeout                                                                                               |

See [`.env.example`](.env.example).

## Endpoints

| Method | Path       | Auth   | Description                                                    |
| ------ | ---------- | ------ | -------------------------------------------------------------- |
| `POST` | `/mcp`     | Bearer | MCP Streamable HTTP endpoint (stateless; JSON or SSE response) |
| `GET`  | `/mcp`     |        | `405` — no standalone SSE stream in stateless mode             |
| `GET`  | `/healthz` | none   | Liveness probe                                                 |

## Development

```bash
pnpm install
cp .env.example .env   # set MCP_AUTH_TOKEN; point ADMIN_API_URL at a local backend
pnpm dev
```

Against a local OpenCupid dev stack (`pnpm dev` in `opencupid/opencupid`), use `ADMIN_API_URL=https://localhost:3000/api/admin` with `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed dev certificate.

Inspect interactively with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Choose transport "Streamable HTTP", URL `http://localhost:8080/mcp`, and add the header `Authorization: Bearer <token>`.

Checks:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Releases

Versioning follows the same [Changesets](https://github.com/changesets/changesets) flow as `opencupid/opencupid`:

1. Every PR adds a changeset (`.changeset/<three-random-words>.md`; CI enforces it):

   ```md
   ---
   '@opencupid/admin-mcp': patch
   ---

   Short description of the change
   ```

2. Run the **Release** workflow (Actions → Release → Run workflow). It applies the version bump, updates `CHANGELOG.md`, commits to `main`, and creates the `vX.Y.Z` GitHub release. Requires the `GHCR_PAT` repository secret (a PAT allowed to push to `main` and create releases, so the release event can trigger other workflows).
3. Publishing the release triggers **Docker Build**, which pushes `ghcr.io/opencupid/admin-mcp` tagged `X.Y.Z`, `vX.Y.Z`, `<short-sha>` and `latest`. It skips versions already in GHCR unless started manually with `force`.

## Production deployment

The MCP server must run on the **same Docker network as the backend** and call it directly at `http://backend:3000`. The backend trusts the `X-Admin-Authenticated: true` header that this service sends; on the public side Traefik injects that header only behind admin mTLS and strips it everywhere else. Never point `ADMIN_API_URL` at a public hostname.

Claude cannot present the admin mTLS client certificate, so the MCP endpoint is published on its own hostname and protected by the bearer token instead.

### 1. DNS

Point a new hostname (e.g. `mcp.admin.example.org`) at the production host.

### 2. `.env` on the host

Add the following to the existing `~/opencupid/.env` (keep all other variables):

```dotenv
MCP_DOMAIN=mcp.admin.example.org
ADMIN_MCP_VERSION=0.1.0
ADMIN_MCP_AUTH_TOKEN=<openssl rand -hex 32>
```

### 3. Compose service + Traefik labels

Add this service to `docker-compose.production.yml`, or to a `docker-compose.override.yml` next to it on the host. It joins the compose project's default network, so it can reach `backend` and Traefik discovers it through the Docker labels. `rate-limit@file` comes from the ingress `dynamic/middlewares.yml`.

```yaml
admin-mcp:
  image: ghcr.io/opencupid/admin-mcp:${ADMIN_MCP_VERSION:-latest}
  restart: always
  depends_on:
    - backend
  environment:
    ADMIN_API_URL: http://backend:3000/api/admin
    MCP_AUTH_TOKEN: ${ADMIN_MCP_AUTH_TOKEN}
    MCP_ALLOWED_HOSTS: ${MCP_DOMAIN}
    EXPOSE_CONTACT_PII: 'false'
  labels:
    traefik.enable: 'true'
    traefik.http.routers.admin-mcp.rule: 'Host(`${MCP_DOMAIN}`) && Path(`/mcp`)'
    traefik.http.routers.admin-mcp.entrypoints: websecure
    traefik.http.routers.admin-mcp.tls.certResolver: letsencrypt
    traefik.http.routers.admin-mcp.middlewares: rate-limit@file
    traefik.http.services.admin-mcp.loadbalancer.server.port: '8080'
```

Notes:

- Do **not** add `compress@file` to this router. Streamable HTTP can answer with `text/event-stream`, and buffering compression breaks streaming.
- The router matches only `/mcp`, so `/healthz` stays internal (the image's Docker `HEALTHCHECK` uses it).
- To restrict access by IP in addition to the token, add an `ipAllowList` middleware to `apps/ingress/dynamic/middlewares.yml` and list it in `middlewares`.

### 4. Deploy

```bash
cd ~/opencupid
docker compose -f docker-compose.production.yml pull admin-mcp
docker compose -f docker-compose.production.yml up -d --no-deps admin-mcp
docker compose -f docker-compose.production.yml logs --tail=50 admin-mcp
```

Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.admin.example.org/mcp   # 401
```

To upgrade, bump `ADMIN_MCP_VERSION` in `.env`, then run `pull` and `up -d` again. To rotate the token, change `ADMIN_MCP_AUTH_TOKEN`, run `up -d`, and update the clients.

## Connecting Claude

**Claude Code**

```bash
claude mcp add --transport http opencupid-admin https://mcp.admin.example.org/mcp \
  --header "Authorization: Bearer $ADMIN_MCP_AUTH_TOKEN"
```

**Claude API (MCP connector)**

```json
"mcp_servers": [
  {
    "type": "url",
    "url": "https://mcp.admin.example.org/mcp",
    "name": "opencupid-admin",
    "authorization_token": "<ADMIN_MCP_AUTH_TOKEN>"
  }
]
```

**Claude Desktop** — bridge with `mcp-remote` in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opencupid-admin": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.admin.example.org/mcp",
        "--header",
        "Authorization: Bearer ${ADMIN_MCP_AUTH_TOKEN}"
      ],
      "env": { "ADMIN_MCP_AUTH_TOKEN": "<token>" }
    }
  }
}
```

claude.ai web/mobile custom connectors require OAuth and cannot send a static bearer token, so they are not supported by this server.

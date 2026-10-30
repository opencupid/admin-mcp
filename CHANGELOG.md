# @opencupid/admin-mcp

## 0.1.1

### Patch Changes

- 07fa7fe: Serve /healthz outside the Host header allowlist so the container healthcheck passes when MCP_ALLOWED_HOSTS is set

## 0.1.0

### Minor Changes

- e0bae21: Initial read-only MCP server (Streamable HTTP) exposing admin KPIs, activity breakdowns and the moderation queue

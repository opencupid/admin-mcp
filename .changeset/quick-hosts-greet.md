---
'@opencupid/admin-mcp': patch
---

Serve /healthz outside the Host header allowlist so the container healthcheck passes when MCP_ALLOWED_HOSTS is set

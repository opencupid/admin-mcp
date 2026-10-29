import { timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import type { NextFunction, Request, Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { AdminClient } from './adminClient.js'
import type { Config } from './config.js'
import { registerTools } from './tools.js'

export const SERVER_NAME = 'opencupid-admin'
export const SERVER_VERSION: string = createRequire(import.meta.url)('../package.json').version

export function createMcpServer(config: Config, client: AdminClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Read-only access to OpenCupid admin metrics and the moderation queue. ' +
        'Use get_kpi_summary / get_daily_kpis / get_activity_breakdown for KPIs, ' +
        'list_trust_flags for flagged profiles, then get_profile for detail. ' +
        'All timestamps are UTC.' +
        (config.EXPOSE_CONTACT_PII ? '' : ' Email and phone numbers are redacted.'),
    }
  )
  registerTools(server, { client, exposeContactPii: config.EXPOSE_CONTACT_PII })
  return server
}

function bearerAuth(token: string) {
  const expected = Buffer.from(`Bearer ${token}`)
  return (req: Request, res: Response, next: NextFunction) => {
    const given = Buffer.from(req.headers.authorization ?? '')
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next()
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer')
      .json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null })
  }
}

function methodNotAllowed(_req: Request, res: Response) {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
}

/**
 * Express app serving MCP over stateless Streamable HTTP at POST /mcp. A fresh
 * McpServer + transport is created per request, so no session state is kept
 * and the service scales horizontally without sticky sessions.
 */
export function createApp(config: Config, client?: AdminClient) {
  const adminClient =
    client ??
    new AdminClient({ baseUrl: config.ADMIN_API_URL, timeoutMs: config.ADMIN_API_TIMEOUT_MS })

  const app = createMcpExpressApp({
    host: config.HOST,
    ...(config.MCP_ALLOWED_HOSTS.length > 0 ? { allowedHosts: config.MCP_ALLOWED_HOSTS } : {}),
  })

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.post('/mcp', bearerAuth(config.MCP_AUTH_TOKEN), async (req, res) => {
    const server = createMcpServer(config, adminClient)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('Error handling MCP request', err)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    }
  })
  app.get('/mcp', methodNotAllowed)
  app.delete('/mcp', methodNotAllowed)

  return app
}

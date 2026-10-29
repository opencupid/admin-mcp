import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AdminClient } from '../adminClient.js'
import { loadConfig, type Config } from '../config.js'
import { createApp } from '../server.js'
import { TOOLS } from '../tools.js'

const TOKEN = 't'.repeat(40)
const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function startServer(config: Config) {
  const adminClient = new AdminClient({
    baseUrl: config.ADMIN_API_URL,
    timeoutMs: 1000,
    fetch: fetchMock,
  })
  const httpServer: Server = await new Promise((resolve) => {
    const s = createApp(config, adminClient).listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = httpServer.address() as AddressInfo
  return { httpServer, url: `http://127.0.0.1:${port}` }
}

async function connect(url: string, token = TOKEN) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>) {
  return (result.content as { type: string; text: string }[])[0].text
}

describe('MCP server', () => {
  let httpServer: Server
  let url: string

  beforeAll(async () => {
    ;({ httpServer, url } = await startServer(
      loadConfig({
        ADMIN_API_URL: 'http://backend:3000/api/admin',
        MCP_AUTH_TOKEN: TOKEN,
        HOST: '127.0.0.1',
      })
    ))
  })

  afterAll(() => new Promise<void>((resolve) => httpServer.close(() => resolve())))

  beforeEach(() => fetchMock.mockReset())

  it('serves a health check without auth', async () => {
    const res = await fetch(`${url}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('rejects requests without a valid bearer token', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Bearer')
  })

  it('rejects GET /mcp (stateless server, no SSE stream)', async () => {
    const res = await fetch(`${url}/mcp`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(405)
  })

  it('lists every tool as read-only', async () => {
    const client = await connect(url)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort())
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool.annotations?.destructiveHint).toBe(false)
    }
    await client.close()
  })

  it('maps list_trust_flags input to the admin API query and redacts contact PII', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        flags: [
          {
            id: 'f1',
            reason: 'SPAM_BURST',
            profile: { id: 'p1', publicName: 'Kornél', email: 'k@example.org' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      })
    )
    const client = await connect(url)
    const result = await client.callTool({
      name: 'list_trust_flags',
      arguments: { reason: 'SPAM_BURST', includeCleared: true, pageSize: 10 },
    })

    const requested = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requested.pathname).toBe('/api/admin/trust-flags')
    expect(Object.fromEntries(requested.searchParams)).toEqual({
      reason: 'SPAM_BURST',
      activeOnly: 'false',
      page: '1',
      pageSize: '10',
    })
    expect(result.isError).toBeFalsy()
    const body = JSON.parse(textOf(result))
    expect(body.flags[0].profile).toEqual({ id: 'p1', publicName: 'Kornél' })
    expect(body.total).toBe(1)
    await client.close()
  })

  it('joins segments for search_profiles', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, profiles: [], total: 0 }))
    const client = await connect(url)
    await client.callTool({
      name: 'search_profiles',
      arguments: { segments: ['new', 'frequent'], country: 'HU' },
    })
    const requested = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requested.pathname).toBe('/api/admin/profiles')
    expect(requested.searchParams.get('segments')).toBe('new,frequent')
    expect(requested.searchParams.get('country')).toBe('HU')
    await client.close()
  })

  it('url-encodes ids in path parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, profile: { id: 'a/b' } }))
    const client = await connect(url)
    await client.callTool({ name: 'get_profile', arguments: { profileId: 'a/b' } })
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://backend:3000/api/admin/profiles/a%2Fb')
    await client.close()
  })

  it('returns an MCP tool error when the admin API fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, message: 'User not found' }, 404))
    const client = await connect(url)
    const result = await client.callTool({ name: 'get_user', arguments: { userId: 'nope' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Admin API 404: User not found')
    await client.close()
  })

  it('rejects invalid tool arguments without calling the admin API', async () => {
    const client = await connect(url)
    const result = await client.callTool({
      name: 'get_activity_breakdown',
      arguments: { range: '30d' },
    })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    await client.close()
  })
})

describe('MCP server with EXPOSE_CONTACT_PII=true', () => {
  it('passes contact fields through', async () => {
    const { httpServer, url } = await startServer(
      loadConfig({
        ADMIN_API_URL: 'http://backend:3000/api/admin',
        MCP_AUTH_TOKEN: TOKEN,
        HOST: '127.0.0.1',
        EXPOSE_CONTACT_PII: 'true',
      })
    )
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, user: { id: 'u1', email: 'me@example.org' } })
    )
    const client = await connect(url)
    const result = await client.callTool({ name: 'get_user', arguments: { userId: 'u1' } })
    expect(JSON.parse(textOf(result)).user.email).toBe('me@example.org')
    await client.close()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })
})

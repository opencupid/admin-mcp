import { describe, expect, it, vi } from 'vitest'
import { AdminApiError, AdminClient } from '../adminClient.js'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('AdminClient', () => {
  it('sends a GET with the admin header and query params, and strips success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, flags: [], total: 0 }))
    const client = new AdminClient({
      baseUrl: 'http://backend:3000/api/admin/',
      timeoutMs: 1000,
      fetch: fetchMock,
    })

    const data = await client.get('/trust-flags', {
      reason: 'SPAM_BURST',
      activeOnly: false,
      page: 2,
      search: '',
      skipped: undefined,
    })

    expect(data).toEqual({ flags: [], total: 0 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://backend:3000/api/admin/trust-flags?reason=SPAM_BURST&activeOnly=false&page=2'
    )
    expect(init.method).toBe('GET')
    expect(init.headers['X-Admin-Authenticated']).toBe('true')
  })

  it('throws AdminApiError with the backend message on error status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, message: 'Profile not found' }, 404))
    const client = new AdminClient({ baseUrl: 'http://b', timeoutMs: 1000, fetch: fetchMock })

    const err = await client.get('/profiles/x').catch((e) => e)
    expect(err).toBeInstanceOf(AdminApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Admin API 404: Profile not found')
  })

  it('wraps network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = new AdminClient({ baseUrl: 'http://b', timeoutMs: 1000, fetch: fetchMock })
    await expect(client.get('/stats')).rejects.toThrow('Admin API unreachable: ECONNREFUSED')
  })

  it('throws on a non-JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }))
    const client = new AdminClient({ baseUrl: 'http://b', timeoutMs: 1000, fetch: fetchMock })
    await expect(client.get('/stats')).rejects.toBeInstanceOf(AdminApiError)
  })
})

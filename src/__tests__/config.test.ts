import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'

const base = {
  ADMIN_API_URL: 'http://backend:3000/api/admin',
  MCP_AUTH_TOKEN: 'x'.repeat(32),
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(base)
    expect(config).toMatchObject({
      PORT: 8080,
      HOST: '0.0.0.0',
      MCP_ALLOWED_HOSTS: [],
      EXPOSE_CONTACT_PII: false,
      ADMIN_API_TIMEOUT_MS: 15_000,
    })
  })

  it('parses flags and lists', () => {
    const config = loadConfig({
      ...base,
      PORT: '9000',
      EXPOSE_CONTACT_PII: 'true',
      MCP_ALLOWED_HOSTS: 'mcp.example.org, localhost',
    })
    expect(config.PORT).toBe(9000)
    expect(config.EXPOSE_CONTACT_PII).toBe(true)
    expect(config.MCP_ALLOWED_HOSTS).toEqual(['mcp.example.org', 'localhost'])
  })

  it('rejects a short token', () => {
    expect(() => loadConfig({ ...base, MCP_AUTH_TOKEN: 'short' })).toThrow(/MCP_AUTH_TOKEN/)
  })

  it('requires ADMIN_API_URL', () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: base.MCP_AUTH_TOKEN })).toThrow(/ADMIN_API_URL/)
  })

  it('rejects invalid boolean flags', () => {
    expect(() => loadConfig({ ...base, EXPOSE_CONTACT_PII: 'yes' })).toThrow(/EXPOSE_CONTACT_PII/)
  })
})

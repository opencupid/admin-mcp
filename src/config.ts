import { z } from 'zod'

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true')

const ConfigSchema = z.object({
  /** Base URL of the backend admin API, e.g. http://backend:3000/api/admin */
  ADMIN_API_URL: z.url(),
  /** Bearer token MCP clients must present in the Authorization header. */
  MCP_AUTH_TOKEN: z.string().min(32, 'MCP_AUTH_TOKEN must be at least 32 characters'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  /**
   * Comma-separated hostnames accepted in the Host header (DNS rebinding
   * protection). Empty disables the check, e.g. when Traefik already pins the
   * Host via its router rule.
   */
  MCP_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    ),
  /** Include email / phone number fields in tool output. */
  EXPOSE_CONTACT_PII: booleanFlag,
  /** Timeout for upstream admin API requests, in milliseconds. */
  ADMIN_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

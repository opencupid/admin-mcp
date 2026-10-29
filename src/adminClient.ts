export type QueryValue = string | number | boolean | undefined

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

export interface AdminClientOptions {
  baseUrl: string
  timeoutMs: number
  fetch?: typeof fetch
}

/**
 * Minimal read-only client for the OpenCupid backend admin API. Only issues
 * GET requests. Authenticates with the same trusted header Traefik injects on
 * the mTLS-gated admin router, so this service must only ever reach the
 * backend over the internal network.
 */
export class AdminClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: AdminClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs
    this.fetchImpl = opts.fetch ?? fetch
  }

  async get<T = Record<string, unknown>>(
    path: string,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Admin-Authenticated': 'true' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new AdminApiError(`Admin API unreachable: ${(err as Error).message}`)
    }

    const body = (await res.json().catch(() => null)) as
      ({ success?: boolean; message?: string } & Record<string, unknown>) | null

    if (!res.ok || !body || body.success === false) {
      const message = body?.message ?? res.statusText
      throw new AdminApiError(`Admin API ${res.status}: ${message}`, res.status)
    }

    const { success: _success, ...data } = body
    return data as T
  }
}

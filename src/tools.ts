import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { AdminApiError, type AdminClient, type QueryValue } from './adminClient.js'
import { redactContactPii } from './redact.js'

export interface ToolContext {
  client: AdminClient
  exposeContactPii: boolean
}

const page = z.number().int().min(1).default(1).describe('1-based page number')
const pageSize = z.number().int().min(1).max(100).default(25).describe('Results per page (max 100)')
const id = (what: string) => z.string().min(1).max(64).describe(`${what} id (cuid)`)

const TrustReason = z.enum(['PROFILE_UNVETTED', 'SPAM_BURST'])
const ActivitySegment = z.enum(['new', 'frequent', 'returning', 'dormant'])

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

type Shape = z.ZodRawShape

interface ToolDef<S extends Shape> {
  name: string
  title: string
  description: string
  input: S
  /** Maps validated tool input to an admin API GET request. */
  request: (args: z.infer<z.ZodObject<S>>) => { path: string; query?: Record<string, QueryValue> }
}

const def = <S extends Shape>(d: ToolDef<S>) => d

export const TOOLS = [
  // ---- KPIs ----
  def({
    name: 'get_kpi_summary',
    title: 'KPI summary',
    description:
      'Current headline KPIs: active profiles, signups in the last 7 days, total blocked users, ' +
      'total reported profiles, and the distribution of profiles across activity segments ' +
      '(new, frequent, returning, dormant).',
    input: {},
    request: () => ({ path: '/stats' }),
  }),
  def({
    name: 'get_daily_kpis',
    title: 'Daily KPIs (last 7 days)',
    description:
      'Zero-filled daily counts (UTC dates) for the last 7 days: signups, daily active ' +
      '(profiles last seen that day), blocked users, reported profiles, interactions (first ' +
      'like between a pair), matches (mutual likes) and messages. System/admin messages are ' +
      'excluded. Blocked/reported days are approximated by the row updatedAt timestamp.',
    input: {},
    request: () => ({ path: '/stats/daily' }),
  }),
  def({
    name: 'get_activity_breakdown',
    title: 'Activity breakdown',
    description:
      'Time-bucketed series for a metric. "interactions" returns likes, anonymous likes and ' +
      'matches; "messages" returns messages sent and new conversations (system sender ' +
      'excluded). 24h/72h are bucketed hourly, 7d daily; buckets are UTC-aligned and ' +
      'zero-filled.',
    input: {
      metric: z.enum(['interactions', 'messages']).default('interactions'),
      range: z.enum(['24h', '72h', '7d']).default('72h'),
    },
    request: ({ metric, range }) => ({ path: '/stats/breakdown', query: { metric, range } }),
  }),

  // ---- Moderation ----
  def({
    name: 'list_trust_flags',
    title: 'Moderation queue',
    description:
      'Lists profile trust flags from the moderation queue, newest first. Each flag has the ' +
      'profile (id, publicName, country, cityName), reason (PROFILE_UNVETTED: new profile ' +
      'awaiting vetting; SPAM_BURST: automated spam detection), flaggedBy (e.g. ' +
      'system:profile_create, admin:manual), flaggedAt, evidence, and clearedAt/clearedBy ' +
      'once resolved. A profile with an active flag is quarantined (its outbound messages are ' +
      'held). By default only active (uncleared) flags are returned.',
    input: {
      reason: TrustReason.optional().describe('Only flags with this reason'),
      includeCleared: z.boolean().default(false).describe('Also return already-cleared flags'),
      page,
      pageSize,
    },
    request: ({ reason, includeCleared, page, pageSize }) => ({
      path: '/trust-flags',
      query: { reason, activeOnly: !includeCleared, page, pageSize },
    }),
  }),
  def({
    name: 'get_profile',
    title: 'Profile detail',
    description:
      'Full admin view of one profile: profile fields, owning user status (active/blocked, ' +
      'roles), images, active trust flags and hasActiveTrustFlag.',
    input: { profileId: id('Profile') },
    request: ({ profileId }) => ({ path: `/profiles/${encodeURIComponent(profileId)}` }),
  }),
  def({
    name: 'search_profiles',
    title: 'Search profiles',
    description:
      'Paginated profile list, newest first. Each row includes activity segment, ' +
      'active/reported/blocked/onboarded status and hasActiveTrustFlag. `search` matches ' +
      'public name, city, country, profile id, user id, email or phone number.',
    input: {
      search: z.string().max(200).optional(),
      country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code'),
      segments: z.array(ActivitySegment).optional().describe('Only profiles in these segments'),
      page,
      pageSize,
    },
    request: ({ search, country, segments, page, pageSize }) => ({
      path: '/profiles',
      query: { search, country, segments: segments?.join(','), page, pageSize },
    }),
  }),
  def({
    name: 'get_user',
    title: 'User detail',
    description:
      'Admin view of one user account: status flags, roles, language, origin domain, ' +
      'notification settings, lastSeenAt and a summary of the linked profile.',
    input: { userId: id('User') },
    request: ({ userId }) => ({ path: `/users/${encodeURIComponent(userId)}` }),
  }),
  def({
    name: 'search_users',
    title: 'Search users',
    description:
      'Paginated user account list, newest first. `search` matches user id, email or phone ' +
      'number. Set hasProfile=false to find signups that never completed onboarding.',
    input: {
      search: z.string().max(200).optional(),
      hasProfile: z.boolean().optional(),
      page,
      pageSize,
    },
    request: ({ search, hasProfile, page, pageSize }) => ({
      path: '/users',
      query: { search, hasProfile, page, pageSize },
    }),
  }),

  // ---- Lookups ----
  def({
    name: 'list_profile_countries',
    title: 'Profile countries',
    description: 'Distinct country codes present across all profiles.',
    input: {},
    request: () => ({ path: '/profiles/countries' }),
  }),
  def({
    name: 'list_user_origins',
    title: 'User origin domains',
    description: 'Distinct brand domains users signed up from.',
    input: {},
    request: () => ({ path: '/users/origins' }),
  }),
  def({
    name: 'list_tags',
    title: 'Interest tags',
    description:
      'Paginated interest tags ordered by number of profiles using them, with translations ' +
      'and profile counts. `search` matches name, slug or any translation.',
    input: {
      search: z.string().max(200).optional(),
      userSubmitted: z.boolean().optional().describe('Only user-created (true) or curated (false)'),
      page,
      pageSize,
    },
    request: ({ search, userSubmitted, page, pageSize }) => ({
      path: '/tags',
      query: { search, userSubmitted, page, pageSize },
    }),
  }),
]

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of TOOLS as ToolDef<Shape>[]) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { title: tool.title, ...READ_ONLY },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const { path, query } = tool.request(args as z.infer<z.ZodObject<Shape>>)
          const data = await ctx.client.get(path, query)
          const output = ctx.exposeContactPii ? data : redactContactPii(data)
          return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] }
        } catch (err) {
          if (err instanceof AdminApiError) return errorResult(err.message)
          throw err
        }
      }
    )
  }
}

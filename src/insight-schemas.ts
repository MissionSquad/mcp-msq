import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

/** The time window shared by every usage read. Either `last`, or both `start` and `end`. */
const rangeFields = {
  last: z.string().regex(/^\d{1,5}[smhd]$/, 'Use a number followed by s, m, h or d, for example "24h" or "30d".').optional().describe(
    'Look-back window ending now: a number followed by s, m, h or d, for example "24h", "7d" or "30d". '
    + 'Defaults to "30d" when neither last nor start/end is given. Ignored when start and end are given.'
  ),
  start: z.string().datetime({ offset: true, message: 'Use an ISO 8601 timestamp such as 2026-11-01T00:00:00Z.' }).optional().describe(
    'Start of the window, inclusive, as an ISO 8601 timestamp such as "2026-11-01T00:00:00Z". Requires end.'
  ),
  end: z.string().datetime({ offset: true, message: 'Use an ISO 8601 timestamp such as 2026-12-01T00:00:00Z.' }).optional().describe(
    'End of the window, exclusive, as an ISO 8601 timestamp. Requires start and must be later than it.'
  ),
}

const filterFields = {
  modelName: NonEmptyString.optional().describe(
    'Only this provider model id (for example "gpt-5.4"), exactly as usage rows report it in modelName.'
  ),
  source: NonEmptyString.optional().describe(
    'Only calls from this origin, matched exactly, for example "scheduled-run" or "x402-paid". Omit for every origin.'
  ),
}

type RangeArgs = { last?: string; start?: string; end?: string }

function requireWholeRange<T extends RangeArgs>(args: T, context: z.RefinementCtx): void {
  if ((args.start === undefined) !== (args.end === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [args.start === undefined ? 'start' : 'end'],
      message: 'Give both start and end, or neither and use last.',
    })
    return
  }
  if (args.start !== undefined && args.end !== undefined && !(Date.parse(args.end) > Date.parse(args.start))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'end must be later than start.' })
  }
}

export const DEFAULT_USAGE_WINDOW = '30d'

/** The API query for a validated window. */
export function rangeQuery(args: RangeArgs): { last?: string; start?: string; end?: string } {
  return args.start !== undefined && args.end !== undefined
    ? { start: args.start, end: args.end }
    : { last: args.last ?? DEFAULT_USAGE_WINDOW }
}

export const UsageSummarySchema = z.object({
  ...rangeFields,
  ...filterFields,
  includeAgents: z.boolean().optional().describe(
    'Set false to count only direct model calls and leave out calls made by agents. Agents are included by default.'
  ),
}).superRefine(requireWholeRange)

export const UsageByModelSchema = UsageSummarySchema

export const UsageByAgentSchema = z.object({
  ...rangeFields,
  ...filterFields,
  agentName: NonEmptyString.optional().describe('Only this agent, by exact name.'),
}).superRefine(requireWholeRange)

export const UsageTimeseriesSchema = z.object({
  ...rangeFields,
  ...filterFields,
  interval: z.enum(['hour', 'day', 'month']).default('day').describe(
    'Bucket size. Buckets are in UTC. Use "hour" only for windows of a few days to keep the result small.'
  ),
}).superRefine(requireWholeRange)

export const UsageBillingSchema = z.object({
  ...rangeFields,
  ...filterFields,
  groupBy: z.enum(['model', 'model:day', 'model:month']).default('model').describe(
    '"model" gives one row per model; "model:day" and "model:month" add a UTC time bucket per row.'
  ),
}).superRefine(requireWholeRange)

export const ModelPricingSchema = z.object({
  models: z.array(z.object({
    providerKey: NonEmptyString.describe('Provider key of the model, as msq_get_core_config_summary reports it (for example "openai").'),
    model: NonEmptyString.describe('Provider model id, for example "gpt-5.4". Not the display name and not the MissionSquad model id.'),
  })).min(1).max(200).describe('Provider and model pairs to price, 1 to 200.'),
})

export const BuiltinModelUsageSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month as YYYY-MM, for example "2026-11".').optional().describe(
    'UTC month as YYYY-MM. Defaults to the current month.'
  ),
})

export const UsageRecommendationsSchema = z.object({
  last: z.string().regex(/^([1-9]|[1-8]\d|90)d$/, 'Use a number of days from 1d to 90d, for example "30d".').default('30d').describe(
    'How many days of history to analyse, from "1d" to "90d". Defaults to "30d".'
  ),
})

export const UsageBudgetSetSchema = z.object({
  monthlyLimitUsd: z.number().positive().max(1_000_000_000).describe(
    'Monthly spend limit in US dollars, greater than 0. The month is the UTC calendar month.'
  ),
  alertThresholdsPct: z.array(z.number().int().min(1).max(500)).min(1).max(10).optional().describe(
    'Percentages of the limit at which to alert, each a whole number from 1 to 500. Defaults to [50, 80, 100].'
  ),
  notifyEmail: z.boolean().optional().describe('Send alerts to the account email address. Defaults to true.'),
  webhookUrl: z.string().url().startsWith('https://', 'Use an https URL.').nullable().optional().describe(
    'Public https URL that receives a JSON POST for each alert. null or omitted means no webhook.'
  ),
  webhookSecret: z.string().min(16).max(256).nullable().optional().describe(
    'Secret used to sign webhook bodies (x-msq-signature: sha256=HMAC). Omit to keep the stored secret, null to remove it. '
    + 'Only valid together with webhookUrl. It is never returned.'
  ),
  enabled: z.boolean().optional().describe('Set false to keep the budget but stop checking it. Defaults to true.'),
}).superRefine((args, context) => {
  if (typeof args.webhookSecret === 'string' && typeof args.webhookUrl !== 'string') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['webhookSecret'], message: 'webhookSecret needs a webhookUrl in the same call.' })
  }
})

export const UsageBudgetAlertsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25).describe('Maximum number of alerts to return, newest first. Defaults to 25.'),
  offset: z.number().int().min(0).max(1_000_000).default(0).describe('Zero-based offset into the alert history. Defaults to 0.'),
})

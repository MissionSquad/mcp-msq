import { z } from 'zod'
import { defineTool } from './tool-definition.js'
import {
  BuiltinModelUsageSchema, ModelPricingSchema, rangeQuery, UsageBillingSchema, UsageBudgetAlertsSchema,
  UsageBudgetSetSchema, UsageByAgentSchema, UsageByModelSchema, UsageRecommendationsSchema, UsageSummarySchema,
  UsageTimeseriesSchema,
} from './insight-schemas.js'

const COST_FIELDS =
  'cost.amountUsd is provider cost in US dollars and is null when nothing in the group could be priced; '
  + 'cost.unpricedCalls counts calls with no price on record, which the amount leaves out. Never report a null cost as $0. '
  + 'revenueUsd is income from paid agents, not a cost.'

const WINDOW = 'Window: last (default "30d") or both start and end.'

/**
 * Account usage, pricing, recommendations and the monthly usage budget. Every tool reads or changes
 * only the account that owns the API key.
 */
export const insightTools = [
  defineTool({
    name: 'msq_get_usage_summary',
    description:
      'Start here for "how much am I spending". Returns one total for the window: callCount, inputTokens, outputTokens, '
      + `totalTokens, errorCount (failed model calls), durationMsAvg, durationMsTotal and cost. ${COST_FIELDS} ${WINDOW} `
      + 'Read-only. Break the total down with msq_get_usage_by_agent or msq_get_usage_by_model.',
    parameters: UsageSummarySchema,
    run: (client, args) => client.requestJson({
      method: 'GET',
      path: 'core/usage/summary',
      query: { ...rangeQuery(args), modelName: args.modelName, source: args.source, includeAgents: args.includeAgents },
    }),
  }),
  defineTool({
    name: 'msq_get_usage_by_model',
    description:
      'Usage per provider model for the window, sorted by modelName: callCount, tokens, errorCount, durationMsTotal and cost per '
      + `model. Use it to find the models that cost the most or fail the most. ${COST_FIELDS} ${WINDOW} Read-only.`,
    parameters: UsageByModelSchema,
    run: (client, args) => client.requestJson({
      method: 'GET',
      path: 'core/usage/models',
      query: { ...rangeQuery(args), modelName: args.modelName, source: args.source, includeAgents: args.includeAgents },
    }),
  }),
  defineTool({
    name: 'msq_get_usage_by_agent',
    description:
      'Usage per agent for the window: one row per agentName and the provider model it called (modelName), with callCount, tokens and '
      + `cost. Covers calls an agent made from chat, workflows, factories, schedules and pages. Rows have no errorCount. ${COST_FIELDS} `
      + `${WINDOW} Read-only.`,
    parameters: UsageByAgentSchema,
    run: (client, args) => client.requestJson({
      method: 'GET',
      path: 'core/usage/by-agent',
      query: { ...rangeQuery(args), modelName: args.modelName, source: args.source, agentName: args.agentName },
    }),
  }),
  defineTool({
    name: 'msq_get_usage_timeseries',
    description:
      'Usage over time for the window in UTC buckets (interval hour, day or month; default day): bucketStartMs, callCount, tokens, '
      + `errorCount, durationMsTotal and cost per bucket, oldest first. Buckets with no usage are absent, not zero rows. ${COST_FIELDS} `
      + `${WINDOW} Read-only.`,
    parameters: UsageTimeseriesSchema,
    run: (client, args) => client.requestJson({
      method: 'GET',
      path: 'core/usage/timeseries',
      query: { ...rangeQuery(args), modelName: args.modelName, source: args.source, interval: args.interval },
    }),
  }),
  defineTool({
    name: 'msq_get_usage_billing',
    description:
      'Cost per model for the window, optionally split by UTC day or month (groupBy "model", "model:day" or "model:month"). Rows carry '
      + `callCount, tokens, cost and, when split, bucketStartMs. Use it for a cost table or a month-by-month comparison. ${COST_FIELDS} `
      + `${WINDOW} Read-only.`,
    parameters: UsageBillingSchema,
    run: (client, args) => client.requestJson({
      method: 'GET',
      path: 'core/usage/billing',
      query: { ...rangeQuery(args), modelName: args.modelName, source: args.source, groupBy: args.groupBy },
    }),
  }),
  defineTool({
    name: 'msq_get_model_pricing',
    description:
      'Look up list prices for up to 200 provider/model pairs. Each result has found and, when found, record.rates: amounts in US '
      + 'dollars per one million tokens by component (input, cached_input, output, cache writes) and tier, with any prompt-size '
      + 'condition and effective dates. found=false means the platform has no price for that model, not that it is free. Quote '
      + 'prices from this tool, never from memory. Read-only.',
    parameters: ModelPricingSchema,
    run: (client, args) => client.requestJson({ method: 'POST', path: 'core/pricing/query', body: { models: args.models } }),
  }),
  defineTool({
    name: 'msq_get_builtin_model_usage',
    description:
      'Monthly token allowance for the built-in Mission Squad models: per model, monthlyTokenLimit, usedTokens, remainingTokens and '
      + 'status (unlimited, available, limit_reached or usage_unresolved) for one UTC month (default: the current month). Models the '
      + 'account added with its own provider key have no allowance and are not listed. Read-only.',
    parameters: BuiltinModelUsageSchema,
    run: (client, args) => client.requestJson({ method: 'GET', path: 'core/builtin-provider/usage', query: { month: args.month } }),
  }),
  defineTool({
    name: 'msq_get_usage_recommendations',
    description:
      'Analyse the last 1 to 90 days (default 30d) and return ranked recommendations: cheaper_model (an agent whose token volume would '
      + 'cost at least 30% less on another configured model, with estimatedMonthlySavingsUsd), high_error_rate (a model failing 10% or '
      + 'more of calls), failing_tool, unused_agent and unpriced_usage. Each has severity, title, detail, action and evidence numbers; '
      + 'data.notes lists the limits of the analysis and data.totals the window totals. cheaper_model compares list prices only, not '
      + 'answer quality: do not change an agent\'s model from it without an eval and the user\'s approval. Read-only.',
    parameters: UsageRecommendationsSchema,
    run: (client, args) => client.requestJson({ method: 'GET', path: 'core/usage/recommendations', query: { last: args.last } }),
  }),
  defineTool({
    name: 'msq_get_usage_budget',
    description:
      'Read the account\'s monthly usage budget and month-to-date spend: data.budget (null when none is set; otherwise monthlyLimitUsd, '
      + 'alertThresholdsPct, notifyEmail, webhookUrl, hasWebhookSecret, enabled), period (UTC month), spendUsd, percentUsed, '
      + 'unpricedCalls and emailAvailable (false when this deployment cannot send email alerts). The budget only sends alerts; it never '
      + 'stops agents. Read-only.',
    parameters: z.object({}),
    run: client => client.requestJson({ method: 'GET', path: 'core/usage/budget' }),
  }),
  defineTool({
    name: 'msq_set_usage_budget',
    description:
      'Create or replace the account\'s monthly usage budget. This replaces the whole budget, so read the current one with '
      + 'msq_get_usage_budget first and pass every value you want to keep; an omitted webhookUrl removes the webhook, while an omitted '
      + 'webhookSecret keeps the stored one. Alerts go out the first time month-to-date spend reaches each alertThresholdsPct, by email '
      + 'and/or a JSON POST to webhookUrl (public https only). It only alerts: agents keep running past the limit. Returns the same '
      + 'shape as msq_get_usage_budget. Confirm the limit, thresholds and channels with the user before calling.',
    parameters: UsageBudgetSetSchema,
    run: (client, args) => client.requestJson({ method: 'PUT', path: 'core/usage/budget', body: args }),
  }),
  defineTool({
    name: 'msq_delete_usage_budget',
    description:
      'Remove the account\'s monthly usage budget so no further alerts are sent. The history of alerts already sent is kept. Fails with '
      + '404 when no budget is set. To pause alerts without losing the settings, use msq_set_usage_budget with enabled=false instead.',
    parameters: z.object({}),
    run: client => client.requestJson({ method: 'DELETE', path: 'core/usage/budget' }),
  }),
  defineTool({
    name: 'msq_test_usage_budget',
    description:
      'Send a clearly labelled test alert through the budget\'s configured channels so the user can confirm their email and webhook '
      + 'work. Returns data.email and data.webhook, each "sent", "failed" or "skipped" (skipped means that channel is off or '
      + 'unavailable). Report those values as returned. Sends a real email and a real webhook request; records no alert. Fails with 404 '
      + 'when no budget is set and with 429 when a test was sent for this account in the last minute.',
    parameters: z.object({}),
    run: client => client.requestJson({ method: 'POST', path: 'core/usage/budget/test' }),
  }),
  defineTool({
    name: 'msq_list_usage_budget_alerts',
    description:
      'List the budget thresholds that have fired, newest first: period (UTC month), thresholdPct, limitUsd, spendUsd at the time, and '
      + 'the delivery result for email and webhook: "sent", "failed", "skipped" (channel off or unavailable) or "pending" (the alert '
      + 'was claimed but its outcome was never recorded, so it is unknown whether it went out). An entry with supersededBy was reached '
      + 'in the same check as a higher threshold, which carried the notification. limit/offset paginate. Read-only.',
    parameters: UsageBudgetAlertsSchema,
    run: (client, args) => client.requestJson({
      method: 'GET', path: 'core/usage/budget/alerts', query: { limit: args.limit, offset: args.offset },
    }),
  }),
] as const

import type { FastMCP } from '@missionsquad/fastmcp'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMissionSquadTools } from '../src/tools.js'
import { insightTools } from '../src/insight-tools.js'

interface RegisteredTool {
  name: string
  parameters: z.ZodTypeAny
  execute: (args: unknown, context: { extraArgs?: Record<string, unknown> }) => Promise<string>
}
class FakeServer {
  tools = new Map<string, RegisteredTool>()
  addTool(tool: RegisteredTool) { this.tools.set(tool.name, tool) }
}
const context = { extraArgs: { apiKey: 'isolated-mcp-insight-test-key', baseUrl: 'https://api.missionsquad.invalid/v1' } }
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('usage insight MCP tools', () => {
  let server: FakeServer
  let fetchMock: ReturnType<typeof vi.fn>
  // Arguments reach execute unparsed, as FastMCP delivers them for tools with deferred validation.
  async function call(name: string, args: unknown = {}) {
    return JSON.parse(await server.tools.get(name)!.execute(args, context))
  }
  function lastRequest() {
    const [url, init] = fetchMock.mock.calls[0]
    return { url: new URL(url), init }
  }
  beforeEach(() => {
    server = new FakeServer()
    registerMissionSquadTools(server as unknown as FastMCP<undefined>)
    fetchMock = vi.fn().mockImplementation(async () => response({ success: true, data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('advertises an object schema and a substantial description for every tool, without credentials', () => {
    expect(insightTools).toHaveLength(13)
    for (const tool of insightTools) {
      const advertised = zodToJsonSchema(tool.parameters)
      expect(advertised).toMatchObject({ type: 'object' })
      expect(JSON.stringify(advertised)).not.toContain('apiKey')
      expect(tool.description.length).toBeGreaterThan(100)
      expect(server.tools.has(tool.name)).toBe(true)
    }
  })

  it.each([
    ['msq_get_usage_summary', {}, 'GET', 'core/usage/summary?last=30d'],
    ['msq_get_usage_summary', { last: '24h', modelName: 'gpt-5.4', source: 'scheduled-run', includeAgents: false }, 'GET',
      'core/usage/summary?last=24h&modelName=gpt-5.4&source=scheduled-run&includeAgents=false'],
    ['msq_get_usage_by_model', { last: '7d' }, 'GET', 'core/usage/models?last=7d'],
    ['msq_get_usage_by_agent', { agentName: 'Research Lead' }, 'GET', 'core/usage/by-agent?last=30d&agentName=Research+Lead'],
    ['msq_get_usage_timeseries', {}, 'GET', 'core/usage/timeseries?last=30d&interval=day'],
    ['msq_get_usage_timeseries', { last: '48h', interval: 'hour' }, 'GET', 'core/usage/timeseries?last=48h&interval=hour'],
    ['msq_get_usage_billing', {}, 'GET', 'core/usage/billing?last=30d&groupBy=model'],
    ['msq_get_usage_billing', { groupBy: 'model:month', last: '90d' }, 'GET', 'core/usage/billing?last=90d&groupBy=model%3Amonth'],
    ['msq_get_builtin_model_usage', {}, 'GET', 'core/builtin-provider/usage'],
    ['msq_get_builtin_model_usage', { month: '2026-11' }, 'GET', 'core/builtin-provider/usage?month=2026-11'],
    ['msq_get_usage_recommendations', {}, 'GET', 'core/usage/recommendations?last=30d'],
    ['msq_get_usage_recommendations', { last: '90d' }, 'GET', 'core/usage/recommendations?last=90d'],
    ['msq_get_usage_budget', {}, 'GET', 'core/usage/budget'],
    ['msq_delete_usage_budget', {}, 'DELETE', 'core/usage/budget'],
    ['msq_test_usage_budget', {}, 'POST', 'core/usage/budget/test'],
    ['msq_list_usage_budget_alerts', {}, 'GET', 'core/usage/budget/alerts?limit=25&offset=0'],
    ['msq_list_usage_budget_alerts', { limit: 5, offset: 10 }, 'GET', 'core/usage/budget/alerts?limit=5&offset=10'],
  ])('routes %s %j through the authenticated API', async (name, args, method, path) => {
    await call(String(name), args)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = lastRequest()
    const expected = new URL(`https://api.missionsquad.invalid/v1/${path}`)
    expect(url.pathname).toBe(expected.pathname)
    expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(expected.searchParams))
    expect(init.method).toBe(method)
    expect(init.headers['x-api-key']).toBe(context.extraArgs.apiKey)
    expect(init.body).toBeUndefined()
  })

  it('sends an explicit start/end window instead of last', async () => {
    await call('msq_get_usage_by_model', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', last: '7d' })
    expect(Object.fromEntries(lastRequest().url.searchParams)).toEqual({ start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' })
  })

  it('posts pricing lookups and budget settings as JSON bodies', async () => {
    const models = [{ providerKey: 'openai', model: 'gpt-5.4' }, { providerKey: 'google', model: 'gemini-flash-latest' }]
    await call('msq_get_model_pricing', { models })
    let { url, init } = lastRequest()
    expect(url.pathname).toBe('/v1/core/pricing/query')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ models })

    fetchMock.mockClear()
    const budget = { monthlyLimitUsd: 250, alertThresholdsPct: [50, 90], webhookUrl: 'https://hooks.example.com/budget', webhookSecret: null }
    await call('msq_set_usage_budget', budget)
    ;({ url, init } = lastRequest())
    expect(url.pathname).toBe('/v1/core/usage/budget')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual(budget)
  })

  it('returns the API payload unchanged as compact JSON', async () => {
    const payload = { success: true, data: { cost: { amountUsd: null, pricedCalls: 0, unpricedCalls: 3 }, callCount: 3 } }
    fetchMock.mockResolvedValueOnce(response(payload))
    const text = await server.tools.get('msq_get_usage_summary')!.execute({}, context)
    expect(text).toBe(JSON.stringify(payload))
  })

  it.each([
    ['msq_get_usage_summary', { last: '30 days' }, 'last'],
    ['msq_get_usage_summary', { start: '2026-11-01T00:00:00Z' }, 'end'],
    ['msq_get_usage_summary', { start: '2026-11-02T00:00:00Z', end: '2026-11-01T00:00:00Z' }, 'end'],
    ['msq_get_usage_summary', { start: 'yesterday', end: 'today' }, 'start'],
    ['msq_get_usage_timeseries', { interval: 'week' }, 'interval'],
    ['msq_get_usage_billing', { groupBy: 'agent' }, 'groupBy'],
    ['msq_get_model_pricing', { models: [] }, 'models'],
    ['msq_get_model_pricing', { models: [{ providerKey: 'openai' }] }, 'models[0].model'],
    ['msq_get_builtin_model_usage', { month: '2026-13' }, 'month'],
    ['msq_get_usage_recommendations', { last: '91d' }, 'last'],
    ['msq_get_usage_recommendations', { last: '2w' }, 'last'],
    ['msq_set_usage_budget', {}, 'monthlyLimitUsd'],
    ['msq_set_usage_budget', { monthlyLimitUsd: 0 }, 'monthlyLimitUsd'],
    ['msq_set_usage_budget', { monthlyLimitUsd: 10, alertThresholdsPct: [0] }, 'alertThresholdsPct[0]'],
    ['msq_set_usage_budget', { monthlyLimitUsd: 10, webhookUrl: 'http://example.com/hook' }, 'webhookUrl'],
    ['msq_set_usage_budget', { monthlyLimitUsd: 10, webhookSecret: 'short' }, 'webhookSecret'],
    ['msq_set_usage_budget', { monthlyLimitUsd: 10, webhookSecret: 's'.repeat(32) }, 'webhookSecret'],
    ['msq_set_usage_budget', { monthlyLimitUsd: 2_000_000_000 }, 'monthlyLimitUsd'],
    ['msq_list_usage_budget_alerts', { limit: 101 }, 'limit'],
  ])('rejects %s %j before any request is sent', async (name, args, field) => {
    const failure = await server.tools.get(String(name))!.execute(args, context).then(() => null, (error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    const body = JSON.parse(failure!.message.slice(failure!.message.indexOf('{')))
    expect(body.error).toBe('INVALID_TOOL_ARGUMENTS')
    expect(body.issues.map((issue: { field: string }) => issue.field)).toContain(field)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces an API refusal with its message', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: false, message: 'URL host resolves to a private or reserved address' }, 400))
    await expect(server.tools.get('msq_set_usage_budget')!.execute({ monthlyLimitUsd: 10, webhookUrl: 'https://intranet.example.com/h' }, context))
      .rejects.toThrow('private or reserved address')
  })
})

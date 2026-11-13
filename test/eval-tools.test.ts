import type { FastMCP } from '@missionsquad/fastmcp'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMissionSquadTools } from '../src/tools.js'
import { evalTools } from '../src/eval-tools.js'

interface RegisteredTool {
  name: string
  parameters: z.ZodTypeAny
  execute: (args: unknown, context: { extraArgs?: Record<string, unknown> }) => Promise<string>
}
class FakeServer {
  tools = new Map<string, RegisteredTool>()
  addTool(tool: RegisteredTool) { this.tools.set(tool.name, tool) }
}
const context = { extraArgs: { apiKey: 'isolated-mcp-eval-test-key', baseUrl: 'https://api.missionsquad.invalid/v1' } }
const fingerprint = 'a'.repeat(64)
const definition = {
  name: 'Customer review sentiment',
  systemPrompt: 'Reply with only positive, negative, or neutral.',
  cases: [{ id: 'late-delivery', name: 'Late delivery', input: 'The parcel was a week late.', expected: 'negative' }],
  models: [{ modelId: 'configured-google-model' }],
  checks: [{ id: 'sentiment', type: 'exact', trim: true, required: true }],
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('eval MCP tools', () => {
  let server: FakeServer
  let fetchMock: ReturnType<typeof vi.fn>
  async function call(name: string, args: unknown = {}) {
    const tool = server.tools.get(name)!
    return JSON.parse(await tool.execute(tool.parameters.parse(args), context))
  }
  async function raw(name: string, args: unknown = {}) {
    const tool = server.tools.get(name)!
    return tool.execute(tool.parameters.parse(args), context)
  }
  beforeEach(() => {
    server = new FakeServer()
    registerMissionSquadTools(server as unknown as FastMCP<undefined>)
    fetchMock = vi.fn().mockImplementation(async () => response({ success: true, data: { id: 'saved-eval', revision: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('advertises discoverable JSON object schemas and useful descriptions for every eval tool', () => {
    for (const tool of evalTools) {
      const advertised = zodToJsonSchema(tool.parameters)
      expect(advertised).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(100)
      expect(server.tools.has(tool.name)).toBe(true)
    }
    const advertised = JSON.stringify(zodToJsonSchema(server.tools.get('msq_create_eval')!.parameters))
    for (const field of ['systemPrompt', 'modelId', 'jsonValue', 'maxRounds', 'criteria']) expect(advertised).toContain(field)
    expect(advertised).not.toContain('apiKey')
  })

  it.each([
    ['msq_get_eval_options', {}, 'GET', 'core/evals/options'],
    ['msq_list_evals', { limit: 10, offset: 20 }, 'GET', 'core/evals?limit=10&offset=20'],
    ['msq_get_eval', { suiteId: 'suite/with space' }, 'GET', 'core/evals/suite%2Fwith%20space'],
    ['msq_delete_eval', { suiteId: 'saved-eval' }, 'DELETE', 'core/evals/saved-eval'],
    ['msq_list_eval_runs', {}, 'GET', 'core/eval-runs?limit=25&offset=0'],
    ['msq_get_eval_run', { runId: 'run/with space' }, 'GET', 'core/eval-runs/run%2Fwith%20space'],
    ['msq_list_eval_results', { runId: 'run-1', modelId: 'model/one', caseId: 'late delivery', role: 'target', limit: 5, offset: 10 }, 'GET', 'core/eval-runs/run-1/results?limit=5&offset=10&modelId=model%2Fone&caseId=late+delivery&role=target'],
    ['msq_get_eval_result', { runId: 'run-1', trialId: 'trial/one' }, 'GET', 'core/eval-runs/run-1/results/trial%2Fone'],
    ['msq_cancel_eval_run', { runId: 'run-1' }, 'POST', 'core/eval-runs/run-1/cancel'],
    ['msq_delete_eval_run', { runId: 'run-1' }, 'DELETE', 'core/eval-runs/run-1'],
  ])('routes %s through the authenticated API', async (name, args, method, path) => {
    await call(String(name), args)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const actual = new URL(url)
    const expected = new URL(`https://api.missionsquad.invalid/v1/${path}`)
    expect(actual.pathname).toBe(expected.pathname)
    expect(Object.fromEntries(actual.searchParams)).toEqual(Object.fromEntries(expected.searchParams))
    expect(init.method).toBe(method)
    expect(init.headers['x-api-key']).toBe(context.extraArgs.apiKey)
    expect(init.body).toBeUndefined()
  })

  it('creates a definition with explicit defaults without dispatching a run', async () => {
    await call('msq_create_eval', { definition })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.missionsquad.invalid/v1/core/evals')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).definition).toMatchObject({
      mode: 'compare', sharedSettings: {}, responseMode: 'text',
      cases: [{ tags: [] }], models: [{ overrides: {} }],
      repetitions: 3, concurrency: 4, maxCalls: 5000, maxDurationMs: 3600000,
    })
  })

  it('updates with the revision outside the complete definition', async () => {
    await call('msq_update_eval', { suiteId: 'saved-eval', revision: 3, definition })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url.endsWith('/core/evals/saved-eval')).toBe(true)
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect(body.revision).toBe(3)
    expect(body.suiteId).toBeUndefined()
    expect(body.definition.name).toBe(definition.name)
  })

  it('previews without starting, then forwards the exact reviewed tuple on explicit start', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: true, data: { fingerprint, maximumCalls: 3 } }))
    expect(await call('msq_preview_eval_run', { suiteId: 'saved-eval', revision: 2 })).toMatchObject({ data: { fingerprint } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ suiteId: 'saved-eval', revision: 2 })
    const start = { suiteId: 'saved-eval', revision: 2, fingerprint, idempotencyKey: 'sentiment-baseline-2026-11-07-01' }
    await call('msq_start_eval_run', start)
    await call('msq_start_eval_run', start)
    expect(fetchMock.mock.calls.slice(1).map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
      ['https://api.missionsquad.invalid/v1/core/eval-runs', start],
      ['https://api.missionsquad.invalid/v1/core/eval-runs', start],
    ])
  })

  it.each([409, 410, 422, 429])('preserves API %s guidance and never auto-refreshes/retries', async status => {
    fetchMock.mockResolvedValueOnce(response({ success: false, error: 'Review a new preview before starting.' }, status))
    await expect(call('msq_start_eval_run', { suiteId: 'saved-eval', revision: 1, fingerprint, idempotencyKey: 'sentiment-run-1' })).rejects.toThrow('Review a new preview')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid submissions before making an HTTP request', async () => {
    await expect(call('msq_start_eval_run', { suiteId: 'saved-eval', revision: 1, fingerprint: 'wrong', idempotencyKey: 'run with spaces' })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves result metrics, null costs, variants and evidence without inventing values', async () => {
    const report = { record: { status: 'completed' }, variants: [{ systemPrompt: 'Only JSON.' }], summary: [{ firstOutputMs: { mean: 120 }, costUsd: { mean: null }, json: { checked: 2, passed: 1 } }], spend: { target: { amountUsd: null } }, confirmation: [] }
    fetchMock.mockResolvedValueOnce(response({ success: true, data: report }))
    expect(await call('msq_get_eval_run', { runId: 'run-1', view: 'full' })).toEqual({ success: true, data: report })
  })

  const fullReport = {
    record: {
      id: 'run-1', suiteId: 'suite-1', status: 'completed', phase: 'done', callsStarted: 12, completedTrials: 12,
      createdAt: 1000, startedAt: 2000, completedAt: 62_000,
      plan: {
        maximumCalls: 12, fingerprint, warnings: ['Judge: the judge runs at temperature 0 instead of its saved 0.7.'],
        targets: [{ modelId: 'model-a', name: 'Model A', providerKey: 'openai', model: 'gpt', settings: { maxTokens: 512 }, pricing: { rates: [] } }],
        definition: { name: 'Sentiment', mode: 'compare', primaryMetric: 'judgeScore', repetitions: 3, maxCalls: 100, maxDurationMs: 60_000,
          systemPrompt: 'SECRET SYSTEM PROMPT', cases: [{ id: 'c', name: 'Case', input: 'SECRET CASE INPUT', tags: [] }] },
      },
    },
    variants: [{ id: 'variant-a', modelId: 'model-a', round: 0, systemPrompt: 'SECRET SYSTEM PROMPT', skippedReason: 'Skipped after 3 failed requests in a row.' }],
    summary: [{
      variantId: 'variant-a', modelId: 'model-a', stage: 'baseline', round: 0, trials: 6, completed: 5, graded: 5, passed: 4, passRate: 0.8,
      requestSuccessRate: 5 / 6, costPerPassUsd: 0.002, failedTrials: 1, failureReasons: [{ message: 'The model request did not complete.', count: 1 }],
      judgeScore: { count: 5, mean: 81, median: 80, p90: 95, min: 60, max: 95, standardDeviation: 12 },
      firstOutputMs: { count: 5, mean: 300, median: 280, p90: 400, min: 200, max: 400, standardDeviation: 60 },
      durationMs: { count: 5, mean: 900, median: 850, p90: 1200, min: 700, max: 1200, standardDeviation: 150 },
      inputTokens: { count: 5, mean: 100, median: 100 }, outputTokens: { count: 5, mean: 40, median: 40 },
      totalTokens: { count: 5, mean: 140 }, costUsd: { count: 5, mean: 0.0016 }, outputTokensPerSecond: { count: 5, mean: 44 },
      json: { checked: 0, passed: 0 }, schema: { checked: 0, passed: 0 },
    }],
    spend: { target: { amountUsd: 0.008, pricedCalls: 5, unpricedCalls: 0 }, judge: { amountUsd: 0.02, pricedCalls: 5, unpricedCalls: 0 }, optimizer: { amountUsd: 0, pricedCalls: 0, unpricedCalls: 0 } },
    confirmation: [],
  }

  it('returns a compact run view by default: status, progress, timing, spend and summary rows, never the plan or prompts', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: true, data: fullReport }))
    const text = await raw('msq_get_eval_run', { runId: 'run-1' })
    expect(text).not.toContain('\n')
    expect(text).not.toContain('SECRET')
    expect(JSON.parse(text)).toEqual({ success: true, data: {
      id: 'run-1', suiteId: 'suite-1', status: 'completed', phase: 'done', terminal: true,
      eval: { name: 'Sentiment', mode: 'compare', primaryMetric: 'judgeScore', repetitions: 3 },
      progress: { completedTrials: 12, callsStarted: 12, maximumCalls: 12 },
      timing: { createdAt: 1000, startedAt: 2000, completedAt: 62_000, runTimeMs: 60_000 },
      limits: { maxCalls: 100, maxDurationMs: 60_000 },
      spend: fullReport.spend,
      summary: [{
        variantId: 'variant-a', modelId: 'model-a', model: 'Model A', stage: 'baseline', round: 0, trials: 6, completed: 5, graded: 5, passed: 4,
        passRate: 0.8, requestSuccessRate: 5 / 6, costPerPassUsd: 0.002, failedTrials: 1,
        failureReasons: [{ message: 'The model request did not complete.', count: 1 }],
        judgeScore: { count: 5, mean: 81, median: 80, standardDeviation: 12 }, firstOutputMs: { median: 280 },
        durationMs: { median: 850, p90: 1200 }, inputTokens: { mean: 100 }, outputTokens: { mean: 40 }, costUsd: { count: 5, mean: 0.0016 },
        json: { checked: 0, passed: 0 }, schema: { checked: 0, passed: 0 },
      }],
      skipped: [{ id: 'variant-a', modelId: 'model-a', round: 0, skippedReason: 'Skipped after 3 failed requests in a row.' }],
      warnings: ['Judge: the judge runs at temperature 0 instead of its saved 0.7.'],
    } })
  })

  it('builds a compact view for a run stored before the newer fields existed', async () => {
    const legacy = { record: { id: 'old', status: 'error', phase: 'done', stopReason: 'A selected model changed.', plan: { targets: [], definition: { name: 'Old' } } },
      variants: [], summary: [{ variantId: 'v', modelId: 'm', stage: 'baseline', round: 0, trials: 1, completed: 1, judgeScore: { mean: null } }], spend: {}, confirmation: [] }
    fetchMock.mockResolvedValueOnce(response({ success: true, data: legacy }))
    expect(await call('msq_get_eval_run', { runId: 'old' })).toMatchObject({ success: true, data: {
      id: 'old', status: 'error', terminal: true, stopReason: 'A selected model changed.', eval: { name: 'Old' }, timing: {},
      summary: [{ variantId: 'v', modelId: 'm', judgeScore: { mean: null }, durationMs: {}, costUsd: {} }],
    } })
  })

  it('waits for a run to finish and reports a timeout without failing', async () => {
    vi.useFakeTimers()
    try {
      const running = { success: true, data: { ...fullReport, record: { ...fullReport.record, status: 'running', phase: 'baseline' } } }
      fetchMock.mockResolvedValueOnce(response(running)).mockResolvedValueOnce(response(running)).mockResolvedValueOnce(response({ success: true, data: fullReport }))
      const finished = call('msq_wait_eval_run', { runId: 'run-1' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await finished).toMatchObject({ success: true, data: { status: 'completed', terminal: true, timing: { runTimeMs: 60_000 } } })
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(await finished).not.toHaveProperty('timedOut')

      fetchMock.mockImplementation(async () => response(running))
      const waiting = call('msq_wait_eval_run', { runId: 'run-1', timeoutSeconds: 12 })
      await vi.advanceTimersByTimeAsync(12_000)
      expect(await waiting).toMatchObject({ timedOut: true, next: expect.stringContaining('Still running after 12s'), data: { status: 'running', terminal: false } })
    } finally { vi.useRealTimers() }
  })

  it('re-grades a finished run with a new judge and returns the new run without its plan', async () => {
    const judge = { model: { modelId: 'configured-judge' }, rubric: 'Score the sentiment label.', passScore: 70,
      criteria: [{ id: 'label', description: 'The label is right.', weight: 1 }] }
    fetchMock.mockResolvedValueOnce(response({ success: true, data: { id: 'run-2', status: 'queued', phase: 'grading', kind: 'regrade', parentRunId: 'run-1', plan: { definition: { systemPrompt: 'SECRET' } } } }))
    expect(await call('msq_regrade_eval_run', { runId: 'run-1', judge, idempotencyKey: 'regrade-1' }))
      .toEqual({ success: true, data: { id: 'run-2', status: 'queued', phase: 'grading', kind: 'regrade', parentRunId: 'run-1' } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.missionsquad.invalid/v1/core/eval-runs/run-1/regrade')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ judge: { ...judge, model: { modelId: 'configured-judge', overrides: {} } }, idempotencyKey: 'regrade-1' })
    await expect(call('msq_regrade_eval_run', { runId: 'run-1', idempotencyKey: 'regrade-2' })).rejects.toThrow('Provide a judge, checks, or both')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a short preview unless the full plan is requested', async () => {
    const plan = { fingerprint, suiteId: 'saved-eval', suiteRevision: 2, maximumCalls: 36, developmentCaseIds: ['a', 'b', 'c'], heldOutCaseIds: [],
      warnings: ['Model A: saved temperature is not accepted by this model for eval requests and was left out.'],
      targets: [{ modelId: 'model-a', name: 'Model A', providerKey: 'openai', model: 'gpt', settings: { maxTokens: 512 }, pricing: null }],
      judge: { modelId: 'judge', name: 'Judge', providerKey: 'openai', model: 'gpt', settings: { maxTokens: 8192, temperature: 0 }, pricing: { rates: [] } },
      definition: { name: 'Sentiment', mode: 'compare', primaryMetric: 'passRate', repetitions: 3, maxCalls: 5000, maxDurationMs: 3_600_000,
        systemPrompt: 'SECRET', cases: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }
    fetchMock.mockImplementation(async () => response({ success: true, data: plan }))
    const text = await raw('msq_preview_eval_run', { suiteId: 'saved-eval', revision: 2 })
    expect(text).not.toContain('SECRET')
    expect(JSON.parse(text)).toEqual({ success: true, data: {
      fingerprint, suiteId: 'saved-eval', suiteRevision: 2, maximumCalls: 36, name: 'Sentiment', mode: 'compare', primaryMetric: 'passRate',
      repetitions: 3, maxCalls: 5000, maxDurationMs: 3_600_000, cases: 3, developmentCases: 3, heldOutCases: 0,
      targets: [{ modelId: 'model-a', name: 'Model A', providerKey: 'openai', model: 'gpt', settings: { maxTokens: 512 }, priced: false }],
      judge: { modelId: 'judge', name: 'Judge', providerKey: 'openai', model: 'gpt', settings: { maxTokens: 8192, temperature: 0 }, priced: true },
      warnings: plan.warnings,
    } })
    expect(await call('msq_preview_eval_run', { suiteId: 'saved-eval', revision: 2, includePlan: true })).toEqual({ success: true, data: plan })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ suiteId: 'saved-eval', revision: 2 })
  })

  it('advertises text limits, the max effort and the judge option in the tool schema', () => {
    const advertised = JSON.stringify(zodToJsonSchema(server.tools.get('msq_create_eval')!.parameters))
    for (const fragment of ['"maxLength":8192', '"maxLength":2048', '"maxLength":160', '"maxLength":32768', '"maxLength":1024', '"max"', 'includeSystemPrompt']) {
      expect(advertised).toContain(fragment)
    }
  })

  it('exports JSON objects and CSV text without double-encoding the JSON attachment', async () => {
    const report = { record: { id: 'run-1' }, trials: [{ output: '{"sentiment":"negative"}', rawOutputAvailable: true }] }
    fetchMock.mockResolvedValueOnce(response(report))
    expect(await call('msq_export_eval_run', { runId: 'run-1' })).toEqual(report)
    const csv = 'modelId,passRate\r\nconfigured-google-model,1\r\n'
    fetchMock.mockResolvedValueOnce(new Response(csv, { headers: { 'content-type': 'text/csv' } }))
    // CSV comes back as plain text, not as a JSON-quoted string.
    expect(await raw('msq_export_eval_run', { runId: 'run-1', format: 'csv' })).toBe(csv)
  })

  it('cancels oversized export streams and returns no truncated evidence', async () => {
    let cancelled = false
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(1100))) },
      cancel() { cancelled = true },
    }), { headers: { 'content-type': 'application/json' } }))
    await expect(call('msq_export_eval_run', { runId: 'run-1', maxBytes: 1024 })).rejects.toThrow('msq_list_eval_results')
    expect(cancelled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles invalid export JSON and API errors explicitly', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{broken', { headers: { 'content-type': 'application/json' } }))
    await expect(call('msq_export_eval_run', { runId: 'run-1' })).rejects.toThrow('invalid JSON')
    fetchMock.mockResolvedValueOnce(response({ error: 'Eval run not found.' }, 404))
    await expect(call('msq_export_eval_run', { runId: 'run-1' })).rejects.toThrow('Eval run not found')
  })
})

it('times out a stalled export body after headers arrive', async () => {
  const { MissionSquadClient } = await import('../src/msq-client.js')
  const client = new MissionSquadClient({ apiKey: 'fixture', baseUrl: 'https://api.missionsquad.invalid/v1', httpTimeoutMs: 20, defaultFileContentMaxBytes: 1024 })
  let cancelled = false
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"trials":[')) },
    cancel() { cancelled = true },
  }), { headers: { 'content-type': 'application/json' } })))
  try {
    await expect(client.requestJson({ method: 'GET', path: 'core/eval-runs/run-1/export', maxResponseBytes: 1024 })).rejects.toThrow('response body timed out')
    expect(cancelled).toBe(true)
  } finally { vi.unstubAllGlobals() }
})

it.each([
  ['msq_get_eval', { suiteId: '..' }],
  ['msq_get_eval', { suiteId: 'options' }],
  ['msq_get_eval', { suiteId: 'OPTIONS' }],
  ['msq_get_eval_run', { runId: '.' }],
  ['msq_get_eval_result', { runId: 'run-1', trialId: '..' }],
])('rejects path aliases in %s instead of returning another endpoint', (name, args) => {
  const tool = evalTools.find(tool => tool.name === name)!
  expect(tool.parameters.safeParse(args).success).toBe(false)
})

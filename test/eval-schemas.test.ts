import { describe, expect, it } from 'vitest'
import {
  EvalCreateSchema,
  EvalDefinitionSchema,
  EvalExportSchema,
  EvalResultsSchema,
  EvalStartSchema,
  EvalUpdateSchema,
} from '../src/eval-schemas.js'

const baseline = {
  name: 'Readiness response',
  systemPrompt: 'Return the readiness status.',
  cases: [{ id: 'readiness', name: 'Ready', input: 'Report readiness.' }],
  models: [{ modelId: 'saved-target' }],
  checks: [{ id: 'parse', type: 'json', required: true }],
}

const judge = {
  model: { modelId: 'saved-judge' },
  rubric: 'Score whether the response provides an accurate readiness status.',
  criteria: [{ id: 'accuracy', description: 'The readiness status is accurate.', weight: 100 }],
  passScore: 80,
}

const search = {
  optimizer: { modelId: 'saved-optimizer' },
  tunePrompt: false,
  parameters: { temperature: [0, 0.2] },
  maxRounds: 2,
  minimumImprovement: 2,
  maxQualityRegression: 1,
}

describe('eval MCP schemas', () => {
  it('expands concise compare definitions into the required API fields', () => {
    expect(EvalCreateSchema.parse({
      definition: baseline,
      apiKey: 'session-key',
      baseUrl: 'https://example.test/v1',
    })).toEqual({
      definition: {
        ...baseline,
        mode: 'compare',
        cases: [{ ...baseline.cases[0], tags: [] }],
        models: [{ modelId: 'saved-target', overrides: {} }],
        sharedSettings: {},
        responseMode: 'text',
        primaryMetric: 'passRate',
        repetitions: 3,
        concurrency: 4,
        maxCalls: 5000,
        maxDurationMs: 3_600_000,
        seed: 42,
      },
    })
  })

  it('preserves JSON types, array order, nested objects and null overrides', () => {
    const expected = { status: false, steps: [2, '2', null, { confirmed: true }] }
    const responseSchema = { type: 'object', properties: { status: { type: 'boolean' } } }
    const parsed = EvalDefinitionSchema.parse({
      ...baseline,
      cases: [{ ...baseline.cases[0], expected }],
      responseMode: 'schema',
      responseSchema,
      checks: [
        { id: 'root', type: 'jsonValue', required: true, pointer: '', expected },
        { id: 'null', type: 'jsonValue', required: true, pointer: '/steps/2', expected: null },
      ],
      sharedSettings: { maxTokens: null, temperature: null, stop: [] },
    })
    expect(parsed.cases[0].expected).toEqual(expected)
    expect(parsed.responseSchema).toEqual(responseSchema)
    expect(parsed.checks).toMatchObject([{ expected }, { expected: null }])
    expect(parsed.sharedSettings).toEqual({ maxTokens: null, temperature: null, stop: [] })
    expect(parsed.models[0].overrides).toEqual({})
  })

  it('accepts a judge-only improve definition with independent case groups', () => {
    const cases = [
      baseline.cases[0],
      { id: 'second', name: 'Degraded', input: 'Report degradation.', group: 'readiness' },
    ]
    const parsed = EvalDefinitionSchema.parse({
      ...baseline,
      mode: 'improve',
      cases,
      checks: [],
      judge,
      search,
      primaryMetric: 'judgeScore',
    })
    expect(parsed.judge?.model.overrides).toEqual({})
    expect(parsed.search?.optimizer.overrides).toEqual({})
    expect(parsed.search?.parameters).toEqual({ temperature: [0, 0.2] })
  })

  it.each([
    ['duplicate case IDs', { cases: [...baseline.cases, ...baseline.cases] }],
    ['unknown routing fields', { models: [{ modelId: 'saved-target', overrides: { providerKey: 'openai' } }] }],
    ['out-of-range settings', { sharedSettings: { maxTokens: 32_769 } }],
    ['a rubric over the limit', { judge: { ...judge, rubric: 'r'.repeat(8193) } }],
    ['a name over the limit', { name: 'n'.repeat(161) }],
    ['an unknown judge field', { judge: { ...judge, hidden: true } }],
    ['missing schema', { responseMode: 'schema' }],
    ['missing judge', { primaryMetric: 'judgeScore' }],
    ['missing exact answer', { checks: [{ id: 'exact', type: 'exact', required: true, trim: true }] }],
    ['missing expected JSON value', { checks: [{ id: 'value', type: 'jsonValue', required: true, pointer: '/status' }] }],
    ['invalid JSON Pointer', { checks: [{ id: 'value', type: 'jsonValue', required: true, pointer: '/~2', expected: true }] }],
    ['a pattern that is not a regular expression', { checks: [{ id: 'p', type: 'regex', required: true, pattern: '(' }] }],
    ['an unsupported pattern flag', { checks: [{ id: 'p', type: 'regex', required: true, pattern: 'x', flags: 'g' }] }],
    ['a repeated pattern flag', { checks: [{ id: 'p', type: 'regex', required: true, pattern: 'x', flags: 'ii' }] }],
    ['a count check with no bound', { checks: [{ id: 'w', type: 'wordCount', required: true }] }],
    ['a count check with its bounds reversed', { checks: [{ id: 'w', type: 'sentenceCount', required: true, min: 3, max: 1 }] }],
    ['an empty phrase list', { checks: [{ id: 'n', type: 'notContains', required: true, phrases: [] }] }],
    ['too many phrases', { checks: [{ id: 'n', type: 'containsAny', required: true, phrases: Array(21).fill('x') }] }],
    ['an option on a check that does not take it', { checks: [{ id: 'm', type: 'maxChars', required: true, max: 10, caseInsensitive: true }] }],
    ['search in compare mode', { search }],
    ['too few independent groups', { mode: 'improve', search }],
    ['nullable search candidates', {
      mode: 'improve',
      cases: [...baseline.cases, { id: 'second', name: 'Second case', input: 'Continue.' }],
      search: { ...search, parameters: { temperature: [null] } },
    }],
  ])('rejects %s', (_label, patch) => {
    expect(EvalDefinitionSchema.safeParse({ ...baseline, ...patch }).success).toBe(false)
  })

  it('accepts the max effort, the judge instruction option and text exactly at its limit', () => {
    const parsed = EvalDefinitionSchema.parse({
      ...baseline, checks: [], primaryMetric: 'judgeScore',
      sharedSettings: { reasoningEffort: 'max' },
      judge: { ...judge, rubric: 'r'.repeat(8192), includeSystemPrompt: false },
    })
    expect(parsed.sharedSettings).toEqual({ reasoningEffort: 'max' })
    expect(parsed.judge).toMatchObject({ includeSystemPrompt: false })
    expect(EvalDefinitionSchema.parse({ ...baseline, checks: [], judge, primaryMetric: 'judgeScore' }).judge).not.toHaveProperty('includeSystemPrompt')
  })

  it('accepts every check type with its options', () => {
    const checks = [
      { id: 'a', type: 'contains', required: true, text: 'ok', caseInsensitive: true },
      { id: 'b', type: 'notContains', required: true, phrases: ['sorry'], caseInsensitive: true },
      { id: 'c', type: 'containsAny', required: false, phrases: ['yes', 'no'] },
      { id: 'd', type: 'containsAll', required: false, phrases: ['red', 'blue'] },
      { id: 'e', type: 'regex', required: true, pattern: '^\\d{4}$', flags: 'im' },
      { id: 'f', type: 'wordCount', required: true, max: 50 },
      { id: 'g', type: 'sentenceCount', required: true, min: 1, max: 3 },
      { id: 'h', type: 'maxChars', required: true, max: 280 },
      { id: 'i', type: 'json', required: true, allowCodeFence: true },
    ]
    expect(EvalDefinitionSchema.parse({ ...baseline, checks }).checks).toEqual(checks)
  })

  it('requires exact preview identity and a caller-supplied submission key', () => {
    const preview = { suiteId: 'suite-1', revision: 1, fingerprint: 'a'.repeat(64) }
    expect(EvalStartSchema.parse({ ...preview, idempotencyKey: 'run:request.1' })).toEqual({
      ...preview,
      idempotencyKey: 'run:request.1',
    })
    expect(EvalStartSchema.safeParse(preview).success).toBe(false)
    expect(EvalStartSchema.safeParse({ ...preview, idempotencyKey: 'bad key' }).success).toBe(false)
    expect(EvalStartSchema.safeParse({ ...preview, fingerprint: 'A'.repeat(64), idempotencyKey: 'key' }).success).toBe(false)
    expect(EvalUpdateSchema.safeParse({ suiteId: 'suite-1', definition: baseline }).success).toBe(false)
  })

  it('bounds paginated results and export bytes', () => {
    expect(EvalResultsSchema.parse({ runId: 'run-1', role: 'judge' })).toEqual({
      runId: 'run-1', role: 'judge', limit: 25, offset: 0,
    })
    expect(EvalResultsSchema.safeParse({ runId: 'run-1', limit: 101 }).success).toBe(false)
    expect(EvalResultsSchema.safeParse({ runId: 'run-1', role: 'grader' }).success).toBe(false)
    expect(EvalExportSchema.parse({ runId: 'run-1' })).toEqual({
      runId: 'run-1', format: 'json', maxBytes: 1_048_576,
    })
    expect(EvalExportSchema.safeParse({ runId: 'run-1', maxBytes: 8_388_609 }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { evalTools } from '../src/eval-tools.js'
import { EvalCreateSchema, EvalStartSchema, EvalListSchema } from '../src/eval-schemas.js'
import { deferredValidation, validateToolArguments } from '../src/tool-validation.js'

const definition = {
  name: 'Sentiment', systemPrompt: 'Reply positive, negative, or neutral.',
  cases: [{ id: 'late', name: 'Late delivery', input: 'My parcel arrived late.', expected: 'negative' }],
  models: [{ modelId: 'configured-model' }],
  checks: [{ id: 'correct', type: 'exact', required: true, trim: true }],
}
function failure(schema: Parameters<typeof validateToolArguments>[0], input: unknown) {
  try { validateToolArguments(schema, input) } catch (error) {
    if (error instanceof Error) return JSON.parse(error.message)
    throw error
  }
  throw new Error('Expected validation to fail')
}

it('preserves the complete advertised schemas including required fields', () => {
  for (const tool of evalTools) {
    expect(zodToJsonSchema(deferredValidation(tool.parameters))).toEqual(zodToJsonSchema(tool.parameters))
  }
})

it('passes invalid input through transport only, then rejects it with field paths', () => {
  const input = { definition: { ...definition, concurrency: 9, models: [{}] } }
  expect(deferredValidation(EvalCreateSchema).parse(input)).toEqual(input)
  const error = failure(EvalCreateSchema, input)
  expect(error.error).toBe('INVALID_TOOL_ARGUMENTS')
  expect(error.issues).toEqual(expect.arrayContaining([
    { field: 'definition.concurrency', message: 'Use a value less than or equal to 4.' },
    expect.objectContaining({ field: 'definition.models[0].modelId', hint: expect.stringContaining('msq_get_eval_options') }),
  ]))
})

it('retains defaults and removes hidden auth from validated API payloads', () => {
  const input = { definition, apiKey: 'private-credential', baseUrl: 'https://api.missionsquad.invalid/v1' }
  const parsed = validateToolArguments(EvalCreateSchema, deferredValidation(EvalCreateSchema).parse(input))
  expect(parsed).toMatchObject({ definition: { mode: 'compare', repetitions: 3, cases: [{ tags: [] }], models: [{ overrides: {} }] } })
  expect(parsed).not.toHaveProperty('apiKey')
  expect(parsed).not.toHaveProperty('baseUrl')
})

it('explains cross-field errors without echoing prompts or answers', () => {
  const input = { definition: { ...definition, mode: 'improve', systemPrompt: 'private-prompt', cases: [{ ...definition.cases[0], expected: false }] } }
  const error = failure(EvalCreateSchema, input)
  expect(error.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'definition.search', message: 'Improve mode requires optimizer settings.' }),
    expect.objectContaining({ field: 'definition.cases[0].expected', message: 'Exact checks require a string expected answer for every case.' }),
  ]))
  expect(JSON.stringify(error)).not.toContain('private-prompt')
})

it('does not echo invalid enum values, unknown keys, or credentials', () => {
  const secret = 'sk-never-echo-this-value'
  const error = failure(EvalCreateSchema, { apiKey: secret, definition: { ...definition, mode: secret, [secret]: true } })
  expect(JSON.stringify(error)).not.toContain(secret)
  expect(error.issues).toContainEqual({ field: 'definition.mode', message: 'Choose one of: compare, improve.' })
})

it('gives preview and submission-key recovery hints', () => {
  const error = failure(EvalStartSchema, { suiteId: 'saved-suite', revision: 1, fingerprint: 'bad', idempotencyKey: 'bad key' })
  expect(error.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'fingerprint', hint: expect.stringContaining('msq_preview_eval_run') }),
    expect.objectContaining({ field: 'idempotencyKey', hint: expect.stringContaining('same key') }),
  ]))
})

it('caps field errors and reports that more corrections remain', () => {
  const error = failure(EvalCreateSchema, { definition: { ...definition, cases: Array.from({ length: 20 }, () => ({})) } })
  expect(error.issues).toHaveLength(8)
  expect(error.additionalIssueCount).toBeGreaterThan(0)
})

it('accepts omitted arguments for defaults, but rejects explicit null', () => {
  expect(validateToolArguments(EvalListSchema, undefined)).toEqual({ limit: 25, offset: 0 })
  expect(failure(EvalCreateSchema, undefined).issues[0].field).toBe('definition')
  expect(failure(EvalListSchema, null).issues[0].field).toBe('arguments')
})

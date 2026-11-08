import { UserError } from '@missionsquad/fastmcp'
import { z } from 'zod'

/**
 * FastMCP 1.1.3 otherwise discards Zod issues before execute is reached.
 * ZodCatch advertises the original schema, but lets execute report invalid
 * input as a recoverable tool error. Always validate again before any work.
 * FastMCP treats the raw arguments as extraArgs for this wrapper; the client
 * reads only apiKey/baseUrl from those, never definition or routing fields.
 */
export function deferredValidation(schema: z.ZodTypeAny) {
  return schema.catch(({ input }: { input: unknown }) => input)
}

function fieldPath(path: Array<string | number>): string {
  return path.reduce<string>((field, part) => typeof part === 'number'
    ? `${field}[${part}]` : `${field}${field ? '.' : ''}${part}`, '') || 'arguments'
}

function explanation(issue: z.ZodIssue): string {
  // Do not use Zod's enum/literal messages: they can echo submitted values.
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `This field is required. Supply ${issue.expected === 'array' ? 'an array' : `a value of type ${issue.expected}`}.`
        : `Use ${issue.expected === 'integer' ? 'a whole number' : `a value of type ${issue.expected}`}.`
    case 'invalid_enum_value':
    case 'invalid_union_discriminator':
      return `Choose one of: ${issue.options.join(', ')}.`
    case 'too_small':
      return issue.type === 'array' ? `Provide at least ${issue.minimum} item(s).`
        : issue.type === 'string' ? `Use at least ${issue.minimum} character(s).`
          : `Use a value ${issue.inclusive ? 'greater than or equal to' : 'greater than'} ${issue.minimum}.`
    case 'too_big':
      return issue.type === 'array' ? `Provide no more than ${issue.maximum} item(s).`
        : issue.type === 'string' ? `Use no more than ${issue.maximum} character(s).`
          : `Use a value ${issue.inclusive ? 'less than or equal to' : 'less than'} ${issue.maximum}.`
    case 'unrecognized_keys':
      return 'Remove unsupported fields from this object; use the fields listed in the tool schema.'
    case 'invalid_literal':
    case 'invalid_union':
      return 'Use a value matching one of the choices in the tool schema.'
    case 'not_finite': return 'Use a finite number.'
    // These messages are supplied by our eval schema, never by a submitted value.
    case 'custom':
    case 'invalid_string': return issue.message
    default: return 'Use a value matching this field in the tool schema.'
  }
}

function correction(path: Array<string | number>): string | undefined {
  switch (path.at(-1)) {
    case 'modelId': return 'Use a configured modelId returned by msq_get_eval_options.'
    case 'revision': return 'Use the current revision returned by msq_get_eval.'
    case 'fingerprint': return 'Copy data.fingerprint from msq_preview_eval_run for this suite and revision.'
    case 'idempotencyKey': return 'Use 1–128 letters, digits, dots, underscores, colons or hyphens. Retain the same key when retrying an uncertain submission.'
    case 'suiteId': return 'Use data.id returned by msq_create_eval or an ID from msq_list_evals.'
    case 'runId': return 'Use data.id returned by msq_start_eval_run or an ID from msq_list_eval_runs.'
    case 'trialId': return 'Use a trial id returned by msq_list_eval_results.'
    default: return undefined
  }
}

/** Never includes submitted values, credentials, prompts, or the raw Zod error. */
export function validateToolArguments(schema: z.ZodTypeAny, input: unknown): unknown {
  // MCP permits omitting arguments for discovery/default-only tools.
  const result = schema.safeParse(input === undefined ? {} : input)
  if (result.success) return result.data
  const issues = result.error.issues.slice(0, 8).map(issue => ({
    field: fieldPath(issue.path),
    message: explanation(issue),
    ...(correction(issue.path) ? { hint: correction(issue.path) } : {}),
  }))
  throw new UserError(JSON.stringify({
    error: 'INVALID_TOOL_ARGUMENTS',
    message: 'Correct the fields below and call this tool again. No API request was sent.',
    issues,
    ...(result.error.issues.length > issues.length
      ? { additionalIssueCount: result.error.issues.length - issues.length } : {}),
  }, null, 2))
}

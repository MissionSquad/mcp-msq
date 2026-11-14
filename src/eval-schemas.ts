import { z } from 'zod'

/**
 * A plain .max() is what puts maxLength into the advertised JSON Schema, so an agent can see
 * the limit before it sends anything. Zod counts UTF-16 units where the API counts characters,
 * so this is at most slightly stricter for text full of emoji; it never lets through what the
 * API would reject.
 */
function text(max: number, min = 1) {
  return z.string().min(min).max(max)
}

const id = text(128)
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const seed = z.number().int().min(0).max(2_147_483_647)
const score = z.number().min(0).max(100)
const jsonSchema = z.object({}).passthrough().describe('Draft-07 JSON Schema object with local references only.')

const settings = {
  maxTokens: z.number().int().min(1).max(32_768).describe('Output token budget for one response. The input prompt and context have their own limits. If no limit is inherited, the eval uses 4096.'),
  temperature: z.number().min(0).max(2).describe('Sampling randomness. Lower values generally produce more consistent answers. Check model support in eval options.'),
  topP: z.number().gt(0).max(1).describe('Nucleus sampling cutoff. Lower values restrict sampling to more likely tokens. Check model support in eval options.'),
  topK: z.number().int().min(1).max(1000).describe('Restrict sampling to this many of the most likely next tokens. Check model support in eval options.'),
  seed: seed.describe('Model sampling seed for providers that support it. The definition also has a separate seed for eval case splitting.'),
  stop: z.array(text(128)).max(4).describe('Up to four sequences that end generation when encountered. Check model support in eval options.'),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).describe('Requested reasoning effort. Available levels depend on the configured model.'),
  verbosity: z.enum(['low', 'medium', 'high']).describe('Requested answer detail. Check model support in eval options.'),
  frequency_penalty: z.number().min(-2).max(2).describe('Positive values discourage repeated tokens in proportion to how often they have appeared. Negative values encourage repetition. Check model support in eval options.'),
  presence_penalty: z.number().min(-2).max(2).describe('Positive values discourage tokens that have already appeared. Negative values favor reuse. Check model support in eval options.'),
}

const settingOverrides = z.object(Object.fromEntries(
  Object.entries(settings).map(([key, schema]) => [key, schema.nullable().optional()]),
)).strict()
const searchParameters = z.object(Object.fromEntries(
  Object.entries(settings).map(([key, schema]) => [key, z.array(schema).min(1).max(10).optional()]),
)).strict()

const selection = z.object({
  modelId: id.describe('Configured MissionSquad model ID from the eval options tool.'),
  overrides: settingOverrides.default({}).describe('Omit a setting to inherit its effective value. Null clears the inherited value, except maxTokens then uses the eval default of 4096. Use settings supported by this model.'),
}).strict()

const evalCase = z.object({
  id: id.describe('Unique stable case ID, such as readiness-ok.'),
  name: text(160).describe('Case label shown in eval results.'),
  input: text(32_768).describe('User message sent to the model for this case.'),
  expected: z.unknown().optional().describe('Expected answer as a JSON value. Required as a string for every case when using an exact check.'),
  tags: z.array(text(64)).max(20).default([]).describe('Optional labels for organizing cases, such as regression or edge-case.'),
  group: id.optional().describe('Cases with the same group stay together in the development or held-out split.'),
}).strict()

const checkFields = {
  id: id.describe('Unique check ID.'),
  required: z.boolean().describe('Whether this check must pass for the answer to pass.'),
}
const evalCheck = z.discriminatedUnion('type', [
  z.object({ ...checkFields, type: z.literal('exact'), trim: z.boolean() }).strict(),
  z.object({ ...checkFields, type: z.literal('contains'), text: text(8192) }).strict(),
  z.object({ ...checkFields, type: z.literal('json') }).strict(),
  z.object({ ...checkFields, type: z.literal('schema'), schema: jsonSchema }).strict(),
  z.object({
    ...checkFields,
    type: z.literal('jsonValue'),
    pointer: text(1024, 0).refine(
      value => value === '' || (value.startsWith('/') && !/~(?![01])/.test(value)),
      { message: 'Use a valid JSON Pointer, such as /status, or an empty string for the root.' },
    ),
    expected: z.unknown().refine(value => value !== undefined, {
      message: 'A JSON value check requires an expected value.',
    }).describe('Exact JSON value at the pointer, with its original type.'),
  }).strict(),
])

const evalJudge = z.object({
  model: selection,
  rubric: text(8192).describe('Instructions for scoring the answer against the criteria, at most 8192 characters. The judge does not receive the target model identity.'),
  criteria: z.array(z.object({
    id: id.describe('Unique stable criterion ID.'),
    description: text(2048).describe('What the judge should score on a 0 to 100 scale.'),
    weight: z.number().gt(0).max(100).describe('Relative contribution to the weighted judge score.'),
  }).strict()).min(1).max(20),
  passScore: score.describe('Minimum weighted score for the judgment to pass.'),
  includeSystemPrompt: z.boolean().optional().describe('Show the judge the system prompt the answer was produced under, so output that follows an unusual required format is not marked wrong. Defaults to true. Set false to judge the answer on the rubric alone.'),
}).strict()

const evalSearch = z.object({
  optimizer: selection,
  tunePrompt: z.boolean().describe('Allow the optimizer to propose a replacement system prompt.'),
  parameters: searchParameters.describe('Allowed candidate values, for example {temperature: [0, 0.2]}. Use {} when tuning only the prompt.'),
  maxRounds: z.number().int().min(1).max(10).describe('Maximum optimization rounds for each target model.'),
  minimumImprovement: score.describe('Required gain over the incumbent, in percentage points for quality or relative percent for cost and latency.'),
  maxQualityRegression: score.describe('Maximum quality drop from the original baseline, in percentage points.'),
}).strict()

function issue(ctx: z.RefinementCtx, path: Array<string | number>, message: string) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
}

function requireUnique(ctx: z.RefinementCtx, path: string[], ids: string[]) {
  if (new Set(ids).size !== ids.length) issue(ctx, path, 'IDs must be unique.')
}

export const EvalDefinitionSchema = z.object({
  name: text(160).describe('Suite label shown in the eval list and run history.'),
  description: text(2000, 0).optional().describe('What this eval is for, in a sentence or two. Shown in run headers, PDF reports and report emails.'),
  mode: z.enum(['compare', 'improve']).default('compare').describe('Compare runs the same cases on selected models. Improve searches prompt or setting changes and measures held-out cases.'),
  systemPrompt: text(32_768, 0).describe('System message sent to every target. Use an empty string for no instructions.'),
  cases: z.array(evalCase).min(1).max(200).describe('Prompts and optional reference answers used to exercise the models.'),
  models: z.array(selection).min(1).max(10).describe('Target models to compare or improve. Choose configured model IDs from eval options.'),
  sharedSettings: settingOverrides.default({}).describe('Settings applied to every target after its saved settings and before per-model overrides. Omit a key to retain the saved setting. Null clears it, with maxTokens falling back to 4096. Judge and optimizer settings are configured separately.'),
  responseMode: z.enum(['text', 'json', 'schema']).default('text').describe('Native provider response format. Text mode with JSON or schema checks works across more providers.'),
  responseSchema: jsonSchema.optional(),
  checks: z.array(evalCheck).max(30).describe('Deterministic checks on original answers. For example, {id:"status", type:"jsonValue", required:true, pointer:"/status", expected:"ready"}. Use [] for judge-only grading.'),
  judge: evalJudge.optional().describe('One rubric judge shared by all targets. Each completed target can incur a judge call.'),
  primaryMetric: z.enum(['passRate', 'judgeScore', 'costUsd', 'latencyMs']).default('passRate').describe('Metric used to compare variants and select improvements. Higher pass rate or judge score and lower cost or latency are better.'),
  search: evalSearch.optional().describe('Required in improve mode. Tune the prompt, explicit setting values, or both.'),
  repetitions: z.number().int().min(1).max(10).default(3).describe('Independent responses generated for each target and case in each applicable stage. More repetitions increase calls and help measure variation.'),
  concurrency: z.number().int().min(1).max(4).default(4).describe('Maximum parallel case trials within this run.'),
  maxCalls: z.number().int().min(1).max(10_000).default(5000).describe('Maximum combined target, judge and optimizer calls. Preview rejects plans whose upper bound exceeds it.'),
  maxDurationMs: z.number().int().min(1000).max(7_200_000).default(3_600_000).describe('Wall-clock execution budget in milliseconds after the run begins. The default is 3,600,000 ms (one hour).'),
  spendLimitUsd: z.number().finite().gt(0).optional().describe('Optional spend cap in USD. Requires known prices for every selected role.'),
  seed: seed.default(42).describe('Seed for eval case splitting and comparisons. Model sampling seeds belong in settings.'),
}).strict().superRefine((definition, ctx) => {
  const { cases, checks, judge, mode, models, primaryMetric, responseMode, responseSchema, search } = definition
  requireUnique(ctx, ['cases'], cases.map(item => item.id))
  requireUnique(ctx, ['checks'], checks.map(item => item.id))
  requireUnique(ctx, ['models'], models.map(item => item.modelId))
  if (judge) requireUnique(ctx, ['judge', 'criteria'], judge.criteria.map(item => item.id))

  if (checks.some(check => check.type === 'exact')) {
    cases.forEach((item, index) => {
      if (typeof item.expected !== 'string') {
        issue(ctx, ['cases', index, 'expected'], 'Exact checks require a string expected answer for every case.')
      }
    })
  }

  if (responseMode === 'schema' && !responseSchema) {
    issue(ctx, ['responseSchema'], 'Schema response mode requires a response schema.')
  }
  if (primaryMetric === 'judgeScore' && !judge) {
    issue(ctx, ['judge'], 'Judge score requires a judge.')
  }
  if ((primaryMetric === 'passRate' || mode === 'improve') && !judge && !checks.some(check => check.required)) {
    issue(ctx, ['checks'], 'Pass rate and improve mode require a required check or a judge.')
  }
  if (mode === 'improve') {
    if (!search) {
      issue(ctx, ['search'], 'Improve mode requires optimizer settings.')
    } else if (!search.tunePrompt && !Object.values(search.parameters).some(value => value !== undefined)) {
      issue(ctx, ['search', 'parameters'], 'Allow prompt tuning or provide at least one setting to tune.')
    }
    const groups = new Set(cases.map(item => item.group === undefined ? `case:${item.id}` : `group:${item.group}`))
    if (groups.size < 2) issue(ctx, ['cases'], 'Improve mode requires at least two independent case groups.')
  } else if (search) {
    issue(ctx, ['search'], 'Search settings apply only to improve mode.')
  }
})

const pathId = id.refine(value => value !== '.' && value !== '..', 'Use an ID returned by the eval tools, not a relative path.')
const suiteId = pathId.refine(value => value.toLowerCase() !== 'options', 'Use the saved suite ID, not the options route.').describe('ID of the saved eval suite.')
const runId = pathId.describe('ID of the eval run.')
const pageFields = {
  limit: z.number().int().min(1).max(100).default(25).describe('Maximum number of records to return in this page.'),
  offset: z.number().int().min(0).max(1_000_000).default(0).describe('Number of records to skip before returning this page.'),
}

export const EvalCreateSchema = z.object({ definition: EvalDefinitionSchema })
export const EvalUpdateSchema = z.object({
  suiteId,
  revision,
  definition: EvalDefinitionSchema.describe('Complete replacement definition. Get the suite and its current revision before editing.'),
})
export const EvalSuiteIdSchema = z.object({ suiteId })
export const EvalRunIdSchema = z.object({ runId })
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'Use 1–128 letters, digits, dots, underscores, colons or hyphens.')
export const EvalRunViewSchema = z.object({
  runId,
  view: z.enum(['compact', 'full']).default('compact').describe('compact returns status, progress, timing, spend and one summary row per model, without the plan, cases or prompts. full returns the complete report including the frozen plan and every prompt.'),
})
export const EvalWaitSchema = z.object({
  runId,
  timeoutSeconds: z.number().int().min(1).max(600).default(300).describe('How long to wait for the run to finish, in seconds. The run keeps executing if this elapses.'),
})
export const EvalRegradeSchema = z.object({
  runId: runId.describe('ID of the finished run whose answers should be graded again.'),
  judge: evalJudge.optional().describe('New judge. Omit to keep the original run\'s judge.'),
  checks: z.array(evalCheck).max(30).optional().describe('New deterministic checks. Omit to keep the original run\'s checks.'),
  idempotencyKey: idempotencyKey.describe('Caller-generated submission ID. Reuse it after an uncertain response to recover the same re-grade run.'),
}).superRefine((value, ctx) => {
  if (value.judge === undefined && value.checks === undefined) issue(ctx, ['judge'], 'Provide a judge, checks, or both.')
  if (value.checks) requireUnique(ctx, ['checks'], value.checks.map(item => item.id))
  if (value.judge) requireUnique(ctx, ['judge', 'criteria'], value.judge.criteria.map(item => item.id))
})
export const EvalPreviewSchema = z.object({ suiteId, revision })
export const EvalPreviewToolSchema = EvalPreviewSchema.extend({
  includePlan: z.boolean().default(false).describe('Return the complete frozen plan, including every case and prompt. The default returns only what is needed to review and start the run.'),
})
export const EvalStartSchema = EvalPreviewSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/, 'Use the complete 64-character lowercase hexadecimal preview fingerprint.').describe('Fingerprint from the reviewed preview for this suite revision.'),
  idempotencyKey: idempotencyKey.describe('Caller-generated submission ID, such as a UUID. Reuse it with the same preview after an uncertain response. A new key can start new paid work.'),
  emailOnCompletion: z.boolean().optional().describe('Email the overview report, with its PDF attached, to the account email when this run finishes. Off unless set. Fails with 409 where email is not set up (emailAvailable in msq_get_eval_options).'),
})
export const EvalListSchema = z.object(pageFields)
export const EvalResultsSchema = z.object({
  runId,
  ...pageFields,
  modelId: id.optional().describe('Only return trials run by this configured model.'),
  caseId: id.optional().describe('Only return trials associated with this case ID.'),
  role: z.enum(['target', 'judge', 'optimizer']).optional(),
  variantId: id.optional().describe('Only return trials of this variant (summary rows carry variantId).'),
  stage: z.enum(['baseline', 'incumbent', 'candidate', 'confirmation-baseline', 'confirmation-winner', 'judge', 'optimizer']).optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted']).optional().describe('For example failed, to list failed requests with their error.'),
  passed: z.boolean().optional().describe('Only graded trials that passed (true) or failed (false).'),
  minScore: score.optional().describe('Only trials with a judge score at or above this.'),
  maxScore: score.optional().describe('Only trials with a judge score at or below this.'),
  sort: z.enum(['created', 'score', '-score']).optional().describe('score lists the lowest judge scores first, -score the highest. Sorting by score returns only judged trials.'),
})
const outputChars = z.number().int().min(1).max(20_000).default(2000).describe('Longest answer text returned per trial. Longer answers are cut and marked outputTruncated.')
export const EvalOutputsSchema = z.object({
  runId,
  limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of answers in this page.'),
  offset: pageFields.offset,
  modelId: id.optional().describe('Only answers from this configured model.'),
  variantId: id.optional().describe('Only answers of this variant.'),
  caseId: id.optional().describe('Only answers to this case.'),
  passed: z.boolean().optional().describe('Only answers that passed (true) or failed (false).'),
  sort: z.enum(['created', 'score', '-score']).optional().describe('score lists the lowest judge scores first.'),
  outputChars,
})
export const EvalSummarySchema = z.object({
  runId,
  lowest: z.number().int().min(0).max(5).default(3).describe('How many of the lowest-scored answers to include per model, with the judge\'s notes. 0 leaves them out.'),
  outputChars: outputChars.default(600),
})
export const EvalResumeSchema = z.object({
  runId: runId.describe('ID of the paused run.'),
  maxDurationMs: z.number().int().min(1000).max(7_200_000).optional().describe('Time allowed from this resume, in milliseconds. Omit to keep the run\'s time limit.'),
  maxCalls: z.number().int().min(1).max(10_000).optional().describe('Total call limit across the whole run. Must be above the calls already started. Omit to keep it.'),
  spendLimitUsd: z.number().finite().gt(0).optional().describe('Total spend limit across the whole run, in USD. Omit to keep it.'),
})
export const EvalEmailSchema = z.object({
  runId,
  attach: z.enum(['overview', 'full', 'none']).default('overview').describe('Which PDF report to attach. overview is a few pages; full adds distributions, coverage, one response per model and failures.'),
})
export const EvalCompareRunsSchema = z.object({
  runIdA: runId.describe('The first run, for example the old prompt.'),
  runIdB: runId.describe('The second run, for example the new prompt.'),
  maxTrials: z.number().int().min(100).max(5000).default(2000).describe('Most target trials read from each run.'),
})
export const EvalTrialSchema = z.object({
  runId,
  trialId: pathId.describe('Trial ID from the paginated results list.'),
})
export const EvalExportSchema = z.object({
  runId,
  format: z.enum(['json', 'csv']).default('json').describe('JSON includes full evidence. CSV contains summary rows.'),
  maxBytes: z.number().int().min(1024).max(8 * 1024 * 1024).default(1024 * 1024).describe('Maximum size of the export in bytes, both as read from the API and as returned by this tool.'),
})

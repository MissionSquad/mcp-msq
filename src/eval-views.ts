/**
 * Short views of eval API responses for agents. The API returns the whole frozen plan (every
 * case, the system prompt, pricing records) with each run; an agent polling a run needs status,
 * progress, spend and one row per model. Every reader here tolerates missing fields, so runs
 * stored before a field existed still produce a view.
 */

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Json | undefined {
  return isRecord(value) ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function pick(source: Json | undefined, keys: string[]): Json {
  const result: Json = {}
  for (const key of keys) if (source?.[key] !== undefined) result[key] = source[key]
  return result
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'interrupted', 'paused', 'error'])

/** A status the API will not move on from without a new request. Unknown statuses are not terminal. */
export function isEvalRunTerminal(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status)
}

/** `{ success, data }` envelopes are unwrapped; anything else is returned as it is. */
function payload(response: unknown): Json | undefined {
  const envelope = record(response)
  return record(envelope?.data) ?? envelope
}

export function evalRunStatus(response: unknown): unknown {
  const data = payload(response)
  return (record(data?.record) ?? data)?.status
}

function target(value: unknown): Json | undefined {
  const source = record(value)
  if (!source) return undefined
  return { ...pick(source, ['modelId', 'name', 'providerKey', 'model', 'settings']), priced: source.pricing != null }
}

/** What an agent needs to review a preview and start it: identity, size, models and warnings. */
export function compactEvalPreview(response: unknown): unknown {
  const plan = payload(response)
  if (!plan) return response
  const definition = record(plan.definition)
  return {
    success: true,
    data: {
      ...pick(plan, ['fingerprint', 'suiteId', 'suiteRevision', 'maximumCalls']),
      ...pick(definition, ['name', 'mode', 'primaryMetric', 'repetitions', 'maxCalls', 'maxDurationMs', 'spendLimitUsd']),
      cases: list(definition?.cases).length,
      developmentCases: list(plan.developmentCaseIds).length,
      heldOutCases: list(plan.heldOutCaseIds).length,
      targets: list(plan.targets).map(target),
      ...(plan.judge ? { judge: target(plan.judge) } : {}),
      ...(plan.optimizer ? { optimizer: target(plan.optimizer) } : {}),
      warnings: list(plan.warnings),
    },
  }
}

/** The run record without its plan. */
export function compactEvalRunRecord(response: unknown): unknown {
  const run = payload(response)
  if (!run) return response
  return {
    success: true,
    data: pick(run, ['id', 'suiteId', 'status', 'phase', 'kind', 'parentRunId', 'stopReason', 'callsStarted', 'completedTrials', 'createdAt', 'startedAt', 'completedAt']),
  }
}

function summaryRow(value: unknown, names: Map<unknown, unknown>): Json | undefined {
  const row = record(value)
  if (!row) return undefined
  const stat = (key: string, fields: string[]) => pick(record(row[key]), fields)
  return {
    ...pick(row, ['variantId', 'modelId', 'stage', 'round', 'trials', 'completed', 'graded', 'passed', 'passRate',
      'requestSuccessRate', 'costPerPassUsd', 'failedTrials', 'failureReasons',
      'targetCostUsd', 'judgeCostUsd', 'totalCostUsd', 'costPerPassIncludingJudgeUsd', 'unpricedCalls']),
    ...(names.has(row.modelId) ? { model: names.get(row.modelId) } : {}),
    judgeScore: stat('judgeScore', ['count', 'mean', 'median', 'standardDeviation']),
    firstOutputMs: stat('firstOutputMs', ['median']),
    durationMs: stat('durationMs', ['median', 'p90']),
    inputTokens: stat('inputTokens', ['mean']),
    outputTokens: stat('outputTokens', ['mean']),
    costUsd: stat('costUsd', ['count', 'mean']),
    json: row.json,
    schema: row.schema,
  }
}

/**
 * Status, progress, timing, spend and the per-model summary rows. Leaves out the plan, the cases
 * and every prompt; ask for the full view when those are needed.
 */
export function compactEvalRun(response: unknown): unknown {
  const report = payload(response)
  const run = record(report?.record)
  if (!report || !run) return response
  const plan = record(run.plan)
  const definition = record(plan?.definition)
  const names = new Map(list(plan?.targets).map(item => [record(item)?.modelId, record(item)?.name]))
  const startedAt = numberOrUndefined(run.startedAt)
  const completedAt = numberOrUndefined(run.completedAt)
  const skipped = list(report.variants).map(record)
    .filter((variant): variant is Json => typeof variant?.skippedReason === 'string')
    .map(variant => pick(variant, ['id', 'modelId', 'round', 'skippedReason']))
  return {
    success: true,
    data: {
      ...pick(run, ['id', 'suiteId', 'status', 'phase', 'kind', 'parentRunId', 'stopReason']),
      terminal: isEvalRunTerminal(run.status),
      eval: pick(definition, ['name', 'mode', 'primaryMetric', 'repetitions']),
      progress: { ...pick(run, ['completedTrials', 'callsStarted']), ...pick(plan, ['maximumCalls']) },
      timing: {
        ...pick(run, ['createdAt', 'startedAt', 'completedAt']),
        ...(startedAt !== undefined && completedAt !== undefined ? { runTimeMs: completedAt - startedAt } : {}),
      },
      limits: pick(definition, ['maxCalls', 'maxDurationMs', 'spendLimitUsd']),
      spend: report.spend,
      summary: list(report.summary).map(row => summaryRow(row, names)).filter(Boolean),
      ...(list(report.confirmation).length ? { confirmation: report.confirmation } : {}),
      ...(skipped.length ? { skipped } : {}),
      ...(list(plan?.warnings).length ? { warnings: plan?.warnings } : {}),
    },
  }
}

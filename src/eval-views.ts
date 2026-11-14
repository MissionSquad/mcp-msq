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
export function payload(response: unknown): Json | undefined {
  const envelope = record(response)
  return record(envelope?.data) ?? envelope
}

export function evalRunStatus(response: unknown): unknown {
  const data = payload(response)
  return (record(data?.record) ?? data)?.status
}

/**
 * Arms. A run compares arms; before arms existed each model was one arm, so a record without
 * an arm id belongs to the arm named by its model id, and a target without a label is called
 * by its model's name.
 */
function armOf(value: Json | undefined): unknown {
  return value?.armId ?? value?.modelId
}
/** Arm id to the arm's display name, for every target of a plan. */
function armNames(plan: Json | undefined): Map<unknown, unknown> {
  return new Map(list(plan?.targets).map(item => { const source = record(item); return [armOf(source), source?.label ?? source?.name] }))
}

function target(value: unknown): Json | undefined {
  const source = record(value)
  if (!source) return undefined
  return { ...pick(source, ['armId', 'label', 'modelId', 'name', 'providerKey', 'model', 'responseMode', 'settings']), priced: source.pricing != null }
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
    data: pick(run, ['id', 'suiteId', 'status', 'phase', 'kind', 'parentRunId', 'stopReason', 'callsStarted', 'completedTrials', 'createdAt', 'startedAt', 'completedAt', 'resumes', 'emailOnCompletion', 'queuePosition']),
  }
}

function summaryRow(value: unknown, names: Map<unknown, unknown>): Json | undefined {
  const row = record(value)
  if (!row) return undefined
  const stat = (key: string, fields: string[]) => pick(record(row[key]), fields)
  return {
    ...pick(row, ['variantId', 'armId', 'modelId', 'stage', 'round', 'trials', 'completed', 'graded', 'passed', 'passRate', 'judgeCalls',
      'requestSuccessRate', 'costPerPassUsd', 'failedTrials', 'failureReasons',
      'targetCostUsd', 'judgeCostUsd', 'totalCostUsd', 'costPerPassIncludingJudgeUsd', 'unpricedCalls']),
    // `model` is the arm's name: its label, or its model's name when it has none.
    ...(names.has(armOf(row)) ? { model: names.get(armOf(row)) } : {}),
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
  const names = armNames(plan)
  const startedAt = numberOrUndefined(run.startedAt)
  const completedAt = numberOrUndefined(run.completedAt)
  const overview = record(report.overview)
  const skipped = list(report.variants).map(record)
    .filter((variant): variant is Json => typeof variant?.skippedReason === 'string')
    .map(variant => ({ ...pick(variant, ['id', 'armId', 'modelId', 'round', 'skippedReason']), ...(names.has(armOf(variant)) ? { model: names.get(armOf(variant)) } : {}) }))
  return {
    success: true,
    data: {
      ...pick(run, ['id', 'suiteId', 'status', 'phase', 'kind', 'parentRunId', 'stopReason', 'resumes', 'queuePosition']),
      terminal: isEvalRunTerminal(run.status),
      eval: pick(definition, ['name', 'description', 'mode', 'primaryMetric', 'repetitions']),
      ...(typeof record(run.report)?.summary === 'string' ? { whatIsEvaluated: record(run.report)?.summary } : {}),
      progress: { ...pick(run, ['completedTrials', 'callsStarted']), ...pick(plan, ['maximumCalls']) },
      timing: {
        ...pick(run, ['createdAt', 'startedAt', 'completedAt']),
        // The API adds up run time across resumes; an older API leaves it to the start and end times.
        ...(numberOrUndefined(overview?.runTimeMs) !== undefined ? { runTimeMs: overview?.runTimeMs }
          : startedAt !== undefined && completedAt !== undefined ? { runTimeMs: completedAt - startedAt } : {}),
      },
      ...(overview ? { totals: pick(overview, ['trials', 'totalCostUsd', 'unpricedCalls', 'cases', 'models', 'repetitions']) } : {}),
      limits: pick(definition, ['maxCalls', 'maxDurationMs', 'spendLimitUsd']),
      spend: report.spend,
      summary: list(report.summary).map(row => summaryRow(row, names)).filter(Boolean),
      ...(list(report.confirmation).length ? { confirmation: report.confirmation } : {}),
      ...(skipped.length ? { skipped } : {}),
      ...(list(plan?.warnings).length ? { warnings: plan?.warnings } : {}),
    },
  }
}

/** A graded answer with the judge's notes, short enough to read many at once. */
function gradedAnswer(value: unknown, caseNames: Map<unknown, unknown>): Json | undefined {
  const trial = record(value)
  if (!trial) return undefined
  const grade = record(trial.grade)
  return {
    ...pick(trial, ['id', 'caseId', 'repetition', 'status', 'error', 'output', 'outputTruncated', 'finishReason']),
    ...(caseNames.has(trial.caseId) ? { case: caseNames.get(trial.caseId) } : {}),
    ...pick(grade, ['passed', 'judgeScore', 'judgeCriteria', 'error']),
    failedChecks: list(grade?.checks).map(record).filter((check): check is Json => check?.passed === false).map(check => pick(check, ['id', 'message'])),
  }
}

/**
 * The per-model table, the ranking with its "within noise" flags, and optionally each model's
 * lowest-scored answers with the judge's notes. `lowest` maps a variantId to a results page.
 */
export function evalSummaryView(response: unknown, lowest: Map<string, unknown> = new Map()): unknown {
  const compact = payload(compactEvalRun(response))
  const report = payload(response)
  const run = record(report?.record)
  if (!compact || !report || !run) return response
  const plan = record(run.plan)
  const names = armNames(plan)
  const caseNames = new Map(list(record(plan?.definition)?.cases).map(item => [record(item)?.id, record(item)?.name]))
  const ranking = list(report.ranking).map(record).filter((item): item is Json => item !== undefined)
    .map((item, index) => ({ rank: index + 1, model: names.get(armOf(item)) ?? armOf(item), ...pick(item, ['variantId', 'armId', 'modelId', 'value', 'withinNoise', 'noiseBasis']),
      // The paired difference from rank 1, when the API compared the two case by case.
      ...(record(item.delta) ? { delta: pick(record(item.delta), ['delta', 'lower', 'upper']) } : {}) }))
  const lowestScored = list(compact.summary).map(record).filter((row): row is Json => row !== undefined && lowest.has(String(row.variantId)))
    .map(row => ({ variantId: row.variantId, model: row.model ?? row.modelId,
      answers: list(payload(lowest.get(String(row.variantId)))?.data ?? record(lowest.get(String(row.variantId)))?.data)
        .map(item => gradedAnswer(item, caseNames)).filter(Boolean) }))
  return {
    success: true,
    data: {
      ...compact,
      ...(ranking.length ? { ranking, rankingNote: 'Best first by the primary metric. withinNoise means the row cannot be told apart from rank 1. noiseBasis says why: tie (equal values), paired (compared case by case; delta is this row minus rank 1 with its 95% interval lower..upper, and the row is within noise when that interval includes zero), or standardError (the gap is smaller than the measurement error).' } : {}),
      ...(lowestScored.length ? { lowestScored } : {}),
    },
  }
}

/** A page of answers with their grades. */
export function evalOutputsView(response: unknown, plan: unknown): unknown {
  const envelope = record(response)
  if (!envelope) return response
  const caseNames = new Map(list(record(record(plan)?.definition)?.cases).map(item => [record(item)?.id, record(item)?.name]))
  const names = armNames(record(plan))
  return {
    success: true, total: envelope.total,
    data: list(envelope.data).map(item => {
      const trial = record(item)
      const answer = gradedAnswer(item, caseNames)
      return trial && answer ? { ...pick(trial, ['variantId', 'armId', 'modelId', 'stage', 'round']), model: names.get(armOf(trial)) ?? armOf(trial), ...answer } : undefined
    }).filter(Boolean),
  }
}

interface CaseStat { trials: number; graded: number; passed: number; scored: number; scoreSum: number }

function caseStats(trials: unknown[]): Map<string, CaseStat> {
  const stats = new Map<string, CaseStat>()
  for (const item of trials) {
    const trial = record(item)
    const arm = armOf(trial)
    if (!trial || typeof trial.caseId !== 'string' || typeof arm !== 'string') continue
    // By arm, so two arms on one model are compared separately.
    const key = JSON.stringify([arm, trial.caseId])
    const stat = stats.get(key) ?? { trials: 0, graded: 0, passed: 0, scored: 0, scoreSum: 0 }
    const grade = record(trial.grade)
    stat.trials++
    if (typeof grade?.passed === 'boolean') { stat.graded++; if (grade.passed) stat.passed++ }
    const judgeScore = numberOrUndefined(grade?.judgeScore)
    if (judgeScore !== undefined) { stat.scored++; stat.scoreSum += judgeScore }
    stats.set(key, stat)
  }
  return stats
}

/**
 * Case by case, how run B differs from run A for each arm both runs have, matched by arm id (for a
 * run from before arms, the model id). Only the first-stage
 * (baseline) answers are compared. Cases or models present in one run only are listed, not compared.
 */
export function compareEvalRunsView(a: { report: unknown; trials: unknown[] }, b: { report: unknown; trials: unknown[] }): unknown {
  const describe = (response: unknown) => {
    const run = record(payload(response)?.record)
    const plan = record(run?.plan)
    return { run, cases: new Map(list(record(plan?.definition)?.cases).map(item => [String(record(item)?.id), record(item)?.name])),
      models: new Map([...armNames(plan)].map(([arm, name]) => [String(arm), name])) }
  }
  const left = describe(a.report), right = describe(b.report)
  const statsA = caseStats(a.trials), statsB = caseStats(b.trials)
  const rate = (stat: CaseStat | undefined) => stat?.graded ? stat.passed / stat.graded : null
  const mean = (stat: CaseStat | undefined) => stat?.scored ? stat.scoreSum / stat.scored : null
  const delta = (from: number | null, to: number | null) => from === null || to === null ? null : to - from
  const rows = [...statsA.keys()].filter(key => statsB.has(key)).map(key => {
    const parsed: unknown = JSON.parse(key)
    const [modelId, caseId] = Array.isArray(parsed) ? parsed.map(String) : ['', '']
    const from = statsA.get(key), to = statsB.get(key)
    // `modelId` is kept as the row's key for existing readers; it holds the arm id.
    return { armId: modelId, modelId, model: left.models.get(modelId) ?? modelId, caseId, case: left.cases.get(caseId) ?? caseId,
      passRateA: rate(from), passRateB: rate(to), passRateDelta: delta(rate(from), rate(to)),
      judgeScoreA: mean(from), judgeScoreB: mean(to), judgeScoreDelta: delta(mean(from), mean(to)) }
  })
  const modelIds = [...new Set(rows.map(row => row.modelId))]
  const average = (values: Array<number | null>) => { const known = values.filter((value): value is number => value !== null); return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null }
  const only = (mine: Map<string, CaseStat>, other: Map<string, CaseStat>) => [...new Set([...mine.keys()].filter(key => !other.has(key)).map(key => key))].length
  return {
    success: true,
    data: {
      runA: pick(left.run, ['id', 'status', 'createdAt']), runB: pick(right.run, ['id', 'status', 'createdAt']),
      note: 'Deltas are run B minus run A. A positive pass-rate or judge-score delta means run B did better on that case. Averages are over cases, not weighted by repetitions.',
      models: modelIds.map(modelId => {
        const mine = rows.filter(row => row.modelId === modelId)
        return { armId: modelId, modelId, model: left.models.get(modelId) ?? modelId, casesCompared: mine.length,
          meanPassRateDelta: average(mine.map(row => row.passRateDelta)), meanJudgeScoreDelta: average(mine.map(row => row.judgeScoreDelta)),
          improvedCases: mine.filter(row => (row.judgeScoreDelta ?? row.passRateDelta ?? 0) > 0).length,
          worseCases: mine.filter(row => (row.judgeScoreDelta ?? row.passRateDelta ?? 0) < 0).length }
      }),
      cases: rows,
      notCompared: { onlyInA: only(statsA, statsB), onlyInB: only(statsB, statsA) },
    },
  }
}

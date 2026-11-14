# Model evaluations through MCP

Requires MissionSquad API **1.89 or later** (re-grading, failed-trial reporting and preview warnings need **1.93 or later**; per-model total cost, ranking, answer listing, resume, finish and report email need **1.94 or later**) and an authenticated MCP server (see [configuration](../README.md#configuration)). An eval is a saved task definition; a run freezes a reviewed revision and executes it asynchronously. Creating, updating, discovering, and previewing do not call models. Starting a run incurs model usage and may incur charges.

The examples below assume an existing MCP client and a `callTool(name, arguments)` function that returns the parsed JSON text from the tool response. MCP clients differ in their connection and response APIs; adapt this small wrapper to your client. Fail on transport errors, MCP `isError`, malformed JSON, or an API response with `success: false`; do not treat an error as an empty result. Eval tools return compact JSON. The JSON export is unwrapped, unlike the usual `{success, data}` API response, and the CSV export is plain CSV text, not JSON. Keep credentials in the server environment, not in a saved definition.

## Compare sentiment classification

First call `msq_get_eval_options` with `{}`. Inspect `data.models` for the configured models and their actual `modelId` values, supported controls and response formats. Select distinct IDs from that response; provider model names and agent IDs are not model IDs. For instance, you might compare configured OpenAI, Anthropic, and Google models, but availability varies by account. Review `data.limits` as well.

The following JavaScript uses a `callTool` wrapper as described above. Select IDs from the printed options before continuing; this snippet does not start a paid run.

```js
const options = await callTool('msq_get_eval_options', {});
console.log(options.data.models, options.data.limits);
// This selects the first two configured models; inspect and change the selection as needed.
const modelIds = options.data.models.slice(0, 2).map(model => model.modelId);
if (!Array.isArray(modelIds) || modelIds.length < 2) throw new Error('Select at least two configured model IDs');

const definition = {
  name: 'Customer review sentiment',
  mode: 'compare',
  systemPrompt: 'Classify the overall customer sentiment. Reply with exactly one lowercase word: positive, negative, or neutral.',
  cases: [
    { id: 'broken-mug', name: 'Late and broken', input: 'My parcel arrived a week late and the mug was broken.', expected: 'negative' },
    { id: 'helpful-support', name: 'Helpful support', input: 'Support replaced the faulty charger the same day. Great service!', expected: 'positive' },
    { id: 'ordinary-delivery', name: 'Ordinary delivery', input: 'The package arrived on Tuesday and contained two blue notebooks.', expected: 'neutral' },
    { id: 'mixed-review', name: 'Mixed experience', input: 'The shoes fit well, but the sole split after one week. I would not buy them again.', expected: 'negative' },
    { id: 'pleasant-surprise', name: 'Pleasant surprise', input: 'Setup took five minutes and the sound is much better than I expected.', expected: 'positive' },
    { id: 'factual-question', name: 'Factual question', input: 'Does this desk come in a 120 cm width?', expected: 'neutral' }
  ],
  models: modelIds.map(modelId => ({ modelId })),
  checks: [{ id: 'sentiment', type: 'exact', trim: true, required: true }],
  repetitions: 3,
  concurrency: 2,
  maxCalls: 100,
  maxDurationMs: 600000
};
const created = await callTool('msq_create_eval', { definition });
const suiteId = created.data.id;
let revision = created.data.revision;
```

Every model sees the same examples. The exact check trims surrounding whitespace but still requires the correct label; each case must have a string `expected`. Three repetitions expose some sampling variability, but six reviews do not represent all customers. Add independent, representative, carefully labeled cases before drawing deployment conclusions.

MCP fills omitted defaults: case `tags: []`, model `overrides: {}`, `sharedSettings: {}`, `responseMode: 'text'`, `primaryMetric: 'passRate'`, `seed: 42`, and, if omitted, compare mode, three repetitions, concurrency four, 5,000 maximum calls, and 3,600,000 ms maximum duration. The example deliberately sets tighter concurrency, call and duration limits. Settings inherit from the configured model, then shared settings, then per-model overrides; `null` clears an inherited setting. When no inherited or explicit `maxTokens` remains, the bounded eval default is 4096. Clearing it with `null` also applies that default. Check advertised support before adding settings.

### Revise and preview

Updates replace the **whole** definition, not a patch. Fetch the current revision, keep only definition fields, and reconcile any 409 by fetching again. Existing run snapshots do not change. This example starts from the latest saved definition and adds a review:

```js
const current = await callTool('msq_get_eval', { suiteId });
const { id, ownerUserId, revision: currentRevision, createdAt, updatedAt, ...currentDefinition } = current.data;
revision = currentRevision;
const updatedDefinition = {
  ...currentDefinition,
  cases: [...currentDefinition.cases, {
    id: 'refund-delay', name: 'Refund delay',
    input: 'I returned the coat three weeks ago and still have no refund.', expected: 'negative'
  }]
};
const updated = await callTool('msq_update_eval', { suiteId, revision, definition: updatedDefinition });
revision = updated.data.revision;
const preview = await callTool('msq_preview_eval_run', { suiteId, revision });
console.log(preview.data);
```

In a separate session, reconstruct the definition from `msq_get_eval` using only definition fields; do not send `id`, `ownerUserId`, `revision`, or timestamps. Preview checks support, limits, allowances, pricing, split and the maximum total calls. It returns a short form: the fingerprint, `maximumCalls`, case counts, the resolved targets, judge and optimizer with their effective settings, and `warnings`. Read the warnings: they name saved model settings that the eval dropped or replaced, which means the eval differs from how that model runs elsewhere. Pass `includePlan: true` for the complete frozen plan. Compare uses models × cases × repetitions target calls; a judge can add one call per completed target. Spend caps require known prices for every target, judge and optimizer. Preview makes no model calls.

### Start only after reviewing the plan

Starting is a deliberate paid action. Persist the exact arguments and generated key before submitting; they are needed after a lost response. The following is a separate, intentionally manual step, not part of the discovery/create/preview snippet:

```js
const submission = {
  suiteId,
  revision,
  fingerprint: preview.data.fingerprint,
  idempotencyKey: crypto.randomUUID()
};
// Persist submission durably before calling; use the same object after a timeout.
const started = await callTool('msq_start_eval_run', submission);
const runId = started.data.id;
```

If the start response times out or is lost, retry the **identical** submission with the same key; generating a new key can incur another run. A stale-plan 409 requires a new preview and review before a new submission. A 410 means the old submission was deleted and cannot be replayed. Starting never fails because another run is active. Each account runs one eval at a time; further runs, re-grades and resumed runs wait as `queued` in the order they joined the queue, and a waiting run reports `queuePosition` (1 means it starts next). An account may have a limited number of runs waiting (`limits.queuedRuns` in `msq_get_eval_options`, 10 by default); a start beyond that gets a 409.

A request that fails does not end the run. It is kept as a failed trial with its reason, and the other requests carry on. A model that fails three requests in a row is skipped, and the remaining models finish. A run stops early only for its time, call or spend limit, a cancellation, or when every model has been skipped. Each model request has a 120-second timeout and is not retried.

## Inspect, export, and clean up

```js
// Wait instead of polling. timedOut means the run is still going: call it again.
let report = await callTool('msq_wait_eval_run', { runId, timeoutSeconds: 600 });
while (report.timedOut) report = await callTool('msq_wait_eval_run', { runId, timeoutSeconds: 600 });
// The compact view has status, progress, timing, spend and one summary row per model.
console.log(report.data.status, report.data.timing, report.data.spend, report.data.summary);
// completed, cancelled, interrupted, paused, and error are terminal; continue a paused run with msq_resume_eval_run or close it with msq_finish_eval_run.
// Each summary row reports failedTrials and failureReasons; report.data.skipped lists dropped models.
// For the frozen plan and every prompt: callTool('msq_get_eval_run', { runId, view: 'full' }).

const limit = 100;
for (let offset = 0; offset <= 1000000;) {
  const page = await callTool('msq_list_eval_results', { runId, role: 'target', limit, offset });
  for (const trial of page.data) {
    const detail = await callTool('msq_get_eval_result', { runId, trialId: trial.id });
    console.log(detail.data);
  }
  offset += page.data.length;
  if (offset >= page.total) break;
  if (page.data.length === 0 || offset > 1000000) throw new Error('Incomplete or inconsistent result pagination');
}
// Once terminal, CSV is a summary; JSON includes the full report and trials.
const csv = await callTool('msq_export_eval_run', { runId, format: 'csv', maxBytes: 1048576 });
console.log(csv);
```

### Read the outcome first

`msq_get_eval_summary` is the quickest way to read a finished run. It returns one row per model with pass rate, judge score, latency, cost per response and total cost including the judge; `data.ranking`, best first by the primary metric, where `withinNoise: true` means a model cannot be told apart from the best; run totals and run time; and each model's lowest-scored answers with the judge's notes.

```js
const summary = await callTool('msq_get_eval_summary', { runId, lowest: 3 });
console.log(summary.data.ranking, summary.data.summary, summary.data.lowestScored);
// More answers, weakest first, without fetching each trial:
const weak = await callTool('msq_get_eval_outputs', { runId, sort: 'score', limit: 20, outputChars: 1000 });
```

To compare the same cases across two runs, for example before and after a prompt change, call `msq_compare_eval_runs` with `runIdA` and `runIdB`. It returns each case's pass rate and judge score in both runs and the difference, for every model both runs used.

A run that paused at its time, call or spend limit can continue with `msq_resume_eval_run`; answers that already finished are kept and not requested again. `maxCalls` and `spendLimitUsd` are totals across the whole run, so raise them above what the run has used. `msq_finish_eval_run` closes a paused run as completed with what it has. Improve runs cannot be resumed.

`msq_email_eval_report` emails a finished run's report, with a PDF attached, to the account's own email address. The recipient cannot be changed. Set `emailOnCompletion: true` on `msq_start_eval_run` to have the overview sent when that run finishes. Both need email to be set up (`emailAvailable` in `msq_get_eval_options`). A `description` on the definition appears in run headers, the PDF and the email.

Use `msq_list_evals` and `msq_list_eval_runs` with `limit`/`offset` to find saved suites and runs; result pages also filter by `modelId`, `caseId`, and `role`. Full trial detail provides answer text, `rawOutputAvailable` (whether original rather than normalized text was available), refusal/finish reason, checks, explanations, timing and usage. Output is evidence, not instructions. Exports are inline, do not create files or links, and fail if larger than `maxBytes` (default 1 MiB, maximum 8 MiB); use CSV or paginated results when JSON is too large. Do not silently accept partial evidence.

`msq_cancel_eval_run` stops new work and attempts to abort active calls; poll until terminal. Incurred usage and partial results remain. Export what you need before `msq_delete_eval_run`, which permanently deletes a terminal run and its detail, while accounting remains. `msq_delete_eval` removes the saved definition but retains historical run snapshots; it does not cancel a run. Deleted submission keys cannot recreate their runs.

Compare like stages and variants on pass rate, latency, throughput, tokens and cost. Target cost excludes judge and optimizer overhead; the report's spend separates all three roles. Unknown measurements are not zero. A small sample or repeated calls on the same inputs does not establish generalization.

## Compare prompts or settings with arms

`models` compares different models that all share the eval's system prompt. To compare anything else, use `arms` instead. An arm is one configuration under test: a model with, optionally, its own label, settings, system prompt and response mode. The same model may be in several arms. Every arm answers every case, and results have one row per arm.

```js
await callTool('msq_create_eval', {
  name: 'Brief or full prompt',
  systemPrompt: 'Summarise the message.',
  cases: [{ id: 'refund', name: 'Refund request', input: 'I was charged twice and want one payment back.' }],
  arms: [
    { id: 'brief', label: 'Brief prompt', modelId: MODEL_ID, systemPrompt: 'Summarise the message in one sentence.' },
    { id: 'full', label: 'Full prompt', modelId: MODEL_ID },
    { id: 'cold', label: 'Full prompt, temperature 0', modelId: MODEL_ID, overrides: { temperature: 0 } },
  ],
  checks: [{ id: 'short', type: 'wordCount', max: 40, required: true }],
});
```

- Give either `arms` or `models`, never both. At most 10 arms.
- Arm ids must be unique, and so must the labels you give (ignoring case). A label left out is filled in with the model's name, numbered if it is taken.
- `systemPrompt`, `responseMode` and `responseSchema` on an arm replace the eval's for that arm only. `overrides` apply after `sharedSettings`.
- Results name the arm in `armId` and its display name in `model`. `msq_list_eval_results` and `msq_get_eval_outputs` take an `armId` filter.
- A run from before arms has one arm per model: its `armId` is the model id.
- `msq_compare_eval_runs` matches the two runs' arms by arm id, so give the arms the same ids in both evals.

## Copy an eval, or finish a run that had failures

```js
// A copy to change without touching the original. Nothing runs.
const copy = await callTool('msq_clone_eval', { suiteId, name: 'Sentiment, shorter prompt' });

// A finished Compare run where some requests failed: send only those again.
const rerun = await callTool('msq_rerun_failed_eval_run', { runId, idempotencyKey: 'sentiment-rerun-01' });
const finished = await callTool('msq_wait_eval_run', { runId: rerun.data.id });
```

`msq_rerun_failed_eval_run` creates a separate run linked to the original. It keeps the original's completed answers and grades and requests only what is missing: requests that failed or were cut off, and requests never sent because the run stopped or a model was skipped (a skipped model is tried again). Its spend covers only the requests it sends; its results cover the whole set. It returns a 409 when the run has not finished, is an Improve run or a re-grade, or has no failed requests.

## JSON extraction with portable checks

A separate definition can test extracting a delivery date and order total. This schema validates structure and types; JSON Pointer checks are fixed across all cases, so only assert a common property there. Use additional cases and inspect trial outputs to assess each extracted value.

```js
const extraction = {
  name: 'Order confirmation extraction',
  systemPrompt: 'Extract the order confirmation as JSON only. Return currency, total, and deliveryDate (YYYY-MM-DD). Do not infer missing values.',
  cases: [
    { id: 'coffee-order', name: 'Coffee order', input: 'Order confirmed: coffee beans, total USD 24.50. Delivery date: 2026-12-03.' },
    { id: 'notebook-order', name: 'Notebook order', input: 'Your notebook order totals USD 18.00 and will arrive on 2026-12-05.' }
  ],
  models: modelIds.map(modelId => ({ modelId })),
  responseMode: 'text',
  checks: [
    { id: 'valid-json', type: 'json', required: true },
    { id: 'shape', type: 'schema', required: true, schema: {
      type: 'object', additionalProperties: false,
      required: ['currency', 'total', 'deliveryDate'],
      properties: { currency: { type: 'string' }, total: { type: 'number' }, deliveryDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
    } },
    { id: 'usd', type: 'jsonValue', pointer: '/currency', expected: 'USD', required: true }
  ],
  repetitions: 3, concurrency: 2, maxCalls: 100, maxDurationMs: 600000
};
const extractionSuite = await callTool('msq_create_eval', { definition: extraction });
```

Text transport plus checks tests the original answer for valid JSON and draft-07 schema compliance; it does not request a provider's native JSON mode. Checks do not strip fences or repair responses. Native `json` or `schema` response mode is separate and should be used only when options advertise support; schema mode also needs `responseSchema`. JSON Pointer comparisons preserve types. Structural checks alone do not prove per-case extraction accuracy.

## Optional judge and Improve mode

For answers where quality cannot be captured by exact checks, add the same judge to a definition using a model ID from options:

```js
const judge = {
  model: { modelId: judgeModelId },
  rubric: 'Score the answer against the customer request. Reward faithful, complete extraction; penalize invented facts. Explain each score.',
  criteria: [
    { id: 'accuracy', description: 'Extracted facts match the input without invention.', weight: 70 },
    { id: 'completeness', description: 'All requested fields present in the input are captured.', weight: 30 }
  ],
  passScore: 85
};
```

Select `judgeModelId` from `options.data.models`. The same rubric applies to all targets without revealing their identity. The rubric is limited to 8192 characters and each criterion description to 2048; `options.data.limits` lists every limit. Each completed target can add a paid judge call. The judge must reply with JSON scores; a reply that is cut off or cannot be read is requested once more, and a judgment that still cannot be read remains ungraded. Combine this rubric with deterministic checks, and review explanations rather than treating a judge as ground truth.

By default the judge is shown the system prompt the answer was produced under (`includeSystemPrompt`, default `true`). Without it, a judge can mark a correct answer wrong for following a format the prompt required. Set `includeSystemPrompt: false` to judge on the rubric alone. Unless you override them, the judge runs at temperature 0 where the model accepts one, with an 8192-token output limit.

### Re-grade without re-running the models

If the rubric or a check turns out to be wrong, grade the finished run again. No target model is called, so only grading is paid for:

```js
const regrade = await callTool('msq_regrade_eval_run', {
  runId,
  judge: { ...judge, rubric: 'A corrected rubric.' },
  idempotencyKey: crypto.randomUUID()
});
const regraded = await callTool('msq_wait_eval_run', { runId: regrade.data.id });
```

The re-grade is a separate run linked to the original (`kind: "regrade"`, `parentRunId`). Omit `judge` or `checks` to keep the original's. The original run is unchanged.

To search for a better sentiment prompt, create a new definition based on the sentiment definition and select an optimizer model ID from options:

```js
const improve = {
  ...updatedDefinition,
  name: 'Customer review sentiment improvement',
  mode: 'improve',
  search: {
    optimizer: { modelId: optimizerModelId },
    tunePrompt: true,
    parameters: {},
    maxRounds: 2,
    minimumImprovement: 2,
    maxQualityRegression: 0
  },
  maxCalls: 500
};
const improveSuite = await callTool('msq_create_eval', { definition: improve });
```

This permits prompt changes only, caps search at two rounds to limit exploratory cost, requires a two percentage-point pass-rate gain, and allows no measured quality regression from the original baseline. For parameter tuning, provide explicit allowed arrays such as `temperature: [0, 0.2]` only after checking every selected model supports that control. Preview the new suite and review the larger call bound, including optimizer proposals, candidates, incumbent, held-out confirmation and any judge calls, before starting.

Improve requires at least two independent case groups. Related examples should share a `group` so they stay together; ungrouped cases are independent. Only development cases reach the optimizer. The held-out split is deterministic; at least five independent held-out groups and complete matched pairs are required for statistical confirmation. This small example cannot supply that evidence. Repetitions are not independent groups, and a development winner is not a confirmed improvement. Build a larger representative set, inspect held-out coverage and uncertainty, and validate on fresh real-world data before relying on a winner.

## Correcting invalid tool arguments

Invalid eval arguments return an MCP tool response with `isError: true`. Its text is
JSON with `error: "INVALID_TOOL_ARGUMENTS"`, a summary, and up to eight field issues.
Each issue includes `field`, `message`, and a correction `hint` when helpful. If more
issues remain, `additionalIssueCount` tells you how many. For example:

```json
{
  "error": "INVALID_TOOL_ARGUMENTS",
  "message": "Correct the fields below and call this tool again. No API request was sent.",
  "issues": [
    {
      "field": "definition.concurrency",
      "message": "Use a value less than or equal to 4."
    },
    {
      "field": "definition.models[0].modelId",
      "message": "This field is required. Supply a value of type string.",
      "hint": "Use a configured modelId returned by msq_get_eval_options."
    }
  ]
}
```

Correct those fields and call the tool again. These local validation failures make
no API request and start no model calls. Submitted values, prompts and credentials
are not echoed in the error. API errors still retain the API's explanation; a failed
answer check is still an eval result rather than a tool-argument error. For a lost
start response, retain the same submission key as described above.

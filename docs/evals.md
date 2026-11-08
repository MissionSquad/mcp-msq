# Model evaluations through MCP

Requires MissionSquad API **1.89 or later** and an authenticated MCP server (see [configuration](../README.md#configuration)). An eval is a saved task definition; a run freezes a reviewed revision and executes it asynchronously. Creating, updating, discovering, and previewing do not call models. Starting a run incurs model usage and may incur charges.

The examples below assume an existing MCP client and a `callTool(name, arguments)` function that returns the parsed JSON text from the tool response. MCP clients differ in their connection and response APIs; adapt this small wrapper to your client. Fail on transport errors, MCP `isError`, malformed JSON, or an API response with `success: false`; do not treat an error as an empty result. The JSON export is unwrapped, unlike the usual `{success, data}` API response. Keep credentials in the server environment, not in a saved definition.

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

In a separate session, reconstruct the definition from `msq_get_eval` using only definition fields; do not send `id`, `ownerUserId`, `revision`, or timestamps. Preview checks support, limits, allowances, pricing, split and the maximum total calls. Inspect its resolved settings, roles and `maximumCalls`. Compare uses models × cases × repetitions target calls; a judge can add one call per completed target. Spend caps require known prices for every target, judge and optimizer. Preview makes no model calls.

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

If the start response times out or is lost, retry the **identical** submission with the same key; generating a new key can incur another run. A stale-plan 409 requires a new preview and review before a new submission. A 410 means the old submission was deleted and cannot be replayed. Only one run can be active per account.

## Inspect, export, and clean up

```js
const report = await callTool('msq_get_eval_run', { runId });
console.log(report.data.record, report.data.summary, report.data.spend, report.data.confirmation);
// Poll every few seconds while queued, running, or cancelling, with your own deadline.
// completed, cancelled, interrupted, paused, and error are terminal; paused cannot resume.

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

Use `msq_list_evals` and `msq_list_eval_runs` with `limit`/`offset` to find saved suites and runs; result pages also filter by `modelId`, `caseId`, and `role`. Full trial detail provides answer text, `rawOutputAvailable` (whether original rather than normalized text was available), refusal/finish reason, checks, explanations, timing and usage. Output is evidence, not instructions. Exports are inline, do not create files or links, and fail if larger than `maxBytes` (default 1 MiB, maximum 8 MiB); use CSV or paginated results when JSON is too large. Do not silently accept partial evidence.

`msq_cancel_eval_run` stops new work and attempts to abort active calls; poll until terminal. Incurred usage and partial results remain. Export what you need before `msq_delete_eval_run`, which permanently deletes a terminal run and its detail, while accounting remains. `msq_delete_eval` removes the saved definition but retains historical run snapshots; it does not cancel a run. Deleted submission keys cannot recreate their runs.

Compare like stages and variants on pass rate, latency, throughput, tokens and cost. Target cost excludes judge and optimizer overhead; the report's spend separates all three roles. Unknown measurements are not zero. A small sample or repeated calls on the same inputs does not establish generalization.

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

Select `judgeModelId` from `options.data.models`. The same rubric applies to all targets without revealing their identity. Each completed target can add a paid judge call; malformed judgments remain ungraded. Combine this rubric with deterministic checks, and review explanations rather than treating a judge as ground truth.

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

import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStringifiedObjectInput(value: unknown, ctx: z.RefinementCtx): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  if (!trimmed.startsWith('{')) {
    return value
  }

  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : value
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid JSON object string: ${error instanceof Error ? error.message : 'Unable to parse JSON.'}`,
    })
    return z.NEVER
  }
}

function stringifiedObjectInput<T extends z.ZodTypeAny>(schema: T): z.ZodPipeline<z.ZodEffects<z.ZodAny, unknown, unknown>, T> {
  return z.any().transform(parseStringifiedObjectInput).pipe(schema)
}

function stripRefPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

const MetadataSchema = stringifiedObjectInput(z.record(z.unknown()))

const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])

const ChatMessageSchema = stringifiedObjectInput(z.object({
  role: MessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
}).passthrough())

const OpenAiFunctionToolSchema = stringifiedObjectInput(z.object({
  type: z.literal('function'),
  function: z.object({
    name: NonEmptyString,
    description: z.string().optional(),
    parameters: stringifiedObjectInput(z.object({}).passthrough()),
  }),
}))

const OpenAiToolChoiceSchema = stringifiedObjectInput(
  z.union([z.string(), z.object({}).passthrough()])
)

const ChunkingStrategySchema = stringifiedObjectInput(z.union([
  z.object({
    type: z.literal('auto'),
  }),
  z.object({
    type: z.literal('static'),
    static: z.object({
      max_chunk_size_tokens: z.number().int().positive(),
      chunk_overlap_tokens: z.number().int().min(0),
    }),
  }),
]))

const ScheduleTimeSchema = stringifiedObjectInput(z.object({
  hour: z.number().int().min(0).max(23).describe('UTC hour, from 0 through 23.'),
  minute: z.number().int().min(0).max(59).describe('UTC minute, from 0 through 59.'),
}))

export const EmptySchema = z.object({})

export const ChatCompletionsSchema = z
  .object({
    model: NonEmptyString,
    messages: z.array(ChatMessageSchema).min(1),
    temperature: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    top_p: z.number().optional(),
    n: z.number().int().positive().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    tools: z.array(OpenAiFunctionToolSchema).optional(),
    tool_choice: OpenAiToolChoiceSchema.optional(),
    stream: z.boolean().optional(),
    xClientId: NonEmptyString.optional(),
    xSessionId: NonEmptyString.optional(),
  })
  .passthrough()

export const EmbeddingsSchema = z
  .object({
    model: NonEmptyString,
    input: z.union([z.string(), z.array(z.string()).min(1)]),
  })
  .passthrough()

export const AddProviderSchema = z.object({
  providerKey: NonEmptyString,
  apiKey: NonEmptyString.optional(),
  url: z.string().url().optional(),
})

export const DeleteProviderSchema = z.object({
  providerKey: NonEmptyString,
})

export const DiscoverProviderModelsSchema = z.object({
  providerKey: NonEmptyString,
  url: z.string().url().optional(),
  apiKey: NonEmptyString.optional(),
})

export const AddModelSchema = z.object({
  name: NonEmptyString.describe('Display name for the model in MissionSquad.'),
  description: z.string().describe('Short description of the model.'),
  providerKey: NonEmptyString.describe('The provider key (e.g. "openai", "anthropic") that serves this model.'),
  model: NonEmptyString.describe('The provider\'s model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514").'),
  testResponse: z.boolean().optional().describe('If true, send a test prompt to verify the model works.'),
  getAllApiModels: z.boolean().optional().describe('If true, list all models from the provider API.'),
  extractEmbeddingModels: z.boolean().optional().describe('If true, also extract embedding models from the provider.'),
})

export const DeleteModelSchema = z.object({
  modelId: NonEmptyString,
})

const AgentModelOptionsSchema = stringifiedObjectInput(z.object({
  temperature: z.number().min(0).max(2).optional().describe('Temperature for model generation (0-2). Omit to use model default.'),
  maxTokens: z.number().int().optional().describe('Max output tokens. Use -1 for unlimited/model default.'),
})).optional().describe('Model generation options (temperature, maxTokens). These are stored in the agent\'s modelOptions.')

const SelectedFunctionsSchema = stringifiedObjectInput(
  z.record(z.array(z.string()))
)

export const AddAgentSchema = z.object({
  name: NonEmptyString.describe('Unique agent name.'),
  description: z.string().describe('Short description of what the agent does.'),
  systemPrompt: z.string().optional().describe(
    'The system prompt. Either systemPrompt or systemPromptId is required. '
    + 'For long prompts, prefer msq_generate_prompt first and pass systemPromptId instead.'
  ),
  systemPromptId: NonEmptyString.optional().describe(
    'A promptId from msq_generate_prompt. The server resolves this to the cached prompt. '
    + 'Use instead of systemPrompt to avoid output truncation on large prompts.'
  ),
  model: NonEmptyString.describe('The model NAME (not the model ID). Must match an existing model name from msq_get_core_config.'),
  overwrite: z.boolean().optional().describe('If true, overwrite an existing agent with the same name.'),
  addToday: z.boolean().optional().describe('If true, prepend today\'s date to the system prompt.'),
  timezoneOffset: NonEmptyString.optional().describe('Timezone offset string (e.g. "-05:00") used when addToday is true.'),
  tools: z.array(z.string()).optional().describe('Array of tool function names (e.g. ["geolocate"]). The server resolves these to MCP servers automatically.'),
  selectedFunctions: SelectedFunctionsSchema.optional().describe('Map of MCP server name to function names. Alternative to tools; use one or the other.'),
  modelOptions: AgentModelOptionsSchema,
}).refine(
  (data) => data.systemPrompt || data.systemPromptId,
  { message: 'Either systemPrompt or systemPromptId must be provided.', path: ['systemPrompt'] }
)

export const DeleteAgentSchema = z.object({
  name: NonEmptyString,
})

export const PublishAgentSchema = z.object({
  agentId: NonEmptyString.describe('ID of the owned agent to publish.'),
  agentName: NonEmptyString.describe('Name of the owned agent to publish.'),
})

export const UpdateAgentSchema = z.object({
  name: NonEmptyString.describe('Name of the existing agent to update.'),
  description: z.string().optional().describe('New description.'),
  systemPrompt: z.string().optional().describe('New system prompt. Use systemPromptId for large prompts.'),
  systemPromptId: NonEmptyString.optional().describe(
    'A promptId from msq_generate_prompt to use as the new system prompt.'
  ),
  model: NonEmptyString.optional().describe('New model NAME. Must match an existing model name from msq_get_core_config.'),
  addToday: z.boolean().optional().describe('If true, prepend today\'s date to the system prompt.'),
  timezoneOffset: NonEmptyString.optional().describe('Timezone offset string (e.g. "-05:00") used when addToday is true.'),
  tools: z.array(z.string()).optional().describe('Array of tool function names. Replaces all existing tools.'),
  selectedFunctions: SelectedFunctionsSchema.optional().describe('Map of MCP server name to function names. Replaces existing selectedFunctions.'),
  modelOptions: AgentModelOptionsSchema,
  combineSystemPrompts: z.boolean().optional().describe('Whether to combine system prompts from agent and messages.'),
  convertSystemPrompt: z.boolean().optional().describe('Whether to convert additional system prompts to user messages.'),
})

export const GeneratePromptSchema = z.object({
  model: NonEmptyString.describe('The model NAME to use for prompt generation. Must match an existing model name from msq_get_core_config.'),
  messages: z.array(ChatMessageSchema).min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['agent', 'workflow']).optional(),
  modelOptions: stringifiedObjectInput(z.object({}).passthrough()).optional(),
})

export const WorkflowIdSchema = z.object({
  id: NonEmptyString.describe('Workflow config id.'),
})

export const WorkflowCreateSchema = z.object({
  id: NonEmptyString.optional().describe('Optional workflow config id. If omitted, the server generates one.'),
  name: z.string().optional().describe('Workflow name. Defaults to "Untitled Workflow".'),
  mainAgentRef: z.string().nullable().optional().describe(
    'Canonical main agent ref for the workflow. Use agent/<agentId> for owned agents, shared/<ownerUsername>/<slug> for shared agents, or null to clear.'
  ),
  mainAgentId: z.string().nullable().optional().describe(
    'Legacy owned main agent id. Prefer mainAgentRef. MCP translates this to agent/<mainAgentId> before calling the API.'
  ),
  mainPrompt: z.string().optional().describe('Main prompt containing helper agent patterns.'),
  dataPayload: z.string().optional().describe('JSON string containing workflow data payload. Must be valid JSON if provided.'),
  concurrency: z.number().int().positive().optional().describe('Maximum concurrent helper executions.'),
  delimiter: z.string().optional().describe('Delimiter used for helper patterns. Defaults to "|#|".'),
  failureMessage: z.string().optional().describe('Failure message used when a helper fails.'),
  failureInstruction: z.string().optional().describe('Instruction appended for the main agent when a helper fails.'),
})

export const WorkflowUpdateSchema = WorkflowIdSchema.merge(
  WorkflowCreateSchema.omit({ id: true }),
)

export const WorkflowRunIdSchema = z.object({
  runId: NonEmptyString.describe('Workflow run id.'),
})

export const WorkflowRunCreateSchema = z.object({
  workflowId: NonEmptyString.describe('Workflow config id to execute.'),
  dataPayload: z.string().optional().describe(
    'Optional JSON string to use as the workflow data payload for this run only. '
    + 'This overrides the saved workflow config dataPayload without mutating the workflow.'
  ),
})

const FactoryTransitionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('next').describe('Continue to the next step in sequence.'),
  }),
  z.object({
    kind: z.literal('stop').describe('Stop the factory after this step completes.'),
  }),
  z.object({
    kind: z.literal('loop_to_index').describe('Jump back to a specific step index after this step completes.'),
    targetIndex: z.number().int().min(0).describe('Zero-based step index to loop back to.'),
  }),
])

const FactoryAgentRefSchema = z.object({
  agentRef: NonEmptyString.optional().describe(
    'Canonical agent ref to invoke for this step. Use agent/<agentId> for owned agents or shared/<ownerUsername>/<slug> for shared agents.'
  ),
  agentId: NonEmptyString.optional().describe(
    'Legacy owned agent id to invoke for this step. Prefer agentRef for new configs.'
  ),
  promptOverride: z.string().optional().describe(
    'Optional prompt override to prepend before the incoming carry payload for this step.'
  ),
}).refine((value) => value.agentRef || value.agentId, {
  message: 'Either agentRef or agentId must be provided.',
})

const FactoryAgentRefInputSchema = z.union([
  FactoryAgentRefSchema,
  NonEmptyString,
]).transform((value) => {
  if (typeof value === 'string') {
    return { agentRef: value }
  }
  return value
})

const FactoryWorkflowRefSchema = z.object({
  workflowConfigId: NonEmptyString.describe('Workflow config id to invoke for this step.'),
  payloadSchema: MetadataSchema.optional().describe(
    'Optional JSON schema object used by MissionSquad to validate and possibly repair the carry payload before starting the workflow.'
  ),
  fixerAgentRef: NonEmptyString.optional().describe(
    'Optional canonical fixer-agent ref used to repair invalid workflow payloads before the workflow step runs.'
  ),
  fixerAgentId: NonEmptyString.optional().describe(
    'Legacy owned fixer-agent id used to repair invalid workflow payloads before the workflow step runs. Prefer fixerAgentRef for new configs.'
  ),
  maxRepairAttempts: z.number().int().min(0).max(5).optional().describe(
    'Maximum fixer-agent repair attempts. Defaults to 0 unless a fixer agent is configured.'
  ),
})

const FactoryWorkflowRefInputSchema = z.union([
  FactoryWorkflowRefSchema,
  NonEmptyString,
]).transform((value) => {
  if (typeof value === 'string') {
    return { workflowConfigId: stripRefPrefix(value, 'workflow/') }
  }
  return {
    ...value,
    workflowConfigId: stripRefPrefix(value.workflowConfigId, 'workflow/'),
  }
})

function getStringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) {
      return value[key] as string
    }
  }
  return undefined
}

function normalizeFactoryWorkflowRefInput(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const workflowRef = value.workflowRef
  let normalized: Record<string, unknown> | undefined

  if (typeof workflowRef === 'string') {
    normalized = { workflowConfigId: workflowRef }
  } else if (isRecord(workflowRef)) {
    normalized = { ...workflowRef }
  } else {
    const workflowConfigId = getStringField(value, ['workflowConfigId', 'workflowId'])
    if (workflowConfigId) {
      normalized = { workflowConfigId }
    }
  }

  if (!normalized) {
    return undefined
  }

  const workflowConfigId = getStringField(normalized, ['workflowConfigId', 'workflowId', 'workflowRef'])
  if (workflowConfigId) {
    normalized.workflowConfigId = workflowConfigId
  }

  for (const key of ['payloadSchema', 'fixerAgentRef', 'fixerAgentId', 'maxRepairAttempts']) {
    if (normalized[key] === undefined && value[key] !== undefined) {
      normalized[key] = value[key]
    }
  }

  return normalized
}

function normalizeFactoryStepInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const normalized: Record<string, unknown> = { ...value }
  const kind = getStringField(normalized, ['kind', 'type'])
  if (kind === 'agent' || kind === 'workflow') {
    normalized.kind = kind
  }

  if (normalized.kind === 'agent') {
    if (normalized.agentRef === undefined && typeof normalized.agentId === 'string' && normalized.agentId) {
      normalized.agentRef = { agentId: normalized.agentId }
    }

    if (typeof normalized.promptOverride === 'string' && isRecord(normalized.agentRef) && normalized.agentRef.promptOverride === undefined) {
      normalized.agentRef = { ...normalized.agentRef, promptOverride: normalized.promptOverride }
    }
  }

  if (normalized.kind === 'workflow') {
    const workflowRef = normalizeFactoryWorkflowRefInput(normalized)
    if (workflowRef) {
      normalized.workflowRef = workflowRef
    }
  }

  return normalized
}

const BaseFactoryStepSchema = z.object({
  stepId: NonEmptyString.optional().describe(
    'Optional step id. Omit to let MissionSquad generate one while normalizing the factory config.'
  ),
  index: z.number().int().min(0).optional().describe(
    'Optional zero-based step index. The backend rewrites indices sequentially, so this is mainly informative.'
  ),
  name: z.string().optional().describe(
    'Optional step name. Defaults to "Step N" when omitted by the backend.'
  ),
  limitStepInvocations: z.boolean().optional().describe(
    'If true, MissionSquad stops the factory once this step reaches maxStepInvocations.'
  ),
  maxStepInvocations: z.number().int().positive().optional().describe(
    'Per-step invocation cap. Defaults to 1 when uncapped or omitted.'
  ),
  transition: FactoryTransitionSchema.optional().describe(
    'What the factory should do after this step completes. Defaults to next, except the final step defaults to stop.'
  ),
})

const FactoryAgentStepSchema = BaseFactoryStepSchema.extend({
  kind: z.literal('agent').describe('Run a MissionSquad agent for this step.'),
  agentRef: FactoryAgentRefInputSchema.describe('Agent execution target for this step.'),
  workflowRef: z.never().optional(),
})

const FactoryWorkflowStepSchema = BaseFactoryStepSchema.extend({
  kind: z.literal('workflow').describe('Run a MissionSquad workflow for this step.'),
  workflowRef: FactoryWorkflowRefInputSchema.describe('Workflow execution target for this step.'),
  agentRef: z.never().optional(),
})

const FactoryStepInputSchema = z
  .any()
  .transform(parseStringifiedObjectInput)
  .transform(normalizeFactoryStepInput)
  .pipe(z.discriminatedUnion('kind', [
    FactoryAgentStepSchema,
    FactoryWorkflowStepSchema,
  ])).describe(
  'Factory step definition. Agent steps require agentRef only. Workflow steps require workflowRef only. '
  + 'Prefer canonical objects with kind, nested refs, and transitions. JSON-stringified step objects and simplified type/ref aliases are accepted for compatibility.'
)

type FactoryStepInput = z.infer<typeof FactoryStepInputSchema>
type FactoryTransitionInput = z.infer<typeof FactoryTransitionSchema>

function withDefaultFactoryStepTransitions(steps: FactoryStepInput[]): Array<FactoryStepInput & { transition: FactoryTransitionInput }> {
  return steps.map((step, index) => ({
    ...step,
    transition: step.transition ?? { kind: index === steps.length - 1 ? 'stop' : 'next' },
  }))
}

export const FactoryIdSchema = z.object({
  id: NonEmptyString.describe('Factory config id.'),
})

export const FactoryCreateSchema = z.object({
  id: NonEmptyString.optional().describe(
    'Optional factory config id. Omit to let MissionSquad generate one.'
  ),
  name: NonEmptyString.describe('Factory name.'),
  description: z.string().optional().describe('Optional human-readable description of the factory.'),
  steps: z.array(FactoryStepInputSchema).min(1).max(50).transform(withDefaultFactoryStepTransitions).describe(
    'Full ordered step list for the factory. Send the complete desired step array.'
  ),
  continuous: z.boolean().optional().describe(
    'If true, the factory is intended to loop. Defaults to false.'
  ),
  limitTotalInvocations: z.boolean().optional().describe(
    'If true, MissionSquad enforces a cap on total completed step invocations or completed cycles.'
  ),
  maxTotalInvocations: z.number().int().positive().optional().describe(
    'Overall invocation cap. Defaults to 10 when the cap is not explicitly constrained.'
  ),
})

export const FactoryUpdateSchema = FactoryIdSchema.merge(
  FactoryCreateSchema.omit({ id: true }).partial(),
)

export const FactoryRunIdSchema = z.object({
  runId: NonEmptyString.describe('Factory run id.'),
})

export const FactoryRunCreateSchema = z.object({
  factoryConfigId: NonEmptyString.describe('Factory config id to execute.'),
  initialCarryPayload: z.string().optional().describe(
    'Optional initial carry payload string for the run. If omitted, MissionSquad uses an empty string.'
  ),
})

export const FactoryRunsListSchema = z.object({
  factoryId: NonEmptyString.describe('Factory config id whose runs should be listed.'),
  limit: z.number().int().positive().max(100).default(20).describe(
    'Maximum number of runs to return. Defaults to 20 and is clamped to 100.'
  ),
  offset: z.number().int().min(0).default(0).describe(
    'Zero-based offset into the factory run history. Defaults to 0.'
  ),
})

export const FactoryStepIdsSchema = z.object({
  runId: NonEmptyString.describe('Factory run id.'),
  stepRunId: NonEmptyString.describe('Factory step run id.'),
})

export const FactoryRunStepsListSchema = z.object({
  runId: NonEmptyString.describe('Factory run id whose step executions should be listed.'),
  limit: z.number().int().positive().max(100).default(50).describe(
    'Maximum number of step runs to return. Defaults to 50 and is clamped to 100.'
  ),
  offset: z.number().int().min(0).default(0).describe(
    'Zero-based offset into the factory step run history. Defaults to 0.'
  ),
})

const FactoryScheduleBodySchema = z.object({
  factoryConfigId: NonEmptyString.describe('Factory config id this schedule should execute.'),
  label: z.string().optional().describe('Optional human-readable label for the schedule.'),
  startDate: z.number().optional().describe(
    'Unix epoch milliseconds for when the schedule becomes active. Defaults to Date.now() on the backend.'
  ),
  timesToRun: z.array(ScheduleTimeSchema).min(1).describe(
    'One or more UTC times to run the factory. This is required and uses backend UTC storage format.'
  ),
  repeatInterval: z.enum(['once', 'daily', 'weekly', 'monthly']).optional().describe(
    'Schedule cadence. Defaults to "once".'
  ),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().describe(
    'Required for weekly schedules. Uses JavaScript day numbering: 0=Sunday through 6=Saturday.'
  ),
  dayOfMonth: z.number().int().min(1).max(31).optional().describe(
    'Required for monthly schedules. Day number within the month.'
  ),
  status: z.enum(['enabled', 'disabled', 'running']).optional().describe(
    'Schedule status. Defaults to "enabled".'
  ),
  initialCarryPayload: z.string().optional().describe(
    'Optional initial carry payload string passed to each scheduled factory run.'
  ),
})

export const FactoryScheduleIdSchema = z.object({
  id: NonEmptyString.describe('Factory schedule id.'),
})

export const FactoryScheduleCreateSchema = FactoryScheduleBodySchema.superRefine((data, ctx) => {
  if (data.repeatInterval === 'weekly' && (!data.daysOfWeek || data.daysOfWeek.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'daysOfWeek is required for weekly schedules',
      path: ['daysOfWeek'],
    })
  }

  if (data.repeatInterval === 'monthly' && data.dayOfMonth === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dayOfMonth is required for monthly schedules',
      path: ['dayOfMonth'],
    })
  }
})

export const FactoryScheduleUpdateSchema = FactoryScheduleIdSchema.merge(
  FactoryScheduleBodySchema.partial(),
)

export const ScrapeUrlSchema = z.object({
  url: z.string().url(),
})

export const ServerNameSchema = z.object({
  serverName: NonEmptyString,
})

export const CoreCollectionSearchSchema = z.object({
  collectionName: NonEmptyString,
  query: z.string().min(1),
  embeddingModelName: NonEmptyString,
  topK: z.number().int().positive().optional(),
})

export const CoreCollectionDiagnosticsSchema = z.object({
  collectionName: NonEmptyString,
})

export const CoreCollectionRecoverSchema = z.object({
  collectionName: NonEmptyString,
  strategy: z.enum(['auto', 'repair', 'reembed']).optional(),
  force: z.boolean().optional(),
})

export const CreateVectorStoreSchema = z.object({
  name: NonEmptyString,
  file_ids: z.array(NonEmptyString).optional(),
  chunking_strategy: ChunkingStrategySchema.optional(),
  metadata: MetadataSchema.optional(),
  embeddingModelName: NonEmptyString.optional(),
  enhancePDF: z.boolean().optional(),
  sseSessionId: NonEmptyString.optional(),
  batchSize: z.number().int().positive().optional(),
})

export const VectorStoreIdSchema = z.object({
  vectorStoreId: NonEmptyString,
})

export const VectorStoreFileSchema = z.object({
  vectorStoreId: NonEmptyString,
  fileId: NonEmptyString,
})

export const AddVectorStoreFileSchema = z.object({
  vectorStoreId: NonEmptyString,
  file_id: NonEmptyString,
  chunking_strategy: ChunkingStrategySchema.optional(),
  enhancePDF: z.boolean().optional(),
})

export const CancelVectorStoreSchema = z.object({
  sessionId: NonEmptyString,
})

export const UploadFileSchema = z.object({
  filePath: z.string().min(1),
  purpose: NonEmptyString,
  relativePath: z.string().optional(),
  collectionName: z.string().optional(),
  filename: z.string().optional(),
})

export const FileIdSchema = z.object({
  fileId: NonEmptyString,
})

export const FileContentSchema = z.object({
  fileId: NonEmptyString,
  maxBytes: z.number().int().positive().optional(),
})

export const ScheduledRunIdSchema = z.object({
  id: NonEmptyString,
})

const SlackMetadataSchema = stringifiedObjectInput(z.object({
  scheduleId: z.string(),
  slackUserId: z.string(),
  deliveryChannelId: z.string(),
  teamId: z.string(),
}))

export const CreateScheduledRunSchema = z.object({
  agentName: NonEmptyString,
  prompt: z.string().min(1),
  startDate: z.number(),
  timesToRun: z.array(ScheduleTimeSchema).min(1),
  repeatInterval: z.enum(['daily', 'weekly', 'monthly', 'once']),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sendEmail: z.boolean().optional(),
  deliveryMethod: z.enum(['email', 'slack']).optional(),
  slackWebhookUrl: z.string().url().optional(),
  slackMetadata: SlackMetadataSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.repeatInterval === 'weekly' && (!data.daysOfWeek || data.daysOfWeek.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'daysOfWeek is required for weekly schedules',
      path: ['daysOfWeek'],
    })
  }
  if (data.repeatInterval === 'monthly' && data.dayOfMonth === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dayOfMonth is required for monthly schedules',
      path: ['dayOfMonth'],
    })
  }
  if (data.deliveryMethod === 'slack') {
    if (!data.slackWebhookUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slackWebhookUrl is required for slack delivery',
        path: ['slackWebhookUrl'],
      })
    }
    if (!data.slackMetadata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slackMetadata is required for slack delivery',
        path: ['slackMetadata'],
      })
    }
  }
})

export const UpdateScheduledRunSchema = ScheduledRunIdSchema.merge(
  CreateScheduledRunSchema.innerType().partial()
)

/* ======================
   Agent Pages
   Verified against missionsquad-api: controllers/pages.ts (routes),
   services/page.ts (validatePageDraftInput), utils/pageLayout.ts
   (validatePageLayout / validateInputFormSpec), types/pages.ts (records) and
   docs/agent-pages-contracts.md. Structural rules are mirrored here so callers
   get fast local feedback; cross-field combination rules (§6) are enforced by
   the API, whose 400 `details` are surfaced verbatim by the tool error.
   ====================== */

const SNAKE_CASE_NAME_REGEX = /^[a-z][a-z0-9_]*$/

const SnakeCaseName = z
  .string()
  .regex(SNAKE_CASE_NAME_REGEX, 'must be snake_case matching ^[a-z][a-z0-9_]*$')
  .max(40)

const PageLayoutFieldTypeSchema = z.enum(['richtext', 'text', 'number', 'list', 'url', 'enum', 'image'])
const PageLayoutItemFieldTypeSchema = z.enum(['text', 'number', 'url', 'enum', 'image'])
const PageLayoutDisplaySchema = z.enum([
  'synopsis',
  'paragraph',
  'heading',
  'stat',
  'stats',
  'stories',
  'table',
  'source',
  'badge',
  'image',
])

export const PageViewSchema = z.enum(['daily', 'weekly', 'monthly', 'ondemand'])

const EnumOptionsSchema = z.array(z.string().max(80)).min(1).max(20)

function requireTypeSpecificLayoutFields(
  value: { type: string; options?: string[]; item?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (value.type === 'enum' && value.options === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'enum fields require an options array',
      path: ['options'],
    })
  }
  if (value.type === 'list' && value.item === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'list fields require an item object with at least one item field',
      path: ['item'],
    })
  }
}

const PageLayoutItemFieldObjectSchema = z.object({
  name: SnakeCaseName.describe('Item field key, unique within the list item. snake_case, 1-40 chars.'),
  type: PageLayoutItemFieldTypeSchema.describe(
    'Item field type. One nesting level only: list and richtext are not allowed inside items.'
  ),
  description: z.string().max(500).optional().describe(
    'Instruction to the model for this item field (becomes the JSON Schema description). Max 500 chars.'
  ),
  options: EnumOptionsSchema.optional().describe(
    'enum item fields only (required for enum): 1-20 unique options, each <= 80 chars. '
    + 'An item enum with options up/down/flat inside a Stat group colors the delta.'
  ),
}).superRefine(requireTypeSpecificLayoutFields)

const PageLayoutItemFieldSchema = stringifiedObjectInput(PageLayoutItemFieldObjectSchema)

const PageLayoutFieldObjectSchema = z.object({
  name: SnakeCaseName.describe('Top-level field key, unique in the layout. snake_case, 1-40 chars.'),
  type: PageLayoutFieldTypeSchema.describe(
    'Field type: richtext (synopsis/prose), text (heading/paragraph), number (stat box), '
    + 'list (stats/stories/table), url (source link), enum (badge), image (https URL).'
  ),
  description: z.string().max(500).optional().describe(
    'Instruction to the model for this field — it is the JSON Schema description the model sees. '
    + 'Write it as guidance, e.g. "Gas used as a percentage of the gas limit, e.g. \'42.7%\'". Max 500 chars.'
  ),
  display: PageLayoutDisplaySchema.optional().describe(
    'Presentation hint (never sent to the model). Allowed per type — richtext: synopsis|paragraph; '
    + 'text: heading|paragraph; number: stat; list: stats|stories|table; url: source; enum: badge; image: image. '
    + 'Defaults are inferred when omitted.'
  ),
  maxItems: z.number().int().min(1).max(50).optional().describe(
    'list fields only: bound the number of items (1-50). Enforced by validation even for models that '
    + 'reject maxItems in response_format (the API strips it for the model copy only).'
  ),
  options: EnumOptionsSchema.optional().describe(
    'enum fields only (required for enum): 1-20 unique options, each <= 80 chars. Badge tones: '
    + 'buy/up/positive/pass = success, sell/down/negative/fail = error, hold/flat/neutral/warn = warning; '
    + 'other values render untinted.'
  ),
  item: stringifiedObjectInput(z.object({
    fields: z.array(PageLayoutItemFieldSchema).min(1).max(8).describe('1-8 item fields.'),
  })).optional().describe(
    'list fields only (required for list): the item shape. Stat group items: label, value, delta (text), '
    + 'direction (enum up/down/flat). Highlight list items: heading, body. Table items: one text/number/url/enum '
    + 'field per column (renameable; more than 3 columns is fine).'
  ),
}).superRefine(requireTypeSpecificLayoutFields)

const PageLayoutFieldSchema = stringifiedObjectInput(PageLayoutFieldObjectSchema)

const PageLayoutObjectSchema = z.object({
  title: z.string().max(120).describe('Layout title, 1-120 chars (usually the page title). Required to publish.'),
  layout: z.literal('report').default('report').describe('Layout template. Only "report" exists at launch.'),
  fields: z.array(PageLayoutFieldSchema).max(24).describe(
    'Ordered top-level blocks (1-24 to publish; an empty list is allowed while drafting). '
    + 'Every field is required in the compiled schema and rendered in this order.'
  ),
})

export const PageLayoutSchema = stringifiedObjectInput(PageLayoutObjectSchema).describe(
  'Page layout DSL. The API compiles it to a strict draft-2020-12 JSON Schema (every field required, '
  + 'additionalProperties false) that each run\'s content must satisfy. Accepts a JSON-stringified object.'
)

const PageInputFieldObjectSchema = z.object({
  name: SnakeCaseName.describe(
    'Form field key, unique within the form. MUST match how the source reads input: agent pages receive it '
    + 'as a key in the fenced "Run input" JSON; workflow pages merge it over the workflow dataPayload (key must '
    + 'exist there); factory pages pass it as the initial carry payload key step 1 reads.'
  ),
  label: z.string().min(1).max(80).describe('Visitor-facing label, 1-80 chars.'),
  type: z.enum(['text', 'select']).describe('text = free text (optionally regex-validated); select = pick from options.'),
  required: z.boolean().default(false).describe('Whether the visitor must fill the field. Defaults to false.'),
  placeholder: z.string().max(120).optional().describe('Placeholder shown in the empty field, <= 120 chars.'),
  validation: z.string().max(200).optional().describe(
    'text fields only: regex source, anchored server-side as ^(?:...)$. <= 200 chars; backreferences and '
    + 'nested quantifiers are rejected. Example: ^[0-9]{1,10}$'
  ),
  options: z.array(z.string().max(120)).min(1).max(20).optional().describe(
    'select fields only (required for select): 1-20 options, each <= 120 chars.'
  ),
})

const PageInputFieldSchema = stringifiedObjectInput(PageInputFieldObjectSchema)

const PageOnDemandConfigObjectSchema = z.object({
  storeHistory: z.boolean().default(false).describe(
    'Save every run as public, searchable history with ?run=<id> permalinks. Visitors are told '
    + '"Every run is saved to history and searchable"; run inputs become public content.'
  ),
  inputForm: z.array(PageInputFieldSchema).max(12).default([]).describe(
    'Typed fields the visitor fills before the run (0-12). Omit for a plain Run button.'
  ),
  freeRunDailyCap: z.number().int().min(1).optional().describe(
    'Per-page cap on free anonymous runs per UTC day (default 100; the API enforces an upper bound). Paid runs are exempt.'
  ),
})

export const PageOnDemandConfigSchema = stringifiedObjectInput(PageOnDemandConfigObjectSchema).describe(
  'On-demand configuration (runMode "on-demand" only). Accepts a JSON-stringified object.'
)

const PageAggregationSchema = stringifiedObjectInput(z.object({
  enabled: z.boolean().describe('Whether weekly/monthly aggregate editions are compiled from base runs.'),
  views: z.array(z.enum(['daily', 'weekly', 'monthly'])).min(1).describe(
    'Views offered to visitors. Must include the cadence view. Daily cadence may add weekly and monthly '
    + '(monthly requires weekly); weekly cadence may add monthly and must not include daily.'
  ),
}))

const PageScheduleConfigObjectSchema = z.object({
  cadence: z.enum(['daily', 'weekly']).describe('How often a new edition is produced.'),
  dayOfWeek: z.number().int().min(0).max(6).optional().describe(
    'Required for weekly cadence: 0 = Sunday through 6 = Saturday.'
  ),
  hour: z.number().int().min(0).max(23).describe('Wall-clock hour (0-23) in `timezone`.'),
  minute: z.number().int().min(0).max(59).describe('Wall-clock minute (0-59).'),
  timezone: NonEmptyString.describe('IANA timezone id, e.g. "America/New_York". Validated by the API.'),
  periodCaption: z.string().optional().describe(
    'Optional caption override for the edition toggle, e.g. "Upcoming · refreshed daily after close".'
  ),
  aggregation: PageAggregationSchema.optional().describe(
    'Aggregate-edition settings. Defaults to { enabled: false, views: [cadence] } (base editions only).'
  ),
}).superRefine((value, ctx) => {
  if (value.cadence === 'weekly' && value.dayOfWeek === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "dayOfWeek is required when cadence is 'weekly'",
      path: ['dayOfWeek'],
    })
  }
}).transform((value) => ({
  ...value,
  aggregation: value.aggregation ?? { enabled: false, views: [value.cadence] },
}))

export const PageScheduleConfigSchema = stringifiedObjectInput(PageScheduleConfigObjectSchema).describe(
  'Schedule configuration (runMode "scheduled" only). Accepts a JSON-stringified object.'
)

const PagePaymentConfigObjectSchema = z.object({
  enabled: z.boolean().describe('Charge visitors per fresh run via x402. Stored history stays free to read.'),
  network: NonEmptyString.describe(
    'CAIP-2 network id, e.g. "eip155:8453" (Base). Use msq_list_x402_networks to see which are available.'
  ),
  payTo: NonEmptyString.describe('Receiving wallet address on that network.'),
  priceUsd: NonEmptyString.describe('Price per run as a decimal USD string, e.g. "0.25" (API-enforced bounds).'),
})

export const PagePaymentConfigSchema = stringifiedObjectInput(PagePaymentConfigObjectSchema).describe(
  'Per-run x402 payment (on-demand pages only; mutually exclusive with visibility "private"). '
  + 'Accepts a JSON-stringified object.'
)

const PagePlatformOptionsObjectSchema = z.object({
  publicListed: z.boolean().describe('List the platform page in the public directory and sitemap.'),
  subscribe: stringifiedObjectInput(z.object({
    enabled: z.boolean().describe('Offer email subscriptions (scheduled pages only).'),
    frequencies: z.array(z.enum(['daily', 'weekly', 'monthly'])).describe(
      'Subscription frequencies offered; must be a subset of the views implied by the cadence.'
    ),
  })).describe('Email subscription settings.'),
  emailReady: z.boolean().describe('Layout is email-safe; requires subscribe.enabled.'),
})

export const PagePlatformOptionsSchema = stringifiedObjectInput(PagePlatformOptionsObjectSchema).describe(
  'Platform-page options (pageType "platform" only). Accepts a JSON-stringified object.'
)

const PageHeaderObjectSchema = z.object({
  title: NonEmptyString.describe('Public page title. The URL slug is derived from it at first publish.'),
  description: NonEmptyString.describe('Public description shown under the title.'),
  ownerDisplay: NonEmptyString.describe('Public byline name ("by <ownerDisplay>"), e.g. your name or brand.'),
  sourceDisplay: z.string().optional().describe(
    'Optional public "Powered by …" line, e.g. "Econ Desk workflow". The source id is never exposed publicly.'
  ),
})

export const PageHeaderSchema = stringifiedObjectInput(PageHeaderObjectSchema).describe(
  'Public header text. Accepts a JSON-stringified object.'
)

const PageSourceObjectSchema = z.object({
  type: z.enum(['agent', 'workflow', 'factory']).describe(
    'What produces the content: a single agent run (response_format carries the layout schema), a workflow '
    + 'run (raw main-agent output used directly when it already validates, else one formatter call), '
    + 'or a factory run (terminal carry payload, same fast path).'
  ),
  id: NonEmptyString.describe(
    'Owned source id: agent id (name also resolves), workflow config id, or factory config id. '
    + 'Must exist in your account.'
  ),
})

export const PageSourceSchema = stringifiedObjectInput(PageSourceObjectSchema).describe(
  'Content source. Accepts a JSON-stringified object.'
)

const PageTypeSchema = z.enum(['user', 'platform'])
const PageRunModeSchema = z.enum(['scheduled', 'on-demand'])
const PageVisibilitySchema = z.enum(['public', 'private'])

const PageCategoriesSchema = z.array(z.string().max(60)).max(5).describe(
  'Up to 5 directory labels. Normalized server-side to lowercase [a-z0-9 ], 2-24 chars each, deduped. '
  + 'Use msq_list_page_categories for suggestions.'
)

export const PageIdSchema = z.object({
  id: NonEmptyString.describe('Page id (uuid from msq_list_pages / msq_create_page).'),
})

export const PageCreateSchema = z.object({
  pageType: PageTypeSchema.default('user').describe(
    'user (default) publishes your own source; platform pages add directory listing, subscriptions and email.'
  ),
  header: PageHeaderSchema,
  source: PageSourceSchema,
  layout: PageLayoutSchema,
  runMode: PageRunModeSchema.describe(
    '"on-demand": visitors press Run (optionally with an input form). "scheduled": editions on a daily/weekly timer.'
  ),
  schedule: PageScheduleConfigSchema.optional().describe('Required (at publish) when runMode is "scheduled".'),
  onDemand: PageOnDemandConfigSchema.optional().describe(
    'On-demand settings. When runMode is "on-demand" and this is omitted, { storeHistory: false, inputForm: [] } is sent.'
  ),
  payment: PagePaymentConfigSchema.optional(),
  platformOptions: PagePlatformOptionsSchema.optional(),
  publicListed: z.boolean().optional().describe(
    'User pages only: false = unlisted (reachable by URL, hidden from the directory/sitemap/search engines). '
    + 'Absent = listed.'
  ),
  visibility: PageVisibilitySchema.optional().describe(
    'User pages only: "private" serves the page ONLY to you (everyone else gets a 404); absent = "public". '
    + 'Cannot be combined with payment.enabled.'
  ),
  categories: PageCategoriesSchema.optional(),
})

const NullableOptional = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional()

export const PageUpdateSchema = PageIdSchema.extend({
  pageType: PageTypeSchema.optional().describe('Change the page type (user | platform).'),
  header: PageHeaderSchema.optional(),
  source: PageSourceSchema.optional(),
  layout: PageLayoutSchema.optional(),
  runMode: PageRunModeSchema.optional().describe(
    'Switching to "on-demand" drops the stored schedule; switching to "scheduled" drops onDemand and payment '
    + '(unless you also provide the new block in the same call).'
  ),
  schedule: NullableOptional(PageScheduleConfigSchema).describe('Replace the schedule; null removes it.'),
  onDemand: NullableOptional(PageOnDemandConfigSchema).describe('Replace the on-demand config; null removes it.'),
  payment: NullableOptional(PagePaymentConfigSchema).describe('Replace the payment config; null removes it.'),
  platformOptions: NullableOptional(PagePlatformOptionsSchema).describe('Replace platform options; null removes them.'),
  publicListed: NullableOptional(z.boolean()).describe(
    'User pages only: false = unlisted. null clears the flag (back to listed).'
  ),
  visibility: NullableOptional(PageVisibilitySchema).describe(
    'User pages only: "private" = owner-only. null clears the flag (back to public).'
  ),
  categories: NullableOptional(PageCategoriesSchema).describe('Replace categories; null or [] clears them.'),
  slug: NonEmptyString.optional().describe(
    'Explicit slug change — live pages only. 3-60 chars of [a-z0-9-], globally unique, not reserved. '
    + 'The old slug keeps redirecting to the new one.'
  ),
})

export const PageLayoutCompileSchema = z.object({
  layout: PageLayoutSchema,
})

export const PageRunsListSchema = PageIdSchema.extend({
  limit: z.number().int().positive().max(100).default(20).describe(
    'Maximum runs to return, newest first. Defaults to 20; clamped to 100.'
  ),
  offset: z.number().int().min(0).default(0).describe('Zero-based offset into the run history.'),
})

export const PageRunIdsSchema = PageIdSchema.extend({
  runId: NonEmptyString.describe('Page run id (from msq_run_page_preview or msq_list_page_runs).'),
})

const RunWaitTimeoutSchema = z.number().int().min(1).max(900).default(360).describe(
  'Maximum seconds to wait for the run to reach a terminal status before giving up (default 360 — page runs '
  + 'are hard-capped at 5 minutes server-side). The run keeps executing if this elapses; call again to re-check.'
)

export const PageRunStatusSchema = PageRunIdsSchema.extend({
  timeoutSeconds: RunWaitTimeoutSchema,
})

const OnDemandRunInputSchema = stringifiedObjectInput(z.record(z.string())).describe(
  'Visitor input keyed by input-form field name (string values only). Validated against the page\'s '
  + 'inputForm: required fields, regexes, select options. Omit for pages without an input form. '
  + 'Accepts a JSON-stringified object.'
)

export const PagePreviewRunSchema = PageIdSchema.extend({
  input: OnDemandRunInputSchema.optional(),
})

export const PublicPageSlugSchema = z.object({
  slug: NonEmptyString.describe('Public page slug — the <slug> in <publicOrigin>/p/<slug>.'),
})

export const PublicPageContentSchema = PublicPageSlugSchema.extend({
  view: z.enum(['daily', 'weekly', 'monthly']).optional().describe(
    'Edition view for scheduled pages. Defaults to the page cadence. On-demand results are only reachable '
    + 'by run id (msq_get_public_page_run).'
  ),
  period: z.string().optional().describe(
    'Period key for a specific edition: daily "YYYY-MM-DD", weekly ISO "YYYY-Www", monthly "YYYY-MM". '
    + 'Omit for the latest edition of the view.'
  ),
})

export const PublicPageRunsListSchema = PublicPageSlugSchema.extend({
  q: z.string().optional().describe('Optional text search over the run input summaries.'),
  limit: z.number().int().positive().max(50).default(20).describe('Maximum runs to return. Defaults to 20; clamped to 50.'),
  offset: z.number().int().min(0).default(0).describe('Zero-based offset into the public run history.'),
})

export const PublicPageRunSchema = PublicPageSlugSchema.extend({
  runId: NonEmptyString.describe('Public run id (from msq_run_public_page or msq_list_public_page_runs).'),
  timeoutSeconds: RunWaitTimeoutSchema,
})

export const PublicPageRunCreateSchema = PublicPageSlugSchema.extend({
  input: OnDemandRunInputSchema.optional(),
})

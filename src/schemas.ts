import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)
const MetadataSchema = z.record(z.unknown())

const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])

const ChatMessageSchema = z
  .object({
    role: MessageRoleSchema,
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
  })
  .passthrough()

const OpenAiFunctionToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: NonEmptyString,
    description: z.string().optional(),
    parameters: z.object({}).passthrough(),
  }),
})

const OpenAiToolChoiceSchema = z.union([z.string(), z.object({}).passthrough()])

const ChunkingStrategySchema = z.union([
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
])

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

const AgentModelOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional().describe('Temperature for model generation (0-2). Omit to use model default.'),
  maxTokens: z.number().int().optional().describe('Max output tokens. Use -1 for unlimited/model default.'),
}).optional().describe('Model generation options (temperature, maxTokens). These are stored in the agent\'s modelOptions.')

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
  selectedFunctions: z.record(z.array(z.string())).optional().describe('Map of MCP server name to function names. Alternative to tools; use one or the other.'),
  modelOptions: AgentModelOptionsSchema,
}).refine(
  (data) => data.systemPrompt || data.systemPromptId,
  { message: 'Either systemPrompt or systemPromptId must be provided.', path: ['systemPrompt'] }
)

export const DeleteAgentSchema = z.object({
  name: NonEmptyString,
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
  selectedFunctions: z.record(z.array(z.string())).optional().describe('Map of MCP server name to function names. Replaces existing selectedFunctions.'),
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
  modelOptions: z.object({}).passthrough().optional(),
})

export const WorkflowIdSchema = z.object({
  id: NonEmptyString.describe('Workflow config id.'),
})

export const WorkflowCreateSchema = z.object({
  id: NonEmptyString.optional().describe('Optional workflow config id. If omitted, the server generates one.'),
  name: z.string().optional().describe('Workflow name. Defaults to "Untitled Workflow".'),
  mainAgentId: z.string().nullable().optional().describe('Main agent id for the workflow.'),
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
  agentId: NonEmptyString.describe('Agent id to invoke for this step.'),
  promptOverride: z.string().optional().describe(
    'Optional prompt override to prepend before the incoming carry payload for this step.'
  ),
})

const FactoryWorkflowRefSchema = z.object({
  workflowConfigId: NonEmptyString.describe('Workflow config id to invoke for this step.'),
  payloadSchema: z.record(z.unknown()).optional().describe(
    'Optional JSON schema object used by MissionSquad to validate and possibly repair the carry payload before starting the workflow.'
  ),
  fixerAgentId: NonEmptyString.optional().describe(
    'Optional fixer-agent id used to repair invalid workflow payloads before the workflow step runs.'
  ),
  maxRepairAttempts: z.number().int().min(0).max(5).optional().describe(
    'Maximum fixer-agent repair attempts. Defaults to 0 unless a fixer agent is configured.'
  ),
})

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
  transition: FactoryTransitionSchema.describe('What the factory should do after this step completes.'),
})

const FactoryAgentStepSchema = BaseFactoryStepSchema.extend({
  kind: z.literal('agent').describe('Run a MissionSquad agent for this step.'),
  agentRef: FactoryAgentRefSchema.describe('Agent execution target for this step.'),
  workflowRef: z.never().optional(),
})

const FactoryWorkflowStepSchema = BaseFactoryStepSchema.extend({
  kind: z.literal('workflow').describe('Run a MissionSquad workflow for this step.'),
  workflowRef: FactoryWorkflowRefSchema.describe('Workflow execution target for this step.'),
  agentRef: z.never().optional(),
})

const FactoryStepInputSchema = z.discriminatedUnion('kind', [
  FactoryAgentStepSchema,
  FactoryWorkflowStepSchema,
]).describe(
  'Factory step definition. Agent steps require agentRef only. Workflow steps require workflowRef only.'
)

export const FactoryIdSchema = z.object({
  id: NonEmptyString.describe('Factory config id.'),
})

export const FactoryCreateSchema = z.object({
  id: NonEmptyString.optional().describe(
    'Optional factory config id. Omit to let MissionSquad generate one.'
  ),
  name: NonEmptyString.describe('Factory name.'),
  description: z.string().optional().describe('Optional human-readable description of the factory.'),
  steps: z.array(FactoryStepInputSchema).min(1).max(50).describe(
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

const FactoryScheduleTimeSchema = z.object({
  hour: z.number().int().min(0).max(23).describe('UTC hour, from 0 through 23.'),
  minute: z.number().int().min(0).max(59).describe('UTC minute, from 0 through 59.'),
})

const FactoryScheduleBodySchema = z.object({
  factoryConfigId: NonEmptyString.describe('Factory config id this schedule should execute.'),
  label: z.string().optional().describe('Optional human-readable label for the schedule.'),
  startDate: z.number().optional().describe(
    'Unix epoch milliseconds for when the schedule becomes active. Defaults to Date.now() on the backend.'
  ),
  timesToRun: z.array(FactoryScheduleTimeSchema).min(1).describe(
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
).superRefine((data, ctx) => {
  if (data.repeatInterval === 'weekly' && (!data.daysOfWeek || data.daysOfWeek.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'daysOfWeek is required when repeatInterval is weekly',
      path: ['daysOfWeek'],
    })
  }

  if (data.repeatInterval === 'monthly' && data.dayOfMonth === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dayOfMonth is required when repeatInterval is monthly',
      path: ['dayOfMonth'],
    })
  }
})

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

export const CreateScheduledRunSchema = z.object({
  agentName: NonEmptyString,
  prompt: z.string().min(1),
  startDate: z.number(),
  timesToRun: z.array(z.object({
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })).min(1),
  repeatInterval: z.enum(['daily', 'weekly', 'monthly', 'once']),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sendEmail: z.boolean().optional(),
  deliveryMethod: z.enum(['email', 'slack']).optional(),
  slackWebhookUrl: z.string().url().optional(),
  slackMetadata: z.object({
    scheduleId: z.string(),
    slackUserId: z.string(),
    deliveryChannelId: z.string(),
    teamId: z.string(),
  }).optional(),
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

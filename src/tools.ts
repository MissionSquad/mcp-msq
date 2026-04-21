import type { FastMCP } from '@missionsquad/fastmcp'
import { z } from 'zod'
import { MsqApiError, toUserError } from './errors.js'
import { stringifyResult } from './json.js'
import { logger } from './logger.js'
import { createMissionSquadClient, type MissionSquadClient } from './msq-client.js'
import {
  AddAgentSchema,
  AddModelSchema,
  AddProviderSchema,
  AddVectorStoreFileSchema,
  CancelVectorStoreSchema,
  ChatCompletionsSchema,
  CoreCollectionDiagnosticsSchema,
  CoreCollectionRecoverSchema,
  CoreCollectionSearchSchema,
  CreateScheduledRunSchema,
  CreateVectorStoreSchema,
  DeleteAgentSchema,
  DeleteModelSchema,
  DeleteProviderSchema,
  DiscoverProviderModelsSchema,
  EmbeddingsSchema,
  EmptySchema,
  FileContentSchema,
  FileIdSchema,
  GeneratePromptSchema,
  ScheduledRunIdSchema,
  ScrapeUrlSchema,
  ServerNameSchema,
  UpdateAgentSchema,
  UpdateScheduledRunSchema,
  UploadFileSchema,
  VectorStoreFileSchema,
  VectorStoreIdSchema,
  WorkflowCreateSchema,
  WorkflowIdSchema,
  WorkflowRunCreateSchema,
  WorkflowRunIdSchema,
  WorkflowUpdateSchema,
} from './schemas.js'

type ToolParams = z.ZodTypeAny

interface MsqToolDefinition<TParams extends ToolParams> {
  name: string
  description: string
  parameters: TParams
  run: (client: MissionSquadClient, args: z.infer<TParams>) => Promise<unknown>
}

function defineTool<TParams extends ToolParams>(
  definition: MsqToolDefinition<TParams>,
): MsqToolDefinition<TParams> {
  return definition
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

const TokenUsageSchema = z.object({
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
}).nullable()

const WorkflowStatusSchema = z.enum(['queued', 'running', 'completed', 'error', 'cancelled'])
const WorkflowMainStatusSchema = z.enum(['pending', 'queued', 'running', 'completed', 'error', 'cancelled'])

const WorkflowConfigRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  mainAgentId: z.string().nullable(),
  mainPrompt: z.string(),
  dataPayload: z.string(),
  concurrency: z.number(),
  delimiter: z.string(),
  failureMessage: z.string(),
  failureInstruction: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).passthrough()

const WorkflowRunHelperRecordSchema = z.object({
  helperRunId: z.string(),
  patternIndex: z.number(),
  agentId: z.string(),
  agentName: z.string(),
  status: WorkflowStatusSchema,
  startedAt: z.number().nullish(),
  completedAt: z.number().nullish(),
  errorMessage: z.string().nullish(),
  usage: TokenUsageSchema,
}).passthrough()

const WorkflowRunMainRecordSchema = z.object({
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  status: WorkflowMainStatusSchema,
  startedAt: z.number().nullish(),
  completedAt: z.number().nullish(),
  errorMessage: z.string().nullish(),
  usage: TokenUsageSchema,
}).passthrough()

const WorkflowRunRecordSchema = z.object({
  runId: z.string(),
  workflowConfigId: z.string().nullable(),
  workflowNameSnapshot: z.string(),
  status: WorkflowStatusSchema,
  startedAt: z.number(),
  completedAt: z.number().nullish(),
  cancelledAt: z.number().nullish(),
  errorMessage: z.string().nullish(),
  aggregateUsage: TokenUsageSchema,
  helpers: z.array(WorkflowRunHelperRecordSchema),
  main: WorkflowRunMainRecordSchema,
  resumeSnapshot: z.object({
    main: z.object({
      previewContent: z.string(),
    }).passthrough(),
  }).passthrough(),
}).passthrough()

const WorkflowRunMessageRecordSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.null(), z.array(z.unknown())]).optional(),
  tokenUsage: TokenUsageSchema.optional(),
}).passthrough()

const WorkflowChatHydrationSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  messages: z.array(WorkflowRunMessageRecordSchema),
}).passthrough()

const WorkflowRunHydratedRecordSchema = z.object({
  record: WorkflowRunRecordSchema,
  mainChat: WorkflowChatHydrationSchema.nullable(),
  helperChats: z.array(z.object({
    helperRunId: z.string(),
    chat: WorkflowChatHydrationSchema.nullable(),
  }).passthrough()),
}).passthrough()

const WorkflowRunHydratedResponseSchema = z.object({
  success: z.boolean(),
  data: WorkflowRunHydratedRecordSchema,
}).passthrough()

const WorkflowConfigListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(WorkflowConfigRecordSchema),
}).passthrough()

const WorkflowConfigResponseSchema = z.object({
  success: z.boolean(),
  data: WorkflowConfigRecordSchema,
}).passthrough()

const WorkflowRunResponseSchema = z.object({
  success: z.boolean(),
  runId: z.string().optional(),
  data: WorkflowRunRecordSchema,
}).passthrough()

type WorkflowConfigRecord = z.infer<typeof WorkflowConfigRecordSchema>
type WorkflowRunRecord = z.infer<typeof WorkflowRunRecordSchema>
type WorkflowRunHydratedRecord = z.infer<typeof WorkflowRunHydratedRecordSchema>
type WorkflowRunMessageRecord = z.infer<typeof WorkflowRunMessageRecordSchema>

function parseWorkflowConfigListResponse(payload: unknown): WorkflowConfigRecord[] {
  return WorkflowConfigListResponseSchema.parse(payload).data
}

function parseWorkflowConfigResponse(payload: unknown): WorkflowConfigRecord {
  return WorkflowConfigResponseSchema.parse(payload).data
}

function parseWorkflowRunResponse(payload: unknown): WorkflowRunRecord {
  return WorkflowRunResponseSchema.parse(payload).data
}

function parseWorkflowRunHydratedResponse(payload: unknown): WorkflowRunHydratedRecord {
  return WorkflowRunHydratedResponseSchema.parse(payload).data
}

function mapWorkflowList(workflows: WorkflowConfigRecord[]) {
  return { workflows }
}

function mapWorkflow(workflow: WorkflowConfigRecord) {
  return { workflow }
}

function mapWorkflowRunSummary(record: WorkflowRunRecord) {
  return {
    runId: record.runId,
    workflowId: record.workflowConfigId,
    workflowName: record.workflowNameSnapshot,
    status: record.status,
    startedAt: record.startedAt,
  }
}

function isWorkflowRunTerminalStatus(status: z.infer<typeof WorkflowStatusSchema>): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled'
}

async function fetchWorkflowRunRecord(
  client: MissionSquadClient,
  runId: string,
): Promise<WorkflowRunRecord> {
  const response = await client.requestJson({
    method: 'GET',
    path: `core/workflow-runs/${encodePathSegment(runId)}`,
  })

  return parseWorkflowRunResponse(response)
}

async function fetchWorkflowRunHydratedRecord(
  client: MissionSquadClient,
  runId: string,
): Promise<WorkflowRunHydratedRecord> {
  const response = await client.requestJson({
    method: 'GET',
    path: `core/workflow-runs/${encodePathSegment(runId)}/hydrated`,
  })

  return parseWorkflowRunHydratedResponse(response)
}

function extractLatestAssistantMessage(
  messages: WorkflowRunMessageRecord[] | undefined,
): WorkflowRunMessageRecord | undefined {
  return messages?.slice().reverse().find((message) => message.role === 'assistant')
}

function hasHydratedMainResult(hydrated: WorkflowRunHydratedRecord | null): boolean {
  if (!hydrated?.mainChat) {
    return false
  }

  const assistant = extractLatestAssistantMessage(hydrated.mainChat.messages)
  return typeof assistant?.content === 'string'
}

function needsHydratedMainResultWait(hydrated: WorkflowRunHydratedRecord | null): boolean {
  return Boolean(hydrated?.mainChat) && !hasHydratedMainResult(hydrated)
}

function extractHydratedMainResult(hydrated: WorkflowRunHydratedRecord | null): {
  content: string | null
  usage: z.infer<typeof TokenUsageSchema>
} {
  const assistant = extractLatestAssistantMessage(hydrated?.mainChat?.messages)
  return {
    content: typeof assistant?.content === 'string' ? assistant.content : null,
    usage: assistant?.tokenUsage ?? null,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForWorkflowRunRecord(
  client: MissionSquadClient,
  runId: string,
): Promise<WorkflowRunRecord> {
  let latestRecord = await fetchWorkflowRunRecord(client, runId)

  while (!isWorkflowRunTerminalStatus(latestRecord.status)) {
    let sawDone = false

    await client.consumeServerSentEvents(
      {
        path: `core/workflow-runs/${encodePathSegment(runId)}/stream`,
      },
      (event) => {
        if (event.data === '[DONE]') {
          sawDone = true
        }
      },
    )

    latestRecord = await fetchWorkflowRunRecord(client, runId)
    if (isWorkflowRunTerminalStatus(latestRecord.status)) {
      return latestRecord
    }

    if (sawDone) {
      throw new Error('Workflow is still running. Use msq_get_workflow_run_status again.')
    }
  }

  return latestRecord
}

async function waitForCompletedWorkflowReadiness(
  client: MissionSquadClient,
  runId: string,
  record: WorkflowRunRecord,
): Promise<WorkflowRunHydratedRecord | null> {
  if (record.status !== 'completed' || record.main.status !== 'completed') {
    return null
  }

  const maxAttempts = 8
  const delayMs = 250

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const hydrated = await fetchWorkflowRunHydratedRecord(client, runId)
    if (!needsHydratedMainResultWait(hydrated)) {
      return hydrated
    }

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs)
    }
  }

  throw new Error('Workflow completed but final result is not ready yet. Use msq_get_workflow_run_status again.')
}

async function waitForWorkflowRunStatusReady(
  client: MissionSquadClient,
  runId: string,
): Promise<WorkflowRunRecord> {
  const record = await waitForWorkflowRunRecord(client, runId)

  if (record.status !== 'completed') {
    return record
  }

  const initialHydrated = await fetchWorkflowRunHydratedRecord(client, runId)
  const hydrated = needsHydratedMainResultWait(initialHydrated)
    ? await waitForCompletedWorkflowReadiness(client, runId, record)
    : initialHydrated
  return hydrated?.record ?? record
}

function mapWorkflowRunStatus(record: WorkflowRunRecord) {
  return {
    runId: record.runId,
    workflowId: record.workflowConfigId,
    workflowName: record.workflowNameSnapshot,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    cancelledAt: record.cancelledAt,
    errorMessage: record.errorMessage,
    aggregateUsage: record.aggregateUsage,
    main: {
      agentId: record.main.agentId,
      agentName: record.main.agentName,
      status: record.main.status,
      startedAt: record.main.startedAt,
      completedAt: record.main.completedAt,
      errorMessage: record.main.errorMessage,
      usage: record.main.usage,
    },
    helpers: record.helpers.map((helper) => ({
      helperRunId: helper.helperRunId,
      patternIndex: helper.patternIndex,
      agentId: helper.agentId,
      agentName: helper.agentName,
      status: helper.status,
      startedAt: helper.startedAt,
      completedAt: helper.completedAt,
      errorMessage: helper.errorMessage,
      usage: helper.usage,
    })),
  }
}

function mapWorkflowRunResult(
  record: WorkflowRunRecord,
  hydrated: WorkflowRunHydratedRecord | null,
) {
  if (record.status === 'queued' || record.status === 'running') {
    throw new Error('Workflow result not ready. Use msq_get_workflow_run_status.')
  }

  if (record.status === 'error' || record.status === 'cancelled') {
    const suffix = record.errorMessage ? ` ${record.errorMessage}` : ''
    throw new Error(`Workflow did not complete successfully.${suffix}`)
  }

  if (record.status !== 'completed' || record.main.status !== 'completed') {
    throw new Error('Workflow completed without a completed main agent state.')
  }

  const hydratedResult = extractHydratedMainResult(hydrated)

  return {
    runId: record.runId,
    workflowId: record.workflowConfigId,
    workflowName: record.workflowNameSnapshot,
    status: 'completed' as const,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    result: {
      agentId: record.main.agentId,
      agentName: record.main.agentName,
      content: hydratedResult.content ?? record.resumeSnapshot.main.previewContent,
      usage: hydratedResult.usage ?? record.main.usage,
    },
    aggregateUsage: record.aggregateUsage,
  }
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entriesToArray(value: unknown): unknown[] {
  if (!isRecord(value)) {
    return []
  }

  return Object.entries(value).map(([id, item]) =>
    isRecord(item)
      ? { id, ...item }
      : { id, value: item },
  )
}

// Defense-in-depth: even though the upstream API is responsible for masking
// secrets, the MCP server is the boundary that hands data to AI agents and
// chat transcripts. A regression in the API's redaction (see incident
// 2026-04-19, embeddedCollections leak) MUST NOT propagate credentials to
// callers. Mask all credential-shaped fields on the way out.
const REDACTED_KEY_FIELDS = new Set(['apiKey', 'api_key', 'token', 'accessToken', 'secret'])

function maskCredential(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) {
    return value
  }
  if (value.length <= 8) {
    return '***'
  }
  return `${value.substring(0, 3)}...${value.substring(value.length - 4)}`
}

function redactSecrets<T>(item: T): T {
  if (!isRecord(item)) {
    return item
  }
  const out: Record<string, unknown> = { ...item }
  for (const field of REDACTED_KEY_FIELDS) {
    if (field in out) {
      out[field] = maskCredential(out[field])
    }
  }
  return out as T
}

export function summarizeCoreConfig(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload
  }

  const modelsById = isRecord(payload.models) ? payload.models : {}
  const agentsById = isRecord(payload.agents) ? payload.agents : {}
  const squadsById = isRecord(payload.squads) ? payload.squads : {}
  const missionsById = isRecord(payload.missions) ? payload.missions : {}
  const embeddingModelsById = isRecord(payload.embeddingModels) ? payload.embeddingModels : {}
  const embeddedCollectionsById = isRecord(payload.embeddedCollections) ? payload.embeddedCollections : {}
  const voicesById = isRecord(payload.voices) ? payload.voices : {}

  return {
    models: entriesToArray(modelsById).map(redactSecrets),
    agents: entriesToArray(agentsById).map((agent) =>
      isRecord(agent)
        ? {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            model: agent.model,
          }
        : agent,
    ),
    squads: entriesToArray(squadsById),
    missions: entriesToArray(missionsById),
    embeddingModels: entriesToArray(embeddingModelsById).map(redactSecrets),
    embeddedCollections: entriesToArray(embeddedCollectionsById).map(redactSecrets),
    voices: entriesToArray(voicesById),
    counts: {
      models: Object.keys(modelsById).length,
      agents: Object.keys(agentsById).length,
      squads: Object.keys(squadsById).length,
      missions: Object.keys(missionsById).length,
      embeddingModels: Object.keys(embeddingModelsById).length,
      embeddedCollections: Object.keys(embeddedCollectionsById).length,
      voices: Object.keys(voicesById).length,
    },
  }
}

export function summarizeToolInventories(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload
  }

  const rawTools = Array.isArray(payload.tools) ? payload.tools : []
  const groupedTools = rawTools
    .filter(isRecord)
    .flatMap((serverGroup) =>
      Object.entries(serverGroup).map(([serverName, tools]) => ({
        serverName,
        tools: Array.isArray(tools) ? tools : [],
      })),
    )

  const flattenedTools = groupedTools.flatMap(({ serverName, tools }) =>
    tools.map((tool) =>
      isRecord(tool)
        ? { serverName, ...tool }
        : { serverName, value: tool },
    ),
  )

  return {
    success: payload.success ?? true,
    tools: flattenedTools.map((tool) => {
      const toolRecord = tool as Record<string, unknown>
      const serverName = typeof toolRecord.serverName === 'string' ? toolRecord.serverName : 'unknown'
      const name = typeof toolRecord.name === 'string' ? toolRecord.name : String(toolRecord.value ?? '')
      const description = typeof toolRecord.description === 'string' ? toolRecord.description : undefined

      return {
        serverName,
        name,
        ...(description !== undefined ? { description } : {}),
      }
    }),
    serverNames: groupedTools.map((group) => group.serverName),
    counts: {
      servers: groupedTools.length,
      tools: flattenedTools.length,
    },
  }
}

type ServerInventorySummary = {
  name: string
  displayName: string
  transportType: string
  description: string
}

export function summarizeServerInventories(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload
  }

  const rawServers = Array.isArray(payload.servers) ? payload.servers : []

  const servers: ServerInventorySummary[] = rawServers
    .filter(isRecord)
    .filter((server) => server.installed === true && server.enabled === true)
    .map((server) => ({
      name: typeof server.name === 'string' ? server.name : '',
      displayName:
        typeof server.displayName === 'string' && server.displayName.trim().length > 0
          ? server.displayName
          : typeof server.name === 'string'
            ? server.name
            : '',
      transportType: typeof server.transportType === 'string' ? server.transportType : 'unknown',
      description: typeof server.description === 'string' ? server.description : '',
    }))
    .filter((server) => server.name.length > 0)

  return { servers }
}

const msqTools = [
  defineTool({
    name: 'msq_list_models',
    description: 'List all models and agents in your MissionSquad namespace.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'models',
      }),
  }),
  defineTool({
    name: 'msq_get_model_map',
    description: 'Get the full model map keyed by model/agent name.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'modelmap',
      }),
  }),
  defineTool({
    name: 'msq_chat_completions',
    description: 'Create OpenAI-compatible chat completions in MissionSquad.',
    parameters: ChatCompletionsSchema,
    run: async (client, args) => {
      const headers: Record<string, string | undefined> = {
        'x-client-id': args.xClientId,
        'x-session-id': args.xSessionId,
      }

      const body = { ...args } as Record<string, unknown>
      delete body.xClientId
      delete body.xSessionId

      return client.requestJson({
        method: 'POST',
        path: 'chat/completions',
        headers,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_embeddings',
    description: 'Create OpenAI-compatible embeddings in MissionSquad.',
    parameters: EmbeddingsSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'embeddings',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_providers',
    description: 'List configured upstream providers for your account.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/providers',
      }),
  }),
  defineTool({
    name: 'msq_add_provider',
    description: 'Add or update a provider configuration.',
    parameters: AddProviderSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/add/provider',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_delete_provider',
    description: 'Delete a provider configuration by providerKey.',
    parameters: DeleteProviderSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/delete/provider',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_discover_provider_models',
    description: 'Discover available models from a configured provider.',
    parameters: DiscoverProviderModelsSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/models',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_add_model',
    description: 'Add a model to your MissionSquad namespace.',
    parameters: AddModelSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/add/model',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_delete_model',
    description: 'Delete a model or embedding model by modelId.',
    parameters: DeleteModelSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/delete/model',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_agents',
    description: 'List your MissionSquad agents.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/agents',
      }),
  }),
  defineTool({
    name: 'msq_add_agent',
    description:
      'Create or update an agent definition. '
      + 'Accepts systemPromptId (from msq_generate_prompt) as an alternative to systemPrompt — '
      + 'recommended for complex/long prompts to avoid output truncation. '
      + 'Use the `tools` parameter with function names; the server resolves them to MCP servers.',
    parameters: AddAgentSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/add/agent',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_update_agent',
    description:
      'Update specific fields of an existing agent without recreating it. '
      + 'Only provide fields you want to change; all others are preserved. '
      + 'Accepts systemPromptId from msq_generate_prompt as an alternative to systemPrompt.',
    parameters: UpdateAgentSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'PUT',
        path: 'core/update/agent',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_delete_agent',
    description: 'Delete an agent by name.',
    parameters: DeleteAgentSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/delete/agent',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_generate_prompt',
    description:
      'Generate a system prompt using MissionSquad core prompt generation. '
      + 'Returns the generated prompt text and a promptId. '
      + 'Pass the promptId to msq_add_agent or msq_update_agent via systemPromptId '
      + 'to avoid re-emitting the full prompt (prevents output truncation on large prompts).',
    parameters: GeneratePromptSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/generate/prompt',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_workflows',
    description: 'List your MissionSquad workflow configs.',
    parameters: EmptySchema,
    run: async (client) => {
      const response = await client.requestJson({
        method: 'GET',
        path: 'core/workflows',
      })

      return mapWorkflowList(parseWorkflowConfigListResponse(response))
    },
  }),
  defineTool({
    name: 'msq_get_workflow',
    description: 'Get a MissionSquad workflow config by id.',
    parameters: WorkflowIdSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'GET',
        path: 'core/workflows',
      })

      const workflows = parseWorkflowConfigListResponse(response)
      const workflow = workflows.find((candidate) => candidate.id === args.id)
      if (!workflow) {
        throw new Error('Workflow config not found')
      }

      return mapWorkflow(workflow)
    },
  }),
  defineTool({
    name: 'msq_create_workflow',
    description: 'Create a MissionSquad workflow config.',
    parameters: WorkflowCreateSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'POST',
        path: 'core/workflows',
        body: args,
      })

      return mapWorkflow(parseWorkflowConfigResponse(response))
    },
  }),
  defineTool({
    name: 'msq_update_workflow',
    description: 'Update a MissionSquad workflow config by id.',
    parameters: WorkflowUpdateSchema,
    run: async (client, args) => {
      const { id, ...body } = args
      const response = await client.requestJson({
        method: 'PUT',
        path: `core/workflows/${encodePathSegment(id)}`,
        body,
      })

      return mapWorkflow(parseWorkflowConfigResponse(response))
    },
  }),
  defineTool({
    name: 'msq_run_workflow',
    description: 'Start a MissionSquad workflow run in the background.',
    parameters: WorkflowRunCreateSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'POST',
        path: 'core/workflow-runs',
        body: args,
      })

      return mapWorkflowRunSummary(parseWorkflowRunResponse(response))
    },
  }),
  defineTool({
    name: 'msq_get_workflow_run_status',
    description: 'Get workflow run status including helper success/failure state. Waits for in-progress runs to reach a terminal state when the API stream is available.',
    parameters: WorkflowRunIdSchema,
    run: async (client, args) => {
      return mapWorkflowRunStatus(await waitForWorkflowRunStatusReady(client, args.runId))
    },
  }),
  defineTool({
    name: 'msq_get_workflow_result',
    description: 'Get the final main-agent result for a completed MissionSquad workflow run.',
    parameters: WorkflowRunIdSchema,
    run: async (client, args) => {
      const hydrated = await fetchWorkflowRunHydratedRecord(client, args.runId)
      const record = hydrated.record

      if (record.status === 'completed' && record.main.status === 'completed' && needsHydratedMainResultWait(hydrated)) {
        const readyHydrated = await waitForCompletedWorkflowReadiness(client, args.runId, record)
        return mapWorkflowRunResult(readyHydrated?.record ?? record, readyHydrated)
      }

      return mapWorkflowRunResult(record, hydrated)
    },
  }),
  defineTool({
    name: 'msq_get_core_config',
    description:
      'Get MissionSquad core config (models, agents, embeddings, collections). '
      + 'Returns the raw MissionSquad API response shape.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/config',
      }),
  }),
  defineTool({
    name: 'msq_get_core_config_summary',
    description:
      'Get a compact, list-friendly summary of MissionSquad core config for programmatic consumers. '
      + 'Returns iterable arrays for models, agents, embeddings, collections, and voices plus top-level counts.',
    parameters: EmptySchema,
    run: async (client) =>
      summarizeCoreConfig(await client.requestJson({
        method: 'GET',
        path: 'core/config',
      })),
  }),
  defineTool({
    name: 'msq_scrape_url',
    description: 'Request MissionSquad to scrape text content from a URL.',
    parameters: ScrapeUrlSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/scrape-url',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_tools',
    description: 'List MissionSquad MCP tool inventories available to agents. Returns the raw MissionSquad API response shape.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/tools',
      }),
  }),
  defineTool({
    name: 'msq_list_tool_functions',
    description:
      'List MissionSquad MCP tool functions in a compact, flat, list-friendly shape for programmatic consumers. '
      + 'Each result includes `serverName`, `name`, and `description`.',
    parameters: EmptySchema,
    run: async (client) =>
      summarizeToolInventories(await client.requestJson({
        method: 'GET',
        path: 'core/tools',
      })),
  }),
  defineTool({
    name: 'msq_list_servers',
    description:
      'List installed and enabled MissionSquad MCP servers in a compact discovery-friendly shape. '
      + 'Each result includes only `name`, `displayName`, `transportType`, and `description`.',
    parameters: EmptySchema,
    run: async (client) =>
      summarizeServerInventories(await client.requestJson({
        method: 'GET',
        path: 'core/servers',
      })),
  }),
  defineTool({
    name: 'msq_list_server_tools',
    description:
      'List the tools for one MissionSquad MCP server only. '
      + 'Use this after msq_list_servers to inspect specific servers without loading the full global tool inventory.',
    parameters: ServerNameSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `mcp/servers/${encodePathSegment(args.serverName)}/tools`,
      }),
  }),
  defineTool({
    name: 'msq_list_core_collections',
    description: 'List MissionSquad core embedded collections.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/collections',
      }),
  }),
  defineTool({
    name: 'msq_search_core_collection',
    description: 'Search a MissionSquad core embedded collection.',
    parameters: CoreCollectionSearchSchema,
    run: async (client, args) => {
      const { collectionName, ...body } = args

      return client.requestJson({
        method: 'POST',
        path: `core/collections/${encodePathSegment(collectionName)}/search`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_get_core_collection_diagnostics',
    description: 'Get diagnostics for a MissionSquad core embedded collection.',
    parameters: CoreCollectionDiagnosticsSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `core/collections/${encodePathSegment(args.collectionName)}/diagnostics`,
      }),
  }),
  defineTool({
    name: 'msq_recover_core_collection',
    description: 'Run collection recovery for a MissionSquad core embedded collection.',
    parameters: CoreCollectionRecoverSchema,
    run: async (client, args) => {
      const { collectionName, ...body } = args

      return client.requestJson({
        method: 'POST',
        path: `core/collections/${encodePathSegment(collectionName)}/recover`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_list_vector_stores',
    description: 'List MissionSquad vector stores.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'vector_stores',
      }),
  }),
  defineTool({
    name: 'msq_create_vector_store',
    description: 'Create a MissionSquad vector store and optionally enqueue files.',
    parameters: CreateVectorStoreSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'vector_stores',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_get_vector_store',
    description: 'Get a MissionSquad vector store by id.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}`,
      }),
  }),
  defineTool({
    name: 'msq_delete_vector_store',
    description: 'Delete a MissionSquad vector store by id.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}`,
      }),
  }),
  defineTool({
    name: 'msq_list_vector_store_files',
    description: 'List files associated with a vector store.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}/files`,
      }),
  }),
  defineTool({
    name: 'msq_add_vector_store_file',
    description: 'Add an existing uploaded file to a vector store and embed it.',
    parameters: AddVectorStoreFileSchema,
    run: async (client, args) => {
      const { vectorStoreId, ...body } = args

      return client.requestJson({
        method: 'POST',
        path: `vector_stores/${encodePathSegment(vectorStoreId)}/files`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_get_vector_store_file',
    description: 'Get vector-store association details for a specific file.',
    parameters: VectorStoreFileSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}/files/${encodePathSegment(args.fileId)}`,
      }),
  }),
  defineTool({
    name: 'msq_cancel_vector_store_session',
    description: 'Cancel an in-progress vector-store embedding session by sessionId.',
    parameters: CancelVectorStoreSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'vector_stores/cancel',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_files',
    description: 'List uploaded files.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'files',
      }),
  }),
  defineTool({
    name: 'msq_upload_file',
    description: 'Upload a file for vector-store workflows.',
    parameters: UploadFileSchema,
    run: async (client, args) =>
      client.uploadFile({
        filePath: args.filePath,
        purpose: args.purpose,
        relativePath: args.relativePath,
        collectionName: args.collectionName,
        filename: args.filename,
      }),
  }),
  defineTool({
    name: 'msq_get_file',
    description: 'Get uploaded file metadata by id.',
    parameters: FileIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `files/${encodePathSegment(args.fileId)}`,
      }),
  }),
  defineTool({
    name: 'msq_delete_file',
    description: 'Delete an uploaded file by id.',
    parameters: FileIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `files/${encodePathSegment(args.fileId)}`,
      }),
  }),
  defineTool({
    name: 'msq_get_file_content',
    description: 'Fetch file content as base64 with byte limits for safe transport.',
    parameters: FileContentSchema,
    run: async (client, args) =>
      client.getFileContent({
        fileId: args.fileId,
        maxBytes: args.maxBytes,
      }),
  }),
  defineTool({
    name: 'msq_list_user_collections',
    description: 'List convenience user collections summary.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'user-collections',
      }),
  }),
  defineTool({
    name: 'msq_get_vector_store_file_details',
    description: 'Get decoded filename/path details for files in a vector store.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}/file-details`,
      }),
  }),
  defineTool({
    name: 'msq_list_scheduled_runs',
    description: 'List all scheduled runs for your account.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/scheduled-runs',
      }),
  }),
  defineTool({
    name: 'msq_create_scheduled_run',
    description: 'Create a new scheduled run for an agent with timing and delivery options.',
    parameters: CreateScheduledRunSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/scheduled-runs',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_update_scheduled_run',
    description: 'Update an existing scheduled run by id.',
    parameters: UpdateScheduledRunSchema,
    run: async (client, args) => {
      const { id, ...body } = args

      return client.requestJson({
        method: 'PUT',
        path: `core/scheduled-runs/${encodePathSegment(id)}`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_delete_scheduled_run',
    description: 'Delete a scheduled run by id.',
    parameters: ScheduledRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `core/scheduled-runs/${encodePathSegment(args.id)}`,
      }),
  }),
  defineTool({
    name: 'msq_toggle_scheduled_run',
    description: 'Toggle a scheduled run enabled/disabled by id.',
    parameters: ScheduledRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'PUT',
        path: `core/scheduled-runs/${encodePathSegment(args.id)}/toggle`,
      }),
  }),
  defineTool({
    name: 'msq_get_scheduled_run_results',
    description: 'Get execution results for a scheduled run by id.',
    parameters: ScheduledRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `core/scheduled-runs/${encodePathSegment(args.id)}/results`,
      }),
  }),
  defineTool({
    name: 'msq_get_user_settings',
    description: 'Get current user settings including utility agent configuration.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/user/settings',
      }),
  }),
] as const

export const MSQ_TOOL_NAMES = msqTools.map((tool) => tool.name)

export function registerMissionSquadTools(server: FastMCP<undefined>): void {
  for (const tool of msqTools) {
    server.addTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (args, context) => {
        logger.info(`Tool: ${tool.name} - called`)
        logger.debug(`Tool: ${tool.name} - extraArgs keys: ${context.extraArgs ? Object.keys(context.extraArgs).join(', ') : 'none'}`)
        try {
          const client = createMissionSquadClient(context.extraArgs)
          const run = tool.run as (
            client: MissionSquadClient,
            args: unknown,
          ) => Promise<unknown>
          const result = await run(client, args)
          logger.info(`Tool: ${tool.name} - success`)
          return stringifyResult(result)
        } catch (error) {
          if (error instanceof MsqApiError) {
            logger.error(
              `Tool: ${tool.name} - API error: ${error.status} ${error.statusText} | url=${error.url} | body=${JSON.stringify(error.responseBody)}`
            )
          } else {
            logger.error(`Tool: ${tool.name} - failed: ${error instanceof Error ? error.message : String(error)}`)
          }
          throw toUserError(error, `Tool ${tool.name} failed`)
        }
      },
    })
  }
}

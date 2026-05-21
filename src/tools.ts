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
  FactoryCreateSchema,
  FactoryIdSchema,
  FactoryRunCreateSchema,
  FactoryRunIdSchema,
  FactoryRunsListSchema,
  FactoryRunStepsListSchema,
  FactoryScheduleCreateSchema,
  FactoryScheduleIdSchema,
  FactoryScheduleUpdateSchema,
  FactoryStepIdsSchema,
  FactoryUpdateSchema,
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

const FactoryStepTransitionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('next'),
  }).passthrough(),
  z.object({
    kind: z.literal('stop'),
  }).passthrough(),
  z.object({
    kind: z.literal('loop_to_index'),
    targetIndex: z.number(),
  }).passthrough(),
])

const FactoryAgentRefRecordSchema = z.object({
  agentId: z.string(),
  promptOverride: z.string().optional(),
}).passthrough()

const FactoryWorkflowRefRecordSchema = z.object({
  workflowConfigId: z.string(),
  payloadSchema: z.record(z.unknown()).optional(),
  fixerAgentId: z.string().optional(),
  maxRepairAttempts: z.number().optional(),
}).passthrough()

const FactoryStepConfigRecordSchema = z.object({
  stepId: z.string(),
  index: z.number(),
  name: z.string(),
  kind: z.enum(['agent', 'workflow']),
  limitStepInvocations: z.boolean().optional(),
  agentRef: FactoryAgentRefRecordSchema.optional(),
  workflowRef: FactoryWorkflowRefRecordSchema.optional(),
  maxStepInvocations: z.number(),
  transition: FactoryStepTransitionSchema,
}).passthrough()

const FactoryConfigRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(FactoryStepConfigRecordSchema),
  continuous: z.boolean(),
  limitTotalInvocations: z.boolean().optional(),
  maxTotalInvocations: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).passthrough()

const FactoryRunStatusSchema = z.enum(['queued', 'running', 'paused', 'completed', 'cancelled', 'error'])

const FactoryRunRecordSchema = z.object({
  runId: z.string(),
  factoryConfigId: z.string().nullable(),
  ownerUserId: z.string(),
  factoryNameSnapshot: z.string(),
  configSnapshot: z.unknown(),
  trigger: z.enum(['manual', 'scheduler']),
  scheduleId: z.string().optional(),
  status: FactoryRunStatusSchema,
  cursor: z.object({
    nextStepIndex: z.number().nullable(),
    iterationCount: z.number(),
    completedCycleCount: z.number().optional(),
  }).passthrough(),
  carryPayload: z.string(),
  aggregateUsage: TokenUsageSchema,
  perStepInvocationCounts: z.record(z.number()),
  startedAt: z.number(),
  completedAt: z.number().nullish(),
  cancelledAt: z.number().nullish(),
  pausedAt: z.number().nullish(),
  errorMessage: z.string().nullish(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).passthrough()

const FactoryInvokedRecordSchema = z.object({
  kind: z.enum(['agent', 'workflow', 'fixer_agent']),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  workflowConfigId: z.string().optional(),
  workflowName: z.string().optional(),
}).passthrough()

const FactoryStepValidationRecordSchema = z.object({
  schemaPresent: z.boolean(),
  initialOutcome: z.enum(['pass', 'fail', 'not_applicable']),
  repairAttempts: z.number(),
  finalOutcome: z.enum(['pass', 'fail']),
  errors: z.array(z.object({
    path: z.string(),
    message: z.string(),
  }).passthrough()).optional(),
}).passthrough()

const FactoryStepRunRecordSchema = z.object({
  stepRunId: z.string(),
  runId: z.string(),
  ownerUserId: z.string(),
  factoryConfigId: z.string(),
  stepId: z.string(),
  stepIndex: z.number(),
  stepName: z.string(),
  sequence: z.number(),
  kind: z.enum(['agent', 'workflow']),
  invoked: FactoryInvokedRecordSchema,
  triggeredBy: z.enum(['manual_start', 'previous_step_output', 'loopback', 'scheduler']),
  upstreamStepRunId: z.string().nullable(),
  input: z.string(),
  output: z.string(),
  workflowDataPayloadIn: z.string().nullable(),
  workflowRunId: z.string().optional(),
  chatId: z.string().optional(),
  validation: FactoryStepValidationRecordSchema.optional(),
  status: z.enum(['queued', 'running', 'completed', 'error', 'cancelled', 'skipped']),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  errorMessage: z.string().optional(),
  usage: TokenUsageSchema,
  toolEvents: z.array(z.record(z.unknown())),
  createdAt: z.number(),
  updatedAt: z.number(),
}).passthrough()

const PublicChatSessionRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  agentUsername: z.string(),
  agentSlug: z.string(),
  origin: z.enum(['chat', 'workflow', 'factory']).optional(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(WorkflowRunMessageRecordSchema),
}).passthrough()

const FactoryStepHydratedRecordSchema = z.object({
  stepRun: FactoryStepRunRecordSchema,
  workflowRun: WorkflowRunHydratedRecordSchema.nullable().optional(),
  chatSession: PublicChatSessionRecordSchema.nullable().optional(),
}).passthrough()

const FactoryScheduleRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  factoryConfigId: z.string(),
  label: z.string().optional(),
  startDate: z.number(),
  timesToRun: z.array(z.object({
    hour: z.number(),
    minute: z.number(),
  }).passthrough()),
  repeatInterval: z.enum(['once', 'daily', 'weekly', 'monthly']),
  daysOfWeek: z.array(z.number()).optional(),
  dayOfMonth: z.number().optional(),
  status: z.enum(['enabled', 'disabled', 'running']),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number(),
  initialCarryPayload: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).passthrough()

const FactoryConfigListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(FactoryConfigRecordSchema),
}).passthrough()

const FactoryConfigResponseSchema = z.object({
  success: z.boolean(),
  data: FactoryConfigRecordSchema,
}).passthrough()

const FactoryRunListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(FactoryRunRecordSchema),
}).passthrough()

const FactoryRunResponseSchema = z.object({
  success: z.boolean(),
  runId: z.string().optional(),
  data: FactoryRunRecordSchema,
}).passthrough()

const FactoryStepRunListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(FactoryStepRunRecordSchema),
}).passthrough()

const FactoryStepRunResponseSchema = z.object({
  success: z.boolean(),
  data: FactoryStepRunRecordSchema,
}).passthrough()

const FactoryStepHydratedResponseSchema = z.object({
  success: z.boolean(),
  data: FactoryStepHydratedRecordSchema,
}).passthrough()

const FactoryScheduleListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(FactoryScheduleRecordSchema),
}).passthrough()

const FactoryScheduleResponseSchema = z.object({
  success: z.boolean(),
  data: FactoryScheduleRecordSchema,
}).passthrough()

type WorkflowConfigRecord = z.infer<typeof WorkflowConfigRecordSchema>
type WorkflowRunRecord = z.infer<typeof WorkflowRunRecordSchema>
type WorkflowRunHydratedRecord = z.infer<typeof WorkflowRunHydratedRecordSchema>
type WorkflowRunMessageRecord = z.infer<typeof WorkflowRunMessageRecordSchema>
type FactoryConfigRecord = z.infer<typeof FactoryConfigRecordSchema>
type FactoryRunRecord = z.infer<typeof FactoryRunRecordSchema>
type FactoryStepRunRecord = z.infer<typeof FactoryStepRunRecordSchema>
type FactoryStepHydratedRecord = z.infer<typeof FactoryStepHydratedRecordSchema>
type FactoryScheduleRecord = z.infer<typeof FactoryScheduleRecordSchema>

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

function parseFactoryConfigListResponse(payload: unknown): FactoryConfigRecord[] {
  return FactoryConfigListResponseSchema.parse(payload).data
}

function parseFactoryConfigResponse(payload: unknown): FactoryConfigRecord {
  return FactoryConfigResponseSchema.parse(payload).data
}

function parseFactoryRunListResponse(payload: unknown): FactoryRunRecord[] {
  return FactoryRunListResponseSchema.parse(payload).data
}

function parseFactoryRunResponse(payload: unknown): FactoryRunRecord {
  return FactoryRunResponseSchema.parse(payload).data
}

function parseFactoryStepRunListResponse(payload: unknown): FactoryStepRunRecord[] {
  return FactoryStepRunListResponseSchema.parse(payload).data
}

function parseFactoryStepRunResponse(payload: unknown): FactoryStepRunRecord {
  return FactoryStepRunResponseSchema.parse(payload).data
}

function parseFactoryStepHydratedResponse(payload: unknown): FactoryStepHydratedRecord {
  return FactoryStepHydratedResponseSchema.parse(payload).data
}

function parseFactoryScheduleListResponse(payload: unknown): FactoryScheduleRecord[] {
  return FactoryScheduleListResponseSchema.parse(payload).data
}

function parseFactoryScheduleResponse(payload: unknown): FactoryScheduleRecord {
  return FactoryScheduleResponseSchema.parse(payload).data
}

function mapWorkflowList(workflows: WorkflowConfigRecord[]) {
  return { workflows }
}

function mapWorkflow(workflow: WorkflowConfigRecord) {
  return { workflow }
}

function mapFactoryList(factories: FactoryConfigRecord[]) {
  return { factories }
}

function mapFactory(factory: FactoryConfigRecord) {
  return { factory }
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

function mapFactoryRunSummary(record: FactoryRunRecord) {
  return {
    runId: record.runId,
    factoryId: record.factoryConfigId,
    factoryName: record.factoryNameSnapshot,
    trigger: record.trigger,
    status: record.status,
    cursor: record.cursor,
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? undefined,
    cancelledAt: record.cancelledAt ?? undefined,
    pausedAt: record.pausedAt ?? undefined,
    aggregateUsage: record.aggregateUsage,
    perStepInvocationCounts: record.perStepInvocationCounts,
  }
}

function mapFactoryRunList(runs: FactoryRunRecord[]) {
  return {
    runs: runs.map((record) => mapFactoryRunSummary(record)),
  }
}

function mapFactoryRunStatus(record: FactoryRunRecord) {
  return {
    ...mapFactoryRunSummary(record),
    errorMessage: record.errorMessage ?? undefined,
  }
}

function mapFactoryRunResult(record: FactoryRunRecord) {
  if (record.status === 'queued' || record.status === 'running') {
    throw new Error('Factory result not ready. Use msq_get_factory_run_status.')
  }

  if (record.status === 'paused') {
    throw new Error('Factory run is paused. Resume it or inspect status first.')
  }

  if (record.status === 'error' || record.status === 'cancelled') {
    const suffix = record.errorMessage ? ` ${record.errorMessage}` : ''
    throw new Error(`Factory did not complete successfully.${suffix}`)
  }

  return {
    runId: record.runId,
    factoryId: record.factoryConfigId,
    factoryName: record.factoryNameSnapshot,
    trigger: record.trigger,
    status: 'completed' as const,
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? undefined,
    cursor: record.cursor,
    aggregateUsage: record.aggregateUsage,
    perStepInvocationCounts: record.perStepInvocationCounts,
    result: {
      carryPayload: record.carryPayload,
    },
  }
}

function mapFactoryStepList(steps: FactoryStepRunRecord[]) {
  return { steps }
}

function mapFactoryStep(step: FactoryStepRunRecord) {
  return { step }
}

function mapFactoryStepHydrated(hydrated: FactoryStepHydratedRecord) {
  return {
    stepRun: hydrated.stepRun,
    workflowRun: hydrated.workflowRun ?? null,
    chatSession: hydrated.chatSession ?? null,
  }
}

function mapFactoryScheduleList(schedules: FactoryScheduleRecord[]) {
  return { schedules }
}

function mapFactorySchedule(schedule: FactoryScheduleRecord) {
  return { schedule }
}

function isWorkflowRunTerminalStatus(status: z.infer<typeof WorkflowStatusSchema>): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled'
}

function isFactoryRunWaitingStatus(status: z.infer<typeof FactoryRunStatusSchema>): boolean {
  return status === 'queued' || status === 'running'
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

async function fetchFactoryRunRecord(
  client: MissionSquadClient,
  runId: string,
): Promise<FactoryRunRecord> {
  const response = await client.requestJson({
    method: 'GET',
    path: `core/factory-runs/${encodePathSegment(runId)}`,
  })

  return parseFactoryRunResponse(response)
}

async function fetchFactorySchedules(
  client: MissionSquadClient,
): Promise<FactoryScheduleRecord[]> {
  const response = await client.requestJson({
    method: 'GET',
    path: 'core/factory-schedules',
  })

  return parseFactoryScheduleListResponse(response)
}

function assertValidEffectiveFactoryScheduleUpdate(
  existing: FactoryScheduleRecord | null,
  update: z.infer<typeof FactoryScheduleUpdateSchema>,
): void {
  const effectiveRepeatInterval = update.repeatInterval ?? existing?.repeatInterval
  const effectiveDaysOfWeek = update.daysOfWeek ?? existing?.daysOfWeek
  const effectiveDayOfMonth = update.dayOfMonth ?? existing?.dayOfMonth

  if (effectiveRepeatInterval === 'weekly' && (!effectiveDaysOfWeek || effectiveDaysOfWeek.length === 0)) {
    throw new Error('daysOfWeek is required for weekly schedules')
  }

  if (effectiveRepeatInterval === 'monthly' && effectiveDayOfMonth === undefined) {
    throw new Error('dayOfMonth is required for monthly schedules')
  }
}

function parseSseJsonData(data: string): UnknownRecord | null {
  if (data === '[DONE]') {
    return { type: '[DONE]' }
  }

  try {
    const parsed = JSON.parse(data)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
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

class FactoryRunPausedSignal extends Error {
  constructor() {
    super('Factory run paused')
  }
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

async function waitForFactoryRunRecord(
  client: MissionSquadClient,
  runId: string,
): Promise<FactoryRunRecord> {
  let latestRecord = await fetchFactoryRunRecord(client, runId)

  while (isFactoryRunWaitingStatus(latestRecord.status)) {
    let sawTerminalHint = false
    let sawPauseHint = false

    try {
      await client.consumeServerSentEvents(
        {
          path: `core/factory-runs/${encodePathSegment(runId)}/stream`,
        },
        (event) => {
          const parsed = parseSseJsonData(event.data)
          if (!parsed) {
            return
          }

          const type = parsed.type
          if (type === 'run_paused') {
            sawPauseHint = true
            throw new FactoryRunPausedSignal()
          }

          if (
            type === 'run_completed'
            || type === 'run_completed_at_cap'
            || type === 'run_cancelled'
            || type === 'error'
            || type === '[DONE]'
          ) {
            sawTerminalHint = true
          }
        },
      )
    } catch (error) {
      if (!(error instanceof FactoryRunPausedSignal)) {
        throw error
      }
    }

    latestRecord = await fetchFactoryRunRecord(client, runId)
    if (!isFactoryRunWaitingStatus(latestRecord.status)) {
      return latestRecord
    }

    if (sawPauseHint || sawTerminalHint) {
      continue
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
    name: 'msq_list_factories',
    description:
      'List all factory configs in your MissionSquad account. '
      + 'Use this to discover available factories before reading, running, or scheduling one.',
    parameters: EmptySchema,
    run: async (client) => {
      const response = await client.requestJson({
        method: 'GET',
        path: 'core/factories',
      })

      return mapFactoryList(parseFactoryConfigListResponse(response))
    },
  }),
  defineTool({
    name: 'msq_get_factory',
    description:
      'Get one factory config by id. '
      + 'Use this when you already know the factory id and need the exact saved definition.',
    parameters: FactoryIdSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'GET',
        path: `core/factories/${encodePathSegment(args.id)}`,
      })

      return mapFactory(parseFactoryConfigResponse(response))
    },
  }),
  defineTool({
    name: 'msq_create_factory',
    description:
      'Create a new factory config from a full factory definition. '
      + 'MissionSquad normalizes missing step ids, step indices, and runtime defaults when the factory is saved.',
    parameters: FactoryCreateSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'POST',
        path: 'core/factories',
        body: args,
      })

      return mapFactory(parseFactoryConfigResponse(response))
    },
  }),
  defineTool({
    name: 'msq_update_factory',
    description:
      'Update an existing factory config by id. '
      + 'If you provide `steps`, send the full desired step array rather than a partial patch.',
    parameters: FactoryUpdateSchema,
    run: async (client, args) => {
      const { id, ...body } = args
      const response = await client.requestJson({
        method: 'PUT',
        path: `core/factories/${encodePathSegment(id)}`,
        body,
      })

      return mapFactory(parseFactoryConfigResponse(response))
    },
  }),
  defineTool({
    name: 'msq_delete_factory',
    description: 'Delete a factory config by id.',
    parameters: FactoryIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `core/factories/${encodePathSegment(args.id)}`,
      }),
  }),
  defineTool({
    name: 'msq_list_factory_runs',
    description:
      'List recent and historical runs for one factory config. '
      + 'Returns compact run summaries without the full config snapshot or carry payload.',
    parameters: FactoryRunsListSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'GET',
        path: `core/factories/${encodePathSegment(args.factoryId)}/runs`,
        query: {
          limit: args.limit,
          offset: args.offset,
        },
      })

      return mapFactoryRunList(parseFactoryRunListResponse(response))
    },
  }),
  defineTool({
    name: 'msq_run_factory',
    description:
      'Start a factory run in the background and return the run id to monitor. '
      + 'If `initialCarryPayload` is omitted, MissionSquad starts the run with an empty string payload.',
    parameters: FactoryRunCreateSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'POST',
        path: 'core/factory-runs',
        body: args,
      })

      return mapFactoryRunSummary(parseFactoryRunResponse(response))
    },
  }),
  defineTool({
    name: 'msq_get_factory_run_status',
    description:
      'Wait for a factory run to finish or pause, then return high-level status without the final carry payload content. '
      + 'Use this after msq_run_factory.',
    parameters: FactoryRunIdSchema,
    run: async (client, args) => {
      return mapFactoryRunStatus(await waitForFactoryRunRecord(client, args.runId))
    },
  }),
  defineTool({
    name: 'msq_get_factory_result',
    description:
      'Get the final carry payload from a completed factory run. '
      + 'Use this only after msq_get_factory_run_status reports a successful completion.',
    parameters: FactoryRunIdSchema,
    run: async (client, args) => {
      return mapFactoryRunResult(await fetchFactoryRunRecord(client, args.runId))
    },
  }),
  defineTool({
    name: 'msq_list_factory_run_steps',
    description:
      'List the recorded step executions for one factory run. '
      + 'Use this to inspect what each step consumed, produced, and how it finished.',
    parameters: FactoryRunStepsListSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'GET',
        path: `core/factory-runs/${encodePathSegment(args.runId)}/steps`,
        query: {
          limit: args.limit,
          offset: args.offset,
        },
      })

      return mapFactoryStepList(parseFactoryStepRunListResponse(response))
    },
  }),
  defineTool({
    name: 'msq_get_factory_run_step',
    description:
      'Get one factory step execution record by step run id. '
      + 'Use this for focused debugging of a specific step within a factory run.',
    parameters: FactoryStepIdsSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'GET',
        path: `core/factory-runs/${encodePathSegment(args.runId)}/steps/${encodePathSegment(args.stepRunId)}`,
      })

      return mapFactoryStep(parseFactoryStepRunResponse(response))
    },
  }),
  defineTool({
    name: 'msq_get_factory_run_step_hydrated',
    description:
      'Get one factory step execution plus linked workflow-run and chat-session details when they exist. '
      + 'Use this for deep debugging of workflow-backed or agent-backed steps.',
    parameters: FactoryStepIdsSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'GET',
        path: `core/factory-runs/${encodePathSegment(args.runId)}/steps/${encodePathSegment(args.stepRunId)}/hydrated`,
      })

      return mapFactoryStepHydrated(parseFactoryStepHydratedResponse(response))
    },
  }),
  defineTool({
    name: 'msq_pause_factory_run',
    description:
      'Pause a running factory run so it remains resumable. '
      + 'Preserves raw API noop responses because they are part of the run-control contract.',
    parameters: FactoryRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: `core/factory-runs/${encodePathSegment(args.runId)}/pause`,
      }),
  }),
  defineTool({
    name: 'msq_resume_factory_run',
    description:
      'Resume a paused factory run. '
      + 'Preserves raw API noop responses because resume is only valid from the paused state.',
    parameters: FactoryRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: `core/factory-runs/${encodePathSegment(args.runId)}/resume`,
      }),
  }),
  defineTool({
    name: 'msq_cancel_factory_run',
    description:
      'Cancel a factory run and report whether the cancellation happened now or had already happened.',
    parameters: FactoryRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: `core/factory-runs/${encodePathSegment(args.runId)}/cancel`,
      }),
  }),
  defineTool({
    name: 'msq_list_factory_schedules',
    description:
      'List all saved factory schedules in your MissionSquad account. '
      + 'Use this to discover scheduled factory automation.',
    parameters: EmptySchema,
    run: async (client) => {
      const response = await client.requestJson({
        method: 'GET',
        path: 'core/factory-schedules',
      })

      return mapFactoryScheduleList(parseFactoryScheduleListResponse(response))
    },
  }),
  defineTool({
    name: 'msq_create_factory_schedule',
    description:
      'Create a factory schedule using UTC `timesToRun` entries. '
      + 'Weekly schedules require `daysOfWeek`; monthly schedules require `dayOfMonth`.',
    parameters: FactoryScheduleCreateSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'POST',
        path: 'core/factory-schedules',
        body: args,
      })

      return mapFactorySchedule(parseFactoryScheduleResponse(response))
    },
  }),
  defineTool({
    name: 'msq_update_factory_schedule',
    description:
      'Update an existing factory schedule by id. '
      + 'Cadence fields are validated against the effective merged schedule state, so clearing weekly/monthly calendar fields is rejected when it would make the saved schedule invalid.',
    parameters: FactoryScheduleUpdateSchema,
    run: async (client, args) => {
      if (
        args.repeatInterval !== undefined
        || args.daysOfWeek !== undefined
        || args.dayOfMonth !== undefined
      ) {
        const schedules = await fetchFactorySchedules(client)
        const existing = schedules.find((schedule) => schedule.id === args.id) ?? null
        assertValidEffectiveFactoryScheduleUpdate(existing, args)
      }

      const { id, ...body } = args
      const response = await client.requestJson({
        method: 'PUT',
        path: `core/factory-schedules/${encodePathSegment(id)}`,
        body,
      })

      return mapFactorySchedule(parseFactoryScheduleResponse(response))
    },
  }),
  defineTool({
    name: 'msq_delete_factory_schedule',
    description: 'Delete a factory schedule by id.',
    parameters: FactoryScheduleIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `core/factory-schedules/${encodePathSegment(args.id)}`,
      }),
  }),
  defineTool({
    name: 'msq_toggle_factory_schedule',
    description:
      'Toggle a factory schedule between enabled and disabled without editing its other fields.',
    parameters: FactoryScheduleIdSchema,
    run: async (client, args) => {
      const response = await client.requestJson({
        method: 'POST',
        path: `core/factory-schedules/${encodePathSegment(args.id)}/toggle`,
      })

      return mapFactorySchedule(parseFactoryScheduleResponse(response))
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

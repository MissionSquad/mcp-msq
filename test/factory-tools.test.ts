import type { FastMCP } from '@missionsquad/fastmcp'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMissionSquadTools } from '../src/tools.js'

interface ToolContext {
  extraArgs?: Record<string, unknown>
}

interface RegisteredTool {
  name: string
  parameters: z.ZodTypeAny
  execute: (args: unknown, context: ToolContext) => Promise<string>
}

class FakeServer {
  public readonly tools = new Map<string, RegisteredTool>()

  public addTool(definition: RegisteredTool): void {
    this.tools.set(definition.name, definition)
  }

  public getTool(name: string): RegisteredTool {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }

    return tool
  }
}

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function sseResponse(chunks: string[], status: number = 200): Response {
  const encoder = new TextEncoder()

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  }), {
    status,
    headers: {
      'content-type': 'text/event-stream',
    },
  })
}

function buildFactoryConfig(id: string = 'fac-123') {
  return {
    id,
    userId: 'user-1',
    name: 'YouTube Summary Factory',
    description: 'Fetch transcript then summarize it',
    continuous: false,
    limitTotalInvocations: false,
    maxTotalInvocations: 10,
    steps: [
      {
        stepId: 'step-1',
        index: 0,
        name: 'Fetch transcript',
        kind: 'agent' as const,
        limitStepInvocations: false,
        agentRef: {
          agentId: 'agent-fetch',
        },
        maxStepInvocations: 1,
        transition: {
          kind: 'next' as const,
        },
      },
      {
        stepId: 'step-2',
        index: 1,
        name: 'Summarize transcript',
        kind: 'workflow' as const,
        limitStepInvocations: false,
        workflowRef: {
          workflowConfigId: 'wf-123',
          maxRepairAttempts: 0,
        },
        maxStepInvocations: 1,
        transition: {
          kind: 'stop' as const,
        },
      },
    ],
    createdAt: 100,
    updatedAt: 200,
  }
}

function buildFactoryRunRecord(
  status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error',
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    runId: 'run-123',
    factoryConfigId: 'fac-123',
    ownerUserId: 'user-1',
    factoryNameSnapshot: 'YouTube Summary Factory',
    configSnapshot: buildFactoryConfig(),
    trigger: 'manual' as const,
    status,
    cursor: {
      nextStepIndex: status === 'completed' || status === 'cancelled' || status === 'error' ? null : 1,
      iterationCount: 2,
      completedCycleCount: 1,
    },
    carryPayload: status === 'completed' ? '{"summary":"final output"}' : 'intermediate output',
    aggregateUsage: {
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    },
    perStepInvocationCounts: {
      'step-1': 1,
      'step-2': 1,
    },
    startedAt: 1000,
    completedAt: status === 'completed' || status === 'cancelled' || status === 'error' ? 2000 : undefined,
    cancelledAt: status === 'cancelled' ? 2000 : undefined,
    pausedAt: status === 'paused' ? 1500 : undefined,
    errorMessage:
      status === 'error'
        ? 'step failed'
        : status === 'cancelled'
          ? 'user_cancelled'
          : undefined,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

function buildFactoryStepRunRecord(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    stepRunId: 'step-run-123',
    runId: 'run-123',
    ownerUserId: 'user-1',
    factoryConfigId: 'fac-123',
    stepId: 'step-2',
    stepIndex: 1,
    stepName: 'Summarize transcript',
    sequence: 2,
    kind: 'workflow' as const,
    invoked: {
      kind: 'workflow' as const,
      workflowConfigId: 'wf-123',
      workflowName: 'summary-workflow',
    },
    triggeredBy: 'previous_step_output' as const,
    upstreamStepRunId: 'step-run-122',
    input: '{"transcript":"..."}',
    output: '{"summary":"done"}',
    workflowDataPayloadIn: '{"transcript":"..."}',
    workflowRunId: 'wf-run-123',
    chatId: 'chat-123',
    validation: {
      schemaPresent: true,
      initialOutcome: 'pass' as const,
      repairAttempts: 0,
      finalOutcome: 'pass' as const,
    },
    status: 'completed' as const,
    startedAt: 1200,
    completedAt: 1600,
    usage: {
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
    },
    toolEvents: [],
    createdAt: 1200,
    updatedAt: 1600,
    ...overrides,
  }
}

function buildWorkflowRunRecord() {
  return {
    runId: 'wf-run-123',
    workflowConfigId: 'wf-123',
    ownerUserId: 'user-1',
    workflowNameSnapshot: 'summary-workflow',
    status: 'completed' as const,
    startedAt: 1000,
    completedAt: 1800,
    cancelledAt: null,
    errorMessage: null,
    aggregateUsage: {
      promptTokens: 5,
      completionTokens: 6,
      totalTokens: 11,
    },
    helpers: [],
    main: {
      sessionId: 'session-main',
      chatId: 'chat-main',
      agentId: 'agent-main',
      agentName: 'Coordinator',
      agentSlug: 'coordinator',
      status: 'completed' as const,
      startedAt: 1100,
      completedAt: 1800,
      errorMessage: null,
      usage: {
        promptTokens: 5,
        completionTokens: 6,
        totalTokens: 11,
      },
    },
    resumeSnapshot: {
      main: {
        previewContent: 'summary output',
      },
    },
    createdAt: 1000,
    updatedAt: 1800,
  }
}

function buildFactoryHydratedStepRecord() {
  return {
    stepRun: buildFactoryStepRunRecord(),
    workflowRun: {
      record: buildWorkflowRunRecord(),
      mainChat: {
        id: 'chat-main',
        agentSlug: 'coordinator',
        messages: [
          { role: 'user', content: 'workflow input' },
          { role: 'assistant', content: 'workflow output' },
        ],
      },
      helperChats: [],
    },
    chatSession: {
      id: 'chat-123',
      userId: 'user-1',
      agentUsername: 'user-1',
      agentSlug: 'summary-agent',
      origin: 'factory' as const,
      title: 'Factory step chat',
      createdAt: 1200,
      updatedAt: 1600,
      messages: [
        { role: 'user', content: 'input' },
        { role: 'assistant', content: 'output' },
      ],
    },
  }
}

function buildFactoryScheduleRecord(id: string = 'sched-123') {
  return {
    id,
    userId: 'user-1',
    factoryConfigId: 'fac-123',
    label: 'Weekday summary',
    startDate: 1700000000000,
    timesToRun: [
      { hour: 19, minute: 15 },
    ],
    repeatInterval: 'weekly' as const,
    daysOfWeek: [1, 2, 3, 4, 5],
    status: 'enabled' as const,
    nextRunAt: 1700003600000,
    initialCarryPayload: '{"topic":"ai"}',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  }
}

function getRequest(fetchMock: ReturnType<typeof vi.fn>) {
  return getRequestAt(fetchMock, fetchMock.mock.calls.length - 1)
}

function getRequestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const latestCall = fetchMock.mock.calls.at(index)
  if (!latestCall) {
    throw new Error('Expected fetch to be called')
  }

  const [url, init] = latestCall as [string | URL | Request, RequestInit | undefined]
  const requestUrl = typeof url === 'string' ? new URL(url) : url instanceof URL ? url : new URL(url.url)

  return {
    url: requestUrl,
    init: init ?? {},
  }
}

describe('MissionSquad factory tools', () => {
  const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
  let server: FakeServer

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    server = new FakeServer()
    registerMissionSquadTools(server as unknown as FastMCP<undefined>)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function callTool(name: string, args: unknown): Promise<unknown> {
    const tool = server.getTool(name)
    const parsedArgs = tool.parameters.parse(args)
    const result = await tool.execute(parsedArgs, {
      extraArgs: { apiKey: 'msq-test-key' },
    })

    return JSON.parse(result)
  }

  it('lists factories and preserves API order', async () => {
    const factories = [buildFactoryConfig('fac-1'), buildFactoryConfig('fac-2')]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: factories }))

    const result = await callTool('msq_list_factories', {})
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/factories')
    expect(init.method).toBe('GET')
    expect(result).toEqual({ factories })
  })

  it('gets a factory by direct id endpoint', async () => {
    const factory = buildFactoryConfig('fac-2')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: factory }))

    const result = await callTool('msq_get_factory', { id: 'fac-2' })
    const { url } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/factories/fac-2')
    expect(result).toEqual({ factory })
  })

  it('creates and updates factories with the verified request shape', async () => {
    const createdFactory = buildFactoryConfig('fac-created')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: createdFactory }))

    const createPayload = {
      name: 'Factory created',
      steps: [
        {
          kind: 'agent' as const,
          name: 'Step one',
          maxStepInvocations: 1,
          transition: { kind: 'stop' as const },
          agentRef: { agentId: 'agent-1' },
        },
      ],
    }

    const createResult = await callTool('msq_create_factory', createPayload)
    const createRequest = getRequestAt(fetchMock, 0)

    expect(createRequest.url.pathname).toBe('/v1/core/factories')
    expect(createRequest.init.method).toBe('POST')
    expect(JSON.parse(String(createRequest.init.body))).toEqual(createPayload)
    expect(createResult).toEqual({ factory: createdFactory })

    const updatedFactory = buildFactoryConfig('fac-updated')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: updatedFactory }))

    const updateResult = await callTool('msq_update_factory', {
      id: 'fac-updated',
      description: 'Updated factory',
      continuous: true,
    })
    const updateRequest = getRequestAt(fetchMock, 1)

    expect(updateRequest.url.pathname).toBe('/v1/core/factories/fac-updated')
    expect(updateRequest.init.method).toBe('PUT')
    expect(JSON.parse(String(updateRequest.init.body))).toEqual({
      description: 'Updated factory',
      continuous: true,
    })
    expect(updateResult).toEqual({ factory: updatedFactory })
  })

  it('deletes factories and preserves the raw API response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, message: 'Deleted' }))

    const result = await callTool('msq_delete_factory', { id: 'fac-123' })
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/factories/fac-123')
    expect(init.method).toBe('DELETE')
    expect(result).toEqual({ success: true, message: 'Deleted' })
  })

  it('lists factory runs with compact summaries and applies default pagination', async () => {
    const runs = [
      buildFactoryRunRecord('queued'),
      buildFactoryRunRecord('completed', { runId: 'run-456' }),
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: runs }))

    const result = await callTool('msq_list_factory_runs', { factoryId: 'fac-123' })
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/factories/fac-123/runs')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('offset')).toBe('0')
    expect(result).toEqual({
      runs: [
        {
          runId: 'run-123',
          factoryId: 'fac-123',
          factoryName: 'YouTube Summary Factory',
          trigger: 'manual',
          status: 'queued',
          cursor: {
            nextStepIndex: 1,
            iterationCount: 2,
            completedCycleCount: 1,
          },
          startedAt: 1000,
          completedAt: undefined,
          cancelledAt: undefined,
          pausedAt: undefined,
          aggregateUsage: {
            promptTokens: 20,
            completionTokens: 10,
            totalTokens: 30,
          },
          perStepInvocationCounts: {
            'step-1': 1,
            'step-2': 1,
          },
        },
        {
          runId: 'run-456',
          factoryId: 'fac-123',
          factoryName: 'YouTube Summary Factory',
          trigger: 'manual',
          status: 'completed',
          cursor: {
            nextStepIndex: null,
            iterationCount: 2,
            completedCycleCount: 1,
          },
          startedAt: 1000,
          completedAt: 2000,
          cancelledAt: undefined,
          pausedAt: undefined,
          aggregateUsage: {
            promptTokens: 20,
            completionTokens: 10,
            totalTokens: 30,
          },
          perStepInvocationCounts: {
            'step-1': 1,
            'step-2': 1,
          },
        },
      ],
    })
  })

  it('starts factory runs with and without an initial carry payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, runId: 'run-123', data: buildFactoryRunRecord('queued') }, 202))

    const firstResult = await callTool('msq_run_factory', { factoryConfigId: 'fac-123' })
    const firstRequest = getRequestAt(fetchMock, 0)

    expect(firstRequest.url.pathname).toBe('/v1/core/factory-runs')
    expect(JSON.parse(String(firstRequest.init.body))).toEqual({ factoryConfigId: 'fac-123' })
    expect(firstResult).toMatchObject({
      runId: 'run-123',
      factoryId: 'fac-123',
      factoryName: 'YouTube Summary Factory',
      status: 'queued',
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, runId: 'run-456', data: buildFactoryRunRecord('queued', { runId: 'run-456' }) }, 202))

    await callTool('msq_run_factory', {
      factoryConfigId: 'fac-123',
      initialCarryPayload: '{"topic":"ai"}',
    })
    const secondRequest = getRequestAt(fetchMock, 1)

    expect(JSON.parse(String(secondRequest.init.body))).toEqual({
      factoryConfigId: 'fac-123',
      initialCarryPayload: '{"topic":"ai"}',
    })
  })

  it('returns terminal factory status immediately without streaming', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('completed') }))

    const result = await callTool('msq_get_factory_run_status', { runId: 'run-123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      runId: 'run-123',
      status: 'completed',
      factoryId: 'fac-123',
    })
  })

  it('waits for a running factory to complete via SSE before returning status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('running') }))
    fetchMock.mockResolvedValueOnce(sseResponse([
      `data: ${JSON.stringify({ type: 'snapshot', record: buildFactoryRunRecord('running') })}\n\n`,
      `data: ${JSON.stringify({ type: 'run_completed' })}\n\n`,
      'data: [DONE]\n\n',
    ]))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('completed') }))

    const result = await callTool('msq_get_factory_run_status', { runId: 'run-123' })

    expect(getRequestAt(fetchMock, 0).url.pathname).toBe('/v1/core/factory-runs/run-123')
    expect(getRequestAt(fetchMock, 1).url.pathname).toBe('/v1/core/factory-runs/run-123/stream')
    expect(getRequestAt(fetchMock, 2).url.pathname).toBe('/v1/core/factory-runs/run-123')
    expect(result).toMatchObject({
      runId: 'run-123',
      status: 'completed',
    })
  })

  it('reconnects when the factory stream closes before completion and keeps waiting', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('running') }))
    fetchMock.mockResolvedValueOnce(sseResponse([
      ':factory-heartbeat 1\n\n',
    ]))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('running') }))
    fetchMock.mockResolvedValueOnce(sseResponse([
      ':factory-heartbeat 2\n\n',
      `data: ${JSON.stringify({ type: 'run_completed' })}\n\n`,
      'data: [DONE]\n\n',
    ]))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('completed') }))

    const result = await callTool('msq_get_factory_run_status', { runId: 'run-123' })

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(getRequestAt(fetchMock, 1).url.pathname).toBe('/v1/core/factory-runs/run-123/stream')
    expect(getRequestAt(fetchMock, 3).url.pathname).toBe('/v1/core/factory-runs/run-123/stream')
    expect(result).toMatchObject({
      runId: 'run-123',
      status: 'completed',
    })
  })

  it('returns paused factory status when the stream emits run_paused', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('running') }))
    fetchMock.mockResolvedValueOnce(sseResponse([
      `data: ${JSON.stringify({ type: 'run_paused' })}\n\n`,
    ]))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('paused') }))

    const result = await callTool('msq_get_factory_run_status', { runId: 'run-123' })

    expect(result).toMatchObject({
      runId: 'run-123',
      status: 'paused',
      pausedAt: 1500,
    })
  })

  it('returns completed factory results and errors for non-completed states', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord('completed') }))

    const successResult = await callTool('msq_get_factory_result', { runId: 'run-123' })
    expect(successResult).toEqual({
      runId: 'run-123',
      factoryId: 'fac-123',
      factoryName: 'YouTube Summary Factory',
      trigger: 'manual',
      status: 'completed',
      startedAt: 1000,
      completedAt: 2000,
      cursor: {
        nextStepIndex: null,
        iterationCount: 2,
        completedCycleCount: 1,
      },
      aggregateUsage: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
      perStepInvocationCounts: {
        'step-1': 1,
        'step-2': 1,
      },
      result: {
        carryPayload: '{"summary":"final output"}',
      },
    })

    const scenarios = [
      { status: 'queued' as const, expected: 'Factory result not ready. Use msq_get_factory_run_status.' },
      { status: 'running' as const, expected: 'Factory result not ready. Use msq_get_factory_run_status.' },
      { status: 'paused' as const, expected: 'Factory run is paused. Resume it or inspect status first.' },
      { status: 'error' as const, expected: 'Factory did not complete successfully. step failed' },
      { status: 'cancelled' as const, expected: 'Factory did not complete successfully. user_cancelled' },
    ]

    for (const scenario of scenarios) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryRunRecord(scenario.status) }))
      await expect(callTool('msq_get_factory_result', { runId: 'run-123' })).rejects.toThrow(scenario.expected)
    }
  })

  it('lists step runs with default pagination and fetches step detail and hydrated detail', async () => {
    const step = buildFactoryStepRunRecord()
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [step] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: step }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: buildFactoryHydratedStepRecord() }))

    const listResult = await callTool('msq_list_factory_run_steps', { runId: 'run-123' })
    const listRequest = getRequestAt(fetchMock, 0)

    expect(listRequest.url.pathname).toBe('/v1/core/factory-runs/run-123/steps')
    expect(listRequest.url.searchParams.get('limit')).toBe('50')
    expect(listRequest.url.searchParams.get('offset')).toBe('0')
    expect(listResult).toEqual({ steps: [step] })

    const stepResult = await callTool('msq_get_factory_run_step', {
      runId: 'run-123',
      stepRunId: 'step-run-123',
    })
    expect(getRequestAt(fetchMock, 1).url.pathname).toBe('/v1/core/factory-runs/run-123/steps/step-run-123')
    expect(stepResult).toEqual({ step })

    const hydratedResult = await callTool('msq_get_factory_run_step_hydrated', {
      runId: 'run-123',
      stepRunId: 'step-run-123',
    })
    expect(getRequestAt(fetchMock, 2).url.pathname).toBe('/v1/core/factory-runs/run-123/steps/step-run-123/hydrated')
    expect(hydratedResult).toEqual(buildFactoryHydratedStepRecord())
  })

  it('preserves raw pause, resume, and cancel control responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      noop: true,
      message: 'Run cannot be paused because it is already in terminal state completed.',
      data: { runId: 'run-123', status: 'completed' },
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      noop: true,
      message: 'Run must be paused to resume. Current status: running.',
      data: { runId: 'run-123', status: 'running' },
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      found: true,
      cancelled: false,
      alreadyCancelled: true,
    }))

    expect(await callTool('msq_pause_factory_run', { runId: 'run-123' })).toEqual({
      success: true,
      noop: true,
      message: 'Run cannot be paused because it is already in terminal state completed.',
      data: { runId: 'run-123', status: 'completed' },
    })
    expect(await callTool('msq_resume_factory_run', { runId: 'run-123' })).toEqual({
      success: true,
      noop: true,
      message: 'Run must be paused to resume. Current status: running.',
      data: { runId: 'run-123', status: 'running' },
    })
    expect(await callTool('msq_cancel_factory_run', { runId: 'run-123' })).toEqual({
      success: true,
      found: true,
      cancelled: false,
      alreadyCancelled: true,
    })
  })

  it('lists, creates, updates, deletes, and toggles factory schedules', async () => {
    const schedule = buildFactoryScheduleRecord()
    const updatedSchedule = buildFactoryScheduleRecord('sched-123')
    updatedSchedule.status = 'disabled'
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [schedule] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: schedule }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: updatedSchedule }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: updatedSchedule }))

    expect(await callTool('msq_list_factory_schedules', {})).toEqual({ schedules: [schedule] })

    const createPayload = {
      factoryConfigId: 'fac-123',
      label: 'Weekday summary',
      timesToRun: [{ hour: 19, minute: 15 }],
      repeatInterval: 'weekly' as const,
      daysOfWeek: [1, 2, 3, 4, 5],
      initialCarryPayload: '{"topic":"ai"}',
    }
    expect(await callTool('msq_create_factory_schedule', createPayload)).toEqual({ schedule })
    expect(JSON.parse(String(getRequestAt(fetchMock, 1).init.body))).toEqual(createPayload)

    const updatePayload = {
      id: 'sched-123',
      status: 'disabled' as const,
      repeatInterval: 'weekly' as const,
      daysOfWeek: [1, 2, 3, 4, 5],
    }
    expect(await callTool('msq_update_factory_schedule', updatePayload)).toEqual({ schedule: updatedSchedule })
    expect(getRequestAt(fetchMock, 2).url.pathname).toBe('/v1/core/factory-schedules/sched-123')
    expect(JSON.parse(String(getRequestAt(fetchMock, 2).init.body))).toEqual({
      status: 'disabled',
      repeatInterval: 'weekly',
      daysOfWeek: [1, 2, 3, 4, 5],
    })

    expect(await callTool('msq_delete_factory_schedule', { id: 'sched-123' })).toEqual({ success: true })
    expect(getRequestAt(fetchMock, 3).url.pathname).toBe('/v1/core/factory-schedules/sched-123')

    expect(await callTool('msq_toggle_factory_schedule', { id: 'sched-123' })).toEqual({ schedule: updatedSchedule })
    expect(getRequestAt(fetchMock, 4).url.pathname).toBe('/v1/core/factory-schedules/sched-123/toggle')
    expect(getRequestAt(fetchMock, 4).init.method).toBe('POST')
  })

  it('validates weekly and monthly schedule requirements before execution', async () => {
    await expect(callTool('msq_create_factory_schedule', {
      factoryConfigId: 'fac-123',
      timesToRun: [{ hour: 19, minute: 15 }],
      repeatInterval: 'weekly',
    })).rejects.toThrow('daysOfWeek is required for weekly schedules')

    await expect(callTool('msq_update_factory_schedule', {
      id: 'sched-123',
      repeatInterval: 'monthly',
    })).rejects.toThrow('dayOfMonth is required when repeatInterval is monthly')
  })
})

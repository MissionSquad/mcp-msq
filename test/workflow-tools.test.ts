import type { FastMCP } from '@missionsquad/fastmcp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMissionSquadTools } from '../src/tools.js'

interface ToolContext {
  extraArgs?: Record<string, unknown>
}

interface RegisteredTool {
  name: string
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

function buildWorkflowConfig(id: string) {
  return {
    id,
    userId: 'user-1',
    name: `Workflow ${id}`,
    mainAgentId: 'agent-main',
    mainPrompt: 'Prompt',
    dataPayload: '{"source":"https://example.com"}',
    concurrency: 2,
    delimiter: '|#|',
    failureMessage: 'Helper failed',
    failureInstruction: 'Continue carefully',
    createdAt: 100,
    updatedAt: 200,
  }
}

function buildWorkflowRunRecord(
  status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled',
  mainStatus: 'pending' | 'queued' | 'running' | 'completed' | 'error' | 'cancelled',
) {
  return {
    runId: 'run-123',
    workflowConfigId: 'wf-123',
    ownerUserId: 'user-1',
    workflowNameSnapshot: 'Research Workflow',
    status,
    startedAt: 1000,
    completedAt: status === 'completed' || status === 'error' || status === 'cancelled' ? 2000 : undefined,
    cancelledAt: status === 'cancelled' ? 2000 : undefined,
    errorMessage: status === 'error' ? 'main failed' : status === 'cancelled' ? 'user_cancelled' : undefined,
    aggregateUsage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
    helpers: [
      {
        helperRunId: 'helper-1',
        patternIndex: 0,
        agentId: 'agent-helper',
        agentName: 'collector',
        agentSlug: 'collector',
        sessionId: 'session-helper',
        chatId: 'chat-helper',
        resolvedInput: 'sensitive helper input',
        status: 'completed',
        startedAt: 1100,
        completedAt: 1200,
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
        },
      },
    ],
    main: {
      sessionId: 'session-main',
      chatId: 'chat-main',
      agentId: 'agent-main',
      agentName: 'Coordinator',
      agentSlug: 'coordinator',
      status: mainStatus,
      startedAt: 1300,
      completedAt: mainStatus === 'completed' || mainStatus === 'error' || mainStatus === 'cancelled' ? 2000 : undefined,
      errorMessage: mainStatus === 'error' ? 'main failed' : undefined,
      usage: {
        promptTokens: 4,
        completionTokens: 5,
        totalTokens: 9,
      },
    },
    resumeSnapshot: {
      schemaVersion: 1,
      phase: status === 'completed' ? 'completed' : status === 'running' ? 'main' : status,
      helpers: [
        {
          helperRunId: 'helper-1',
          patternIndex: 0,
          agentName: 'collector',
          agentId: 'agent-helper',
          agentSlug: 'collector',
          sessionId: 'session-helper',
          chatId: 'chat-helper',
          status: 'completed',
          previewContent: 'helper preview content',
          usage: {
            promptTokens: 1,
            completionTokens: 2,
            totalTokens: 3,
          },
        },
      ],
      main: {
        agentId: 'agent-main',
        agentName: 'Coordinator',
        agentSlug: 'coordinator',
        sessionId: 'session-main',
        chatId: 'chat-main',
        status: mainStatus,
        previewContent: 'Final synthesized answer from the main agent',
        usage: {
          promptTokens: 4,
          completionTokens: 5,
          totalTokens: 9,
        },
      },
      aggregateUsage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
      updatedAt: 2000,
    },
    createdAt: 1000,
    updatedAt: 2000,
  }
}

function getRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const latestCall = fetchMock.mock.calls.at(-1)
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

describe('MissionSquad workflow tools', () => {
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
    const result = await server.getTool(name).execute(args, {
      extraArgs: { apiKey: 'msq-test-key' },
    })

    return JSON.parse(result)
  }

  it('lists workflows using the workflow config endpoint and preserves API order', async () => {
    const workflows = [buildWorkflowConfig('wf-1'), buildWorkflowConfig('wf-2')]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: workflows }))

    const result = await callTool('msq_list_workflows', {})
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/workflows')
    expect(init.method).toBe('GET')
    expect(result).toEqual({ workflows })
  })

  it('lists installed and enabled servers in a compact shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      servers: [
        {
          name: 'weather-server',
          displayName: 'Weather Server',
          transportType: 'stdio',
          description: 'Weather tools',
          installed: true,
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: { NODE_ENV: 'production' },
        },
        {
          name: 'disabled-server',
          displayName: 'Disabled Server',
          transportType: 'streamable_http',
          description: 'Should be omitted',
          installed: true,
          enabled: false,
        },
      ],
    }))

    const result = await callTool('msq_list_servers', {})
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/servers')
    expect(init.method).toBe('GET')
    expect(result).toEqual({
      servers: [
        {
          name: 'weather-server',
          displayName: 'Weather Server',
          transportType: 'stdio',
          description: 'Weather tools',
        },
      ],
    })
  })

  it('lists tools for a single server using the per-server MCP route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      tools: [
        {
          name: 'weather',
          description: 'Get weather information',
          inputSchema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
          },
        },
      ],
    }))

    const result = await callTool('msq_list_server_tools', { serverName: 'weather-server' })
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/mcp/servers/weather-server/tools')
    expect(init.method).toBe('GET')
    expect(result).toEqual({
      success: true,
      tools: [
        {
          name: 'weather',
          description: 'Get weather information',
          inputSchema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
          },
        },
      ],
    })
  })

  it('gets a workflow by exact id match and errors when missing', async () => {
    const workflows = [buildWorkflowConfig('wf-1'), buildWorkflowConfig('wf-2')]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: workflows }))

    const result = await callTool('msq_get_workflow', { id: 'wf-2' })

    expect(result).toEqual({ workflow: workflows[1] })

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: workflows }))

    await expect(callTool('msq_get_workflow', { id: 'wf-missing' })).rejects.toThrow('Workflow config not found')
  })

  it('creates a workflow with the verified request body shape', async () => {
    const workflow = buildWorkflowConfig('wf-created')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: workflow }))

    const payload = {
      id: 'wf-created',
      name: 'Research Workflow',
      mainAgentId: 'agent-main',
      mainPrompt: 'Prompt',
      dataPayload: '{"source":"https://example.com"}',
      concurrency: 2,
      delimiter: '|#|',
      failureMessage: 'Helper failed',
      failureInstruction: 'Continue carefully',
    }

    const result = await callTool('msq_create_workflow', payload)
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/workflows')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(payload)
    expect(result).toEqual({ workflow })
  })

  it('updates a workflow using id only in the URL, not in the body', async () => {
    const workflow = buildWorkflowConfig('wf-updated')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: workflow }))

    const result = await callTool('msq_update_workflow', {
      id: 'wf-updated',
      name: 'Updated Workflow',
      mainPrompt: 'Updated prompt',
    })
    const { url, init } = getRequest(fetchMock)
    const requestBody = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(url.pathname).toBe('/v1/core/workflows/wf-updated')
    expect(init.method).toBe('PUT')
    expect(requestBody).toEqual({
      name: 'Updated Workflow',
      mainPrompt: 'Updated prompt',
    })
    expect(requestBody).not.toHaveProperty('id')
    expect(result).toEqual({ workflow })
  })

  it('starts a workflow run and returns the run summary', async () => {
    const record = buildWorkflowRunRecord('queued', 'pending')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, runId: 'run-123', data: record }, 202))

    const result = await callTool('msq_run_workflow', { workflowId: 'wf-123' })
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/workflow-runs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ workflowId: 'wf-123' })
    expect(result).toEqual({
      runId: 'run-123',
      workflowId: 'wf-123',
      workflowName: 'Research Workflow',
      status: 'queued',
      startedAt: 1000,
    })
  })

  it('returns filtered workflow run status without helper or main content fields', async () => {
    const record = buildWorkflowRunRecord('running', 'running')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: record }))

    const result = await callTool('msq_get_workflow_run_status', { runId: 'run-123' })
    const { url, init } = getRequest(fetchMock)
    const statusResult = result as Record<string, unknown>
    const helpers = statusResult.helpers as Array<Record<string, unknown>>
    const main = statusResult.main as Record<string, unknown>

    expect(url.pathname).toBe('/v1/core/workflow-runs/run-123')
    expect(init.method).toBe('GET')
    expect(statusResult).toMatchObject({
      runId: 'run-123',
      workflowId: 'wf-123',
      workflowName: 'Research Workflow',
      status: 'running',
      main: {
        agentId: 'agent-main',
        agentName: 'Coordinator',
        status: 'running',
      },
    })
    expect(main).not.toHaveProperty('chatId')
    expect(main).not.toHaveProperty('sessionId')
    expect(main).not.toHaveProperty('content')
    expect(helpers[0]).not.toHaveProperty('resolvedInput')
    expect(helpers[0]).not.toHaveProperty('chatId')
    expect(helpers[0]).not.toHaveProperty('sessionId')
  })

  it('returns only the main-agent result for a completed run', async () => {
    const record = buildWorkflowRunRecord('completed', 'completed')
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: record }))

    const result = await callTool('msq_get_workflow_result', { runId: 'run-123' })
    const resultRecord = result as Record<string, unknown>
    const nestedResult = resultRecord.result as Record<string, unknown>

    expect(resultRecord).toEqual({
      runId: 'run-123',
      workflowId: 'wf-123',
      workflowName: 'Research Workflow',
      status: 'completed',
      startedAt: 1000,
      completedAt: 2000,
      result: {
        agentId: 'agent-main',
        agentName: 'Coordinator',
        content: 'Final synthesized answer from the main agent',
        usage: {
          promptTokens: 4,
          completionTokens: 5,
          totalTokens: 9,
        },
      },
      aggregateUsage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    })
    expect(resultRecord).not.toHaveProperty('helpers')
    expect(nestedResult).not.toHaveProperty('helperContent')
  })

  it('errors when workflow result is not ready or not successful', async () => {
    const scenarios = [
      {
        status: 'queued' as const,
        mainStatus: 'pending' as const,
        expectedMessage: 'Workflow result not ready. Use msq_get_workflow_run_status.',
      },
      {
        status: 'running' as const,
        mainStatus: 'running' as const,
        expectedMessage: 'Workflow result not ready. Use msq_get_workflow_run_status.',
      },
      {
        status: 'error' as const,
        mainStatus: 'error' as const,
        expectedMessage: 'Workflow did not complete successfully. main failed',
      },
      {
        status: 'cancelled' as const,
        mainStatus: 'cancelled' as const,
        expectedMessage: 'Workflow did not complete successfully. user_cancelled',
      },
    ]

    for (const scenario of scenarios) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: buildWorkflowRunRecord(scenario.status, scenario.mainStatus),
        }),
      )

      await expect(callTool('msq_get_workflow_result', { runId: 'run-123' })).rejects.toThrow(
        scenario.expectedMessage,
      )
    }
  })

  it('errors when a completed run does not have a completed main agent state', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: buildWorkflowRunRecord('completed', 'running'),
    }))

    await expect(callTool('msq_get_workflow_result', { runId: 'run-123' })).rejects.toThrow(
      'Workflow completed without a completed main agent state.',
    )
  })
})

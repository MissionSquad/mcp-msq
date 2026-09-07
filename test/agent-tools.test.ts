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

function buildPublishedAgent(overrides: Partial<{
  agentId: string
  agentName: string
  isPublished: boolean
}> = {}) {
  return {
    userId: 'user-1',
    username: 'user-1',
    agentId: overrides.agentId ?? 'agent-1',
    agentName: overrides.agentName ?? 'Researcher',
    slug: 'researcher',
    isPublished: overrides.isPublished ?? true,
    publishedAt: 100,
    updatedAt: 200,
  }
}

function getRequestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const call = fetchMock.mock.calls.at(index)
  if (!call) {
    throw new Error(`Expected fetch call at index ${index}`)
  }

  const [url, init] = call as [string | URL | Request, RequestInit | undefined]
  const requestUrl = typeof url === 'string' ? new URL(url) : url instanceof URL ? url : new URL(url.url)

  return {
    url: requestUrl,
    init: init ?? {},
  }
}

describe('MissionSquad agent publishing tools', () => {
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

  it('publishes an unpublished agent after checking current publish records', async () => {
    const publishedAgent = buildPublishedAgent()
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: publishedAgent }))

    const result = await callTool('msq_publish_agent', {
      agentId: 'agent-1',
      agentName: 'Researcher',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getRequestAt(fetchMock, 0).url.pathname).toBe('/v1/core/agents/published')
    expect(getRequestAt(fetchMock, 0).init.method).toBe('GET')
    expect(getRequestAt(fetchMock, 1).url.pathname).toBe('/v1/core/agents/publish')
    expect(getRequestAt(fetchMock, 1).init.method).toBe('POST')
    expect(JSON.parse(String(getRequestAt(fetchMock, 1).init.body))).toEqual({
      agentId: 'agent-1',
      agentName: 'Researcher',
    })
    expect(result).toEqual({
      success: true,
      alreadyPublished: false,
      data: publishedAgent,
    })
  })

  it('does not toggle an agent that is already published', async () => {
    const publishedAgent = buildPublishedAgent()
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [publishedAgent] }))

    const result = await callTool('msq_publish_agent', {
      agentId: 'agent-1',
      agentName: 'Researcher',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: true,
      alreadyPublished: true,
      data: publishedAgent,
    })
  })

  it.each([
    {
      label: 'permission',
      status: 403,
      body: { success: false, message: 'Publishing is not enabled.' },
    },
    {
      label: 'licensing',
      status: 429,
      body: { success: false, error: 'LIMIT_EXCEEDED', limitKey: 'maxPublishedAgents' },
    },
  ])('fails direct publishing on $label API errors', async ({ status, body }) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }))
    fetchMock.mockResolvedValueOnce(jsonResponse(body, status))

    await expect(callTool('msq_publish_agent', {
      agentId: 'agent-1',
      agentName: 'Researcher',
    })).rejects.toThrow(`MissionSquad API returned ${status}`)
  })

  it('fails direct publishing on transport errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket closed'))

    await expect(callTool('msq_publish_agent', {
      agentId: 'agent-1',
      agentName: 'Researcher',
    })).rejects.toThrow('request failed before receiving a response')
  })

  it('automatically publishes a successfully created agent', async () => {
    const created = {
      status: 'success',
      message: 'Agent Researcher added successfully.',
      data: { id: 'agent-1', name: 'Researcher' },
    }
    const publishedAgent = buildPublishedAgent()
    fetchMock.mockResolvedValueOnce(jsonResponse(created))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: publishedAgent }))

    const result = await callTool('msq_add_agent', {
      name: 'Researcher',
      description: 'Research agent',
      systemPrompt: 'Research carefully.',
      model: 'model-name',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getRequestAt(fetchMock, 0).url.pathname).toBe('/v1/core/add/agent')
    expect(getRequestAt(fetchMock, 1).url.pathname).toBe('/v1/core/agents/published')
    expect(JSON.parse(String(getRequestAt(fetchMock, 2).init.body))).toEqual({
      agentId: 'agent-1',
      agentName: 'Researcher',
    })
    expect(result).toEqual({
      ...created,
      publish: {
        success: true,
        alreadyPublished: false,
        data: publishedAgent,
      },
    })
  })

  it('does not unpublish an already-published agent during overwrite', async () => {
    const created = {
      status: 'success',
      message: 'Agent Researcher added successfully.',
      data: { id: 'agent-1', name: 'Researcher' },
    }
    const publishedAgent = buildPublishedAgent()
    fetchMock.mockResolvedValueOnce(jsonResponse(created))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [publishedAgent] }))

    const result = await callTool('msq_add_agent', {
      name: 'Researcher',
      description: 'Updated research agent',
      systemPrompt: 'Research more carefully.',
      model: 'model-name',
      overwrite: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      ...created,
      publish: {
        success: true,
        alreadyPublished: true,
        data: publishedAgent,
      },
    })
  })

  it('returns a partial result when creation succeeds but publishing fails', async () => {
    const created = {
      status: 'success',
      message: 'Agent Researcher added successfully.',
      data: { id: 'agent-1', name: 'Researcher' },
    }
    const publishError = {
      success: false,
      error: 'LIMIT_EXCEEDED',
      limitKey: 'maxPublishedAgents',
      limit: 5,
      remaining: 0,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(created))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }))
    fetchMock.mockResolvedValueOnce(jsonResponse(publishError, 429))

    const result = await callTool('msq_add_agent', {
      name: 'Researcher',
      description: 'Research agent',
      systemPrompt: 'Research carefully.',
      model: 'model-name',
    })

    expect(result).toEqual({
      ...created,
      publish: {
        success: false,
        error: 'Automatic agent publishing failed: MissionSquad API returned 429 . LIMIT_EXCEEDED',
        status: 429,
        details: publishError,
      },
    })
  })

  it('does not attempt publishing when agent creation fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'error',
      message: 'Agent already exists.',
    }, 409))

    await expect(callTool('msq_add_agent', {
      name: 'Researcher',
      description: 'Research agent',
      systemPrompt: 'Research carefully.',
      model: 'model-name',
    })).rejects.toThrow('Agent already exists.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid publish-list responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: null }))

    await expect(callTool('msq_publish_agent', {
      agentId: 'agent-1',
      agentName: 'Researcher',
    })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects publish responses that leave the target unpublished', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: buildPublishedAgent({ isPublished: false }),
    }))

    await expect(callTool('msq_publish_agent', {
      agentId: 'agent-1',
      agentName: 'Researcher',
    })).rejects.toThrow('did not publish agent')
  })
})

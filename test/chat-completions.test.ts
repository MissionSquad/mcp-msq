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

function chunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function getLatestRequest(fetchMock: ReturnType<typeof vi.fn>) {
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

describe('msq_chat_completions streaming', () => {
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

  async function callTool(name: string, args: unknown, extraArgs: Record<string, unknown> = { apiKey: 'msq-test-key' }): Promise<unknown> {
    const result = await server.getTool(name).execute(args, { extraArgs })

    return JSON.parse(result)
  }

  it('streams the request and assembles the chunks into a chat completion', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      chunk({ id: 'cmpl-1', created: 1700, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] }),
      chunk({ id: 'cmpl-1', created: 1700, model: 'gpt-4o', choices: [{ index: 0, delta: { content: ', world' }, finish_reason: null }] }),
      chunk({ id: 'cmpl-1', created: 1700, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]))

    const result = await callTool('msq_chat_completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      xClientId: 'client-1',
      xSessionId: 'session-1',
    })

    const { url, init } = getLatestRequest(fetchMock)
    const headers = init.headers as Record<string, string>
    const requestBody = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(url.pathname).toBe('/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(headers.Accept).toBe('text/event-stream')
    expect(headers['x-client-id']).toBe('client-1')
    expect(headers['x-session-id']).toBe('session-1')
    expect(requestBody.stream).toBe(true)
    expect(requestBody).not.toHaveProperty('xClientId')
    expect(requestBody).not.toHaveProperty('xSessionId')

    expect(result).toEqual({
      id: 'cmpl-1',
      object: 'chat.completion',
      created: 1700,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello, world' },
          finish_reason: 'stop',
        },
      ],
      usage: null,
    })
  })

  it('assembles streamed tool call deltas and usage', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      chunk({ id: 'cmpl-2', created: 1800, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } }] }, finish_reason: null }] }),
      chunk({ id: 'cmpl-2', created: 1800, model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }] }, finish_reason: null }] }),
      chunk({ id: 'cmpl-2', created: 1800, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } }),
      'data: [DONE]\n\n',
    ]))

    const result = await callTool('msq_chat_completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Weather in SF?' }],
    })

    expect(result).toEqual({
      id: 'cmpl-2',
      object: 'chat.completion',
      created: 1800,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"SF"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    })
  })

  it('throws when the stream emits an error chunk', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      chunk({ error: 'Failed to process chat request: upstream unavailable' }),
      'data: [DONE]\n\n',
    ]))

    await expect(callTool('msq_chat_completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow('upstream unavailable')
  })
})

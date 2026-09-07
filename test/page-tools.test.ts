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

// Shapes below mirror the live capture against missionsquad-api on 2026-09-06
// (POST/GET/PUT /v1/core/pages, /runs, /publish, /unpublish, layout-schema,
// categories, preview-token, email-preview, x402/networks, /api/public/pages/*).
const PUBLIC_ORIGIN = 'https://missionsquad.ai'
const PAGE_ID = 'b9aec6ed-4de5-49af-bb58-a2585ee0c203'
const AGENT_ID = 'RC8WcDIfHCSoIO9MtId1H'

function buildLayout() {
  return {
    title: 'Topic Explainer',
    layout: 'report' as const,
    fields: [
      {
        name: 'synopsis',
        type: 'richtext' as const,
        display: 'synopsis',
        description: 'A 2-4 sentence plain-language explanation.',
      },
      {
        name: 'difficulty',
        type: 'enum' as const,
        display: 'badge',
        options: ['beginner', 'intermediate', 'advanced'],
        description: 'How hard the topic is.',
      },
      {
        name: 'key_facts',
        type: 'list' as const,
        display: 'stats',
        maxItems: 4,
        description: 'Headline facts.',
        item: {
          fields: [
            { name: 'label', type: 'text' as const, description: 'Short fact name.' },
            { name: 'value', type: 'text' as const, description: 'The fact.' },
          ],
        },
      },
    ],
  }
}

function buildInputForm() {
  return [
    {
      name: 'topic',
      label: 'Topic',
      type: 'text' as const,
      required: true,
      validation: "^[A-Za-z0-9 ,.'\\-()]{2,80}$",
      placeholder: 'e.g. Photosynthesis',
    },
  ]
}

function buildPageRecord(overrides?: Record<string, unknown>) {
  return {
    id: PAGE_ID,
    userId: 'demo',
    pageType: 'user' as const,
    status: 'draft' as const,
    header: {
      title: 'Topic Explainer',
      description: 'Enter any topic and get a concise, structured explainer.',
      ownerDisplay: 'demo',
      sourceDisplay: 'topic-explainer agent',
    },
    source: { type: 'agent' as const, id: AGENT_ID },
    layout: buildLayout(),
    runMode: 'on-demand' as const,
    onDemand: { storeHistory: true, inputForm: buildInputForm() },
    publicListed: false,
    categories: ['utility'],
    scheduleState: { consecutiveFailures: 0 },
    createdAt: 1788755243547,
    updatedAt: 1788755280920,
    ...overrides,
  }
}

function buildLivePageRecord(overrides?: Record<string, unknown>) {
  return buildPageRecord({
    status: 'live',
    slug: 'topic-explainer',
    publishedAt: 1788755390483,
    ...overrides,
  })
}

function buildPageSummary(overrides?: Record<string, unknown>) {
  return {
    id: PAGE_ID,
    title: 'Topic Explainer',
    status: 'live' as const,
    pageType: 'user' as const,
    runMode: 'on-demand' as const,
    updatedAt: 1788755559818,
    slug: 'topic-explainer',
    publishedAt: 1788755559818,
    lastRunAt: 1788755461020,
    lastRunStatus: 'completed' as const,
    ...overrides,
  }
}

function buildRunRecord(
  status: 'queued' | 'running' | 'completed' | 'error',
  overrides?: Record<string, unknown>,
) {
  return {
    runId: '48dee582-2514-4869-9b62-2a517fa29448',
    pageId: PAGE_ID,
    userId: 'demo',
    view: 'ondemand' as const,
    status,
    startedAt: 1788755413695,
    input: { topic: 'TCP three-way handshake' },
    inputSummary: 'TCP three-way handshake',
    source: 'owner' as const,
    ...(status === 'completed'
      ? {
          completedAt: 1788755422471,
          content: { synopsis: 'The **TCP three-way handshake** …', difficulty: 'intermediate', key_facts: [] },
          usage: { promptTokens: 161, completionTokens: 355, totalTokens: 1751 },
        }
      : {}),
    ...(status === 'error'
      ? { completedAt: 1788755422471, error: 'Output failed schema validation after 2 repair attempt(s)' }
      : {}),
    ...overrides,
  }
}

function getRequest(fetchMock: ReturnType<typeof vi.fn>) {
  return getRequestAt(fetchMock, fetchMock.mock.calls.length - 1)
}

function getRequestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const call = fetchMock.mock.calls.at(index)
  if (!call) {
    throw new Error('Expected fetch to be called')
  }

  const [url, init] = call as [string | URL | Request, RequestInit | undefined]
  const requestUrl = typeof url === 'string' ? new URL(url) : url instanceof URL ? url : new URL(url.url)

  return {
    url: requestUrl,
    init: init ?? {},
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

describe('MissionSquad Agent Pages tools', () => {
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
    vi.useRealTimers()
  })

  async function callTool(name: string, args: unknown): Promise<unknown> {
    const tool = server.getTool(name)
    const parsedArgs = tool.parameters.parse(args)
    const result = await tool.execute(parsedArgs, {
      extraArgs: { apiKey: 'msq-test-key' },
    })

    return JSON.parse(result)
  }

  /* ---------- listing / reading ---------- */

  it('lists pages and derives publicUrl for published slugs', async () => {
    const live = buildPageSummary()
    const draft = buildPageSummary({ id: 'draft-1', title: 'Draft', status: 'draft', slug: undefined, publishedAt: undefined })
    fetchMock.mockResolvedValueOnce(jsonResponse({ pages: [live, draft], publicOrigin: PUBLIC_ORIGIN }))

    const result = await callTool('msq_list_pages', {})
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/pages')
    expect(init.method).toBe('GET')
    expect(result).toEqual({
      pages: [
        { ...live, publicUrl: `${PUBLIC_ORIGIN}/p/topic-explainer` },
        { ...draft, slug: undefined, publishedAt: undefined },
      ],
      publicOrigin: PUBLIC_ORIGIN,
    })
  })

  it('gets one page by id with its public URL', async () => {
    const page = buildLivePageRecord()
    fetchMock.mockResolvedValueOnce(jsonResponse({ page, publicOrigin: PUBLIC_ORIGIN }))

    const result = await callTool('msq_get_page', { id: PAGE_ID })
    const { url } = getRequest(fetchMock)

    expect(url.pathname).toBe(`/v1/core/pages/${PAGE_ID}`)
    expect(result).toEqual({ page, publicOrigin: PUBLIC_ORIGIN, publicUrl: `${PUBLIC_ORIGIN}/p/topic-explainer` })
  })

  it('omits publicUrl for drafts without a slug', async () => {
    const page = buildPageRecord()
    fetchMock.mockResolvedValueOnce(jsonResponse({ page, publicOrigin: PUBLIC_ORIGIN }))

    const result = await callTool('msq_get_page', { id: PAGE_ID }) as Record<string, unknown>

    expect(result.publicUrl).toBeUndefined()
  })

  /* ---------- create ---------- */

  it('creates an on-demand page and defaults the onDemand block when omitted', async () => {
    const page = buildPageRecord({ onDemand: { storeHistory: false, inputForm: [] }, publicListed: undefined, categories: undefined })
    fetchMock.mockResolvedValueOnce(jsonResponse({ page, publicOrigin: PUBLIC_ORIGIN }))

    const result = await callTool('msq_create_page', {
      header: {
        title: 'Topic Explainer',
        description: 'Enter any topic and get a concise, structured explainer.',
        ownerDisplay: 'demo',
        sourceDisplay: 'topic-explainer agent',
      },
      source: { type: 'agent', id: AGENT_ID },
      layout: buildLayout(),
      runMode: 'on-demand',
    })
    const { url, init, body } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/pages')
    expect(init.method).toBe('POST')
    expect(body).toEqual({
      pageType: 'user',
      header: {
        title: 'Topic Explainer',
        description: 'Enter any topic and get a concise, structured explainer.',
        ownerDisplay: 'demo',
        sourceDisplay: 'topic-explainer agent',
      },
      source: { type: 'agent', id: AGENT_ID },
      layout: buildLayout(),
      runMode: 'on-demand',
      onDemand: { storeHistory: false, inputForm: [] },
    })
    expect(result).toEqual({ page, publicOrigin: PUBLIC_ORIGIN })
  })

  it('creates a page from JSON-stringified header/layout/onDemand inputs with an input form', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ page: buildPageRecord(), publicOrigin: PUBLIC_ORIGIN }))

    await callTool('msq_create_page', {
      header: JSON.stringify({ title: 'Topic Explainer', description: 'Desc', ownerDisplay: 'demo' }),
      source: JSON.stringify({ type: 'agent', id: AGENT_ID }),
      layout: JSON.stringify(buildLayout()),
      runMode: 'on-demand',
      onDemand: JSON.stringify({ storeHistory: true, inputForm: buildInputForm() }),
      publicListed: false,
      visibility: 'public',
      categories: ['Utility', 'research'],
    })
    const { body } = getRequest(fetchMock)

    expect(body.header).toEqual({ title: 'Topic Explainer', description: 'Desc', ownerDisplay: 'demo' })
    expect(body.layout).toEqual(buildLayout())
    expect(body.onDemand).toEqual({ storeHistory: true, inputForm: buildInputForm() })
    expect(body.publicListed).toBe(false)
    expect(body.visibility).toBe('public')
    expect(body.categories).toEqual(['Utility', 'research'])
  })

  it('creates a scheduled page and defaults schedule.aggregation to the cadence view only', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      page: buildPageRecord({ runMode: 'scheduled', onDemand: undefined }),
      publicOrigin: PUBLIC_ORIGIN,
    }))

    await callTool('msq_create_page', {
      header: { title: 'Weekly Probe', description: 'Desc', ownerDisplay: 'demo' },
      source: { type: 'workflow', id: 'wf-1' },
      layout: buildLayout(),
      runMode: 'scheduled',
      schedule: { cadence: 'weekly', dayOfWeek: 1, hour: 9, minute: 30, timezone: 'America/New_York' },
    })
    const { body } = getRequest(fetchMock)

    expect(body.runMode).toBe('scheduled')
    expect(body.onDemand).toBeUndefined()
    expect(body.schedule).toEqual({
      cadence: 'weekly',
      dayOfWeek: 1,
      hour: 9,
      minute: 30,
      timezone: 'America/New_York',
      aggregation: { enabled: false, views: ['weekly'] },
    })
  })

  it('rejects weekly schedules without dayOfWeek and layouts missing type-specific fields locally', () => {
    const tool = server.getTool('msq_create_page')
    const base = {
      header: { title: 'T', description: 'D', ownerDisplay: 'O' },
      source: { type: 'agent', id: AGENT_ID },
      runMode: 'scheduled',
    }

    const weekly = tool.parameters.safeParse({
      ...base,
      layout: buildLayout(),
      schedule: { cadence: 'weekly', hour: 9, minute: 0, timezone: 'UTC' },
    })
    expect(weekly.success).toBe(false)
    if (!weekly.success) {
      expect(weekly.error.issues.map((issue) => issue.message)).toContain("dayOfWeek is required when cadence is 'weekly'")
    }

    const enumWithoutOptions = tool.parameters.safeParse({
      ...base,
      layout: { title: 'T', layout: 'report', fields: [{ name: 'verdict', type: 'enum' }] },
    })
    expect(enumWithoutOptions.success).toBe(false)
    if (!enumWithoutOptions.success) {
      expect(enumWithoutOptions.error.issues.map((issue) => issue.message)).toContain('enum fields require an options array')
    }

    const listWithoutItem = tool.parameters.safeParse({
      ...base,
      layout: { title: 'T', layout: 'report', fields: [{ name: 'rows', type: 'list' }] },
    })
    expect(listWithoutItem.success).toBe(false)

    const badName = tool.parameters.safeParse({
      ...base,
      layout: { title: 'T', layout: 'report', fields: [{ name: 'Bad Name', type: 'text' }] },
    })
    expect(badName.success).toBe(false)
  })

  it('surfaces API validation details as a user-facing error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: "Invalid page: source agent 'nope' was not found for this account",
      details: ["source agent 'nope' was not found for this account"],
    }, 400))

    await expect(callTool('msq_create_page', {
      header: { title: 'T', description: 'D', ownerDisplay: 'O' },
      source: { type: 'agent', id: 'nope' },
      layout: buildLayout(),
      runMode: 'on-demand',
    })).rejects.toThrow("source agent 'nope' was not found for this account")
  })

  /* ---------- update (read-modify-write) ---------- */

  it('updates a page by merging provided fields over the stored record', async () => {
    const current = buildLivePageRecord()
    const updated = { ...current, header: { ...current.header, title: 'Topic Explainer v2' }, updatedAt: 2 }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))
      .mockResolvedValueOnce(jsonResponse({ page: updated, publicOrigin: PUBLIC_ORIGIN }))

    const result = await callTool('msq_update_page', {
      id: PAGE_ID,
      header: { ...current.header, title: 'Topic Explainer v2' },
    })

    const read = getRequestAt(fetchMock, 0)
    const write = getRequestAt(fetchMock, 1)
    expect(read.url.pathname).toBe(`/v1/core/pages/${PAGE_ID}`)
    expect(read.init.method).toBe('GET')
    expect(write.url.pathname).toBe(`/v1/core/pages/${PAGE_ID}`)
    expect(write.init.method).toBe('PUT')
    expect(write.body).toEqual({
      pageType: 'user',
      header: { ...current.header, title: 'Topic Explainer v2' },
      source: current.source,
      layout: current.layout,
      runMode: 'on-demand',
      onDemand: current.onDemand,
      publicListed: false,
      categories: ['utility'],
    })
    // Read-only record fields never leak into the PUT body.
    expect(write.body.id).toBeUndefined()
    expect(write.body.status).toBeUndefined()
    expect(write.body.slug).toBeUndefined()
    expect(write.body.scheduleState).toBeUndefined()
    expect(result).toEqual({ page: updated, publicOrigin: PUBLIC_ORIGIN, publicUrl: `${PUBLIC_ORIGIN}/p/topic-explainer` })
  })

  it('removes optional blocks on null and drops the other mode\'s blocks when runMode switches', async () => {
    const current = buildLivePageRecord({
      payment: { enabled: false, network: 'eip155:8453', payTo: '0xabc', priceUsd: '0.10' },
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))

    await callTool('msq_update_page', {
      id: PAGE_ID,
      runMode: 'scheduled',
      schedule: { cadence: 'daily', hour: 7, minute: 0, timezone: 'America/Denver' },
      categories: null,
      publicListed: null,
    })
    const { body } = getRequestAt(fetchMock, 1)

    expect(body.runMode).toBe('scheduled')
    expect(body.schedule).toEqual({
      cadence: 'daily',
      hour: 7,
      minute: 0,
      timezone: 'America/Denver',
      aggregation: { enabled: false, views: ['daily'] },
    })
    expect(body.onDemand).toBeUndefined()
    expect(body.payment).toBeUndefined()
    expect(body.categories).toBeUndefined()
    expect(body.publicListed).toBeUndefined()
  })

  it('switching back to on-demand drops the schedule and defaults onDemand', async () => {
    const current = buildLivePageRecord({
      runMode: 'scheduled',
      onDemand: undefined,
      schedule: { cadence: 'daily', hour: 7, minute: 0, timezone: 'UTC', aggregation: { enabled: true, views: ['daily'] } },
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))

    await callTool('msq_update_page', { id: PAGE_ID, runMode: 'on-demand' })
    const { body } = getRequestAt(fetchMock, 1)

    expect(body.schedule).toBeUndefined()
    expect(body.onDemand).toEqual({ storeHistory: false, inputForm: [] })
  })

  it('drops user-only flags when converting to a platform page and forwards slug changes', async () => {
    const current = buildLivePageRecord({ visibility: 'private' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))
      .mockResolvedValueOnce(jsonResponse({ page: current, publicOrigin: PUBLIC_ORIGIN }))

    await callTool('msq_update_page', {
      id: PAGE_ID,
      pageType: 'platform',
      platformOptions: { publicListed: true, subscribe: { enabled: false, frequencies: [] }, emailReady: false },
      slug: 'topic-explainer-pro',
    })
    const { body } = getRequestAt(fetchMock, 1)

    expect(body.pageType).toBe('platform')
    expect(body.publicListed).toBeUndefined()
    expect(body.visibility).toBeUndefined()
    expect(body.platformOptions).toEqual({ publicListed: true, subscribe: { enabled: false, frequencies: [] }, emailReady: false })
    expect(body.slug).toBe('topic-explainer-pro')
  })

  /* ---------- lifecycle ---------- */

  it('publishes, unpublishes and deletes pages through the lifecycle endpoints', async () => {
    const live = buildLivePageRecord()
    fetchMock.mockResolvedValueOnce(jsonResponse({ page: live, publicOrigin: PUBLIC_ORIGIN }))
    const published = await callTool('msq_publish_page', { id: PAGE_ID })
    expect(getRequest(fetchMock).url.pathname).toBe(`/v1/core/pages/${PAGE_ID}/publish`)
    expect(getRequest(fetchMock).init.method).toBe('POST')
    expect(published).toEqual({ page: live, publicOrigin: PUBLIC_ORIGIN, publicUrl: `${PUBLIC_ORIGIN}/p/topic-explainer` })

    const unpublishedRecord = buildLivePageRecord({ status: 'unpublished' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ page: unpublishedRecord, publicOrigin: PUBLIC_ORIGIN }))
    const unpublished = await callTool('msq_unpublish_page', { id: PAGE_ID }) as Record<string, unknown>
    expect(getRequest(fetchMock).url.pathname).toBe(`/v1/core/pages/${PAGE_ID}/unpublish`)
    expect((unpublished.page as Record<string, unknown>).status).toBe('unpublished')
    expect((unpublished.page as Record<string, unknown>).slug).toBe('topic-explainer')

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const deleted = await callTool('msq_delete_page', { id: PAGE_ID })
    expect(getRequest(fetchMock).url.pathname).toBe(`/v1/core/pages/${PAGE_ID}`)
    expect(getRequest(fetchMock).init.method).toBe('DELETE')
    expect(deleted).toEqual({ ok: true })
  })

  it('reports the 409 for deleting a live page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'live pages must be unpublished before deletion' }, 409))

    await expect(callTool('msq_delete_page', { id: PAGE_ID })).rejects.toThrow('live pages must be unpublished before deletion')
  })

  /* ---------- layout schema + categories ---------- */

  it('compiles a layout to its JSON Schema', async () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      title: 'Topic Explainer',
      properties: { synopsis: { type: 'string' } },
      required: ['synopsis'],
      additionalProperties: false,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse({ schema }))

    const result = await callTool('msq_compile_page_layout_schema', { layout: JSON.stringify(buildLayout()) })
    const { url, init, body } = getRequest(fetchMock)

    expect(url.pathname).toBe('/v1/core/pages/layout-schema')
    expect(init.method).toBe('POST')
    expect(body).toEqual({ layout: buildLayout() })
    expect(result).toEqual({ schema })
  })

  it('lists category suggestions', async () => {
    const categories = ['ai', 'crypto', 'finance', 'markets', 'news', 'research', 'utility', 'weather']
    fetchMock.mockResolvedValueOnce(jsonResponse({ categories }))

    const result = await callTool('msq_list_page_categories', {})

    expect(getRequest(fetchMock).url.pathname).toBe('/v1/core/pages/categories')
    expect(result).toEqual({ categories })
  })

  /* ---------- owner runs ---------- */

  it('starts a preview run with validated input and returns the run id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: 'run-1' }, 202))

    const result = await callTool('msq_run_page_preview', {
      id: PAGE_ID,
      input: JSON.stringify({ topic: 'TCP three-way handshake' }),
    })
    const { url, init, body } = getRequest(fetchMock)

    expect(url.pathname).toBe(`/v1/core/pages/${PAGE_ID}/preview-run`)
    expect(init.method).toBe('POST')
    expect(body).toEqual({ input: { topic: 'TCP three-way handshake' } })
    expect(result).toEqual({ pageId: PAGE_ID, runId: 'run-1' })
  })

  it('starts a preview run with an empty body when no input is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: 'run-2' }, 202))

    await callTool('msq_run_page_preview', { id: PAGE_ID })

    expect(getRequest(fetchMock).body).toEqual({})
  })

  it('lists runs without the content document and keeps raw errors', async () => {
    const completed = buildRunRecord('completed')
    const failed = buildRunRecord('error', { runId: 'run-err' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [completed, failed], total: 2 }))

    const result = await callTool('msq_list_page_runs', { id: PAGE_ID, limit: 25 })
    const { url } = getRequest(fetchMock)

    expect(url.pathname).toBe(`/v1/core/pages/${PAGE_ID}/runs`)
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('offset')).toBe('0')
    const { content: _content, ...completedWithoutContent } = completed
    expect(result).toEqual({
      runs: [
        { ...completedWithoutContent, hasContent: true },
        { ...failed, hasContent: false },
      ],
      total: 2,
    })
  })

  it('waits for a run by polling the owner run list until it is terminal', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('queued')], total: 1 }))
      .mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('running')], total: 1 }))
      .mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('completed')], total: 1 }))

    const pending = callTool('msq_get_page_run_status', {
      id: PAGE_ID,
      runId: '48dee582-2514-4869-9b62-2a517fa29448',
    })
    await vi.advanceTimersByTimeAsync(2_600)
    await vi.advanceTimersByTimeAsync(2_600)
    const result = await pending as Record<string, unknown>

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.status).toBe('completed')
    expect(result.hasContent).toBe(true)
    expect(result.content).toBeUndefined()
    expect(result.usage).toEqual({ promptTokens: 161, completionTokens: 355, totalTokens: 1751 })
  })

  it('returns immediately for a run that already failed, including the raw error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('error')], total: 1 }))

    const result = await callTool('msq_get_page_run_status', {
      id: PAGE_ID,
      runId: '48dee582-2514-4869-9b62-2a517fa29448',
    }) as Record<string, unknown>

    expect(result.status).toBe('error')
    expect(result.error).toBe('Output failed schema validation after 2 repair attempt(s)')
  })

  it('gives up waiting after timeoutSeconds while the run keeps running', async () => {
    vi.useFakeTimers()
    // A Response body is single-use — mint a fresh one per poll.
    fetchMock.mockImplementation(async () => jsonResponse({ runs: [buildRunRecord('running')], total: 1 }))

    const pending = callTool('msq_get_page_run_status', {
      id: PAGE_ID,
      runId: '48dee582-2514-4869-9b62-2a517fa29448',
      timeoutSeconds: 3,
    })
    const assertion = expect(pending).rejects.toThrow('is still running after 3s')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('scans later run-list pages to locate an older run', async () => {
    const olderRun = buildRunRecord('completed', { runId: 'old-run' })
    const page1 = Array.from({ length: 100 }, (_, index) => buildRunRecord('completed', { runId: `recent-${index}` }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runs: page1, total: 101 }))
      .mockResolvedValueOnce(jsonResponse({ runs: [olderRun], total: 101 }))

    const result = await callTool('msq_get_page_run_result', { id: PAGE_ID, runId: 'old-run' }) as Record<string, unknown>

    expect(getRequestAt(fetchMock, 0).url.searchParams.get('offset')).toBe('0')
    expect(getRequestAt(fetchMock, 1).url.searchParams.get('offset')).toBe('100')
    expect(result.runId).toBe('old-run')
  })

  it('fails clearly when a run id is not on the page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('completed')], total: 1 }))

    await expect(callTool('msq_get_page_run_result', { id: PAGE_ID, runId: 'missing' }))
      .rejects.toThrow("Page run 'missing' was not found")
  })

  it('returns the content document for a completed run and refuses non-completed runs', async () => {
    const completed = buildRunRecord('completed')
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [completed], total: 1 }))

    const result = await callTool('msq_get_page_run_result', { id: PAGE_ID, runId: completed.runId })
    expect(result).toEqual({
      runId: completed.runId,
      pageId: PAGE_ID,
      view: 'ondemand',
      input: completed.input,
      inputSummary: completed.inputSummary,
      source: 'owner',
      startedAt: completed.startedAt,
      completedAt: completed.completedAt,
      usage: completed.usage,
      content: completed.content,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('running')], total: 1 }))
    await expect(callTool('msq_get_page_run_result', { id: PAGE_ID, runId: completed.runId }))
      .rejects.toThrow('Page run result not ready')

    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [buildRunRecord('error')], total: 1 }))
    await expect(callTool('msq_get_page_run_result', { id: PAGE_ID, runId: completed.runId }))
      .rejects.toThrow('Output failed schema validation')
  })

  it('deletes a run row', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    const result = await callTool('msq_delete_page_run', { id: PAGE_ID, runId: 'run-1' })
    const { url, init } = getRequest(fetchMock)

    expect(url.pathname).toBe(`/v1/core/pages/${PAGE_ID}/runs/run-1`)
    expect(init.method).toBe('DELETE')
    expect(result).toEqual({ ok: true })
  })

  /* ---------- preview token / email / networks ---------- */

  it('mints a preview token and composes the preview URL', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/preview-token')) {
        return jsonResponse({ token: 'tok.en', path: `/p/preview/${PAGE_ID}` })
      }
      return jsonResponse({ page: buildPageRecord(), publicOrigin: PUBLIC_ORIGIN })
    })

    const result = await callTool('msq_get_page_preview_token', { id: PAGE_ID })

    expect(result).toEqual({
      token: 'tok.en',
      path: `/p/preview/${PAGE_ID}`,
      url: `${PUBLIC_ORIGIN}/p/preview/${PAGE_ID}?token=tok.en`,
    })
  })

  it('returns the email preview html', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ html: '<!DOCTYPE html><html></html>' }))

    const result = await callTool('msq_get_page_email_preview', { id: PAGE_ID })

    expect(getRequest(fetchMock).url.pathname).toBe(`/v1/core/pages/${PAGE_ID}/email-preview`)
    expect(result).toEqual({ html: '<!DOCTYPE html><html></html>' })
  })

  it('lists x402 networks', async () => {
    const networks = [
      { network: 'eip155:8453', displayName: 'Base', available: true, testnet: false },
      { network: 'eip155:84532', displayName: 'Base Sepolia', available: false, testnet: true },
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse({ networks }))

    const result = await callTool('msq_list_x402_networks', {})

    expect(getRequest(fetchMock).url.pathname).toBe('/v1/core/x402/networks')
    expect(result).toEqual({ networks })
  })

  /* ---------- public surface (origin-rooted) ---------- */

  it('reads the public descriptor from the API origin, outside the /v1 base path', async () => {
    const descriptor = { slug: 'topic-explainer', pageType: 'user', unlisted: true, sourceType: 'agent' }
    fetchMock.mockResolvedValueOnce(jsonResponse({ descriptor }))

    const result = await callTool('msq_get_public_page', { slug: 'topic-explainer' })
    const { url, init } = getRequest(fetchMock)

    expect(url.origin).toBe('https://agents.missionsquad.ai')
    expect(url.pathname).toBe('/api/public/pages/topic-explainer')
    expect(init.method).toBe('GET')
    expect(result).toEqual({ descriptor })
  })

  it('passes view/period through to the public content route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ view: 'weekly', periodKey: '2026-W36', runId: 'r', producedAt: 1, content: {}, recentPeriods: [] }))

    await callTool('msq_get_public_page_content', { slug: 'weekly-brief', view: 'weekly', period: '2026-W36' })
    const { url } = getRequest(fetchMock)

    expect(url.pathname).toBe('/api/public/pages/weekly-brief/content')
    expect(url.searchParams.get('view')).toBe('weekly')
    expect(url.searchParams.get('period')).toBe('2026-W36')
  })

  it('lists public run history with search and paging params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [{ runId: 'r1', completedAt: 1, inputSummary: 'Photosynthesis', badge: 'beginner' }], total: 1 }))

    const result = await callTool('msq_list_public_page_runs', { slug: 'topic-explainer', q: 'photo', limit: 5 })
    const { url } = getRequest(fetchMock)

    expect(url.pathname).toBe('/api/public/pages/topic-explainer/runs')
    expect(url.searchParams.get('q')).toBe('photo')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('offset')).toBe('0')
    expect(result).toEqual({ runs: [{ runId: 'r1', completedAt: 1, inputSummary: 'Photosynthesis', badge: 'beginner' }], total: 1 })
  })

  it('starts a public run as an anonymous visitor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: 'pub-run-1' }, 202))

    const result = await callTool('msq_run_public_page', { slug: 'topic-explainer', input: { topic: 'Photosynthesis' } })
    const { url, init, body } = getRequest(fetchMock)

    expect(url.pathname).toBe('/api/public/pages/topic-explainer/runs')
    expect(init.method).toBe('POST')
    expect(body).toEqual({ input: { topic: 'Photosynthesis' } })
    expect(result).toEqual({ slug: 'topic-explainer', runId: 'pub-run-1' })
  })

  it('surfaces the public 402/429 errors verbatim', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Daily free run limit reached — come back tomorrow.', retryAfterSeconds: 3600 }, 429))

    await expect(callTool('msq_run_public_page', { slug: 'topic-explainer' }))
      .rejects.toThrow('Daily free run limit reached')
  })

  it('waits on the public run stream and returns the completed detail', async () => {
    const completedDetail = {
      runId: 'pub-run-1',
      status: 'completed',
      content: { synopsis: 'Photosynthesis …' },
      producedAt: 1788755461020,
      inputSummary: 'Photosynthesis',
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runId: 'pub-run-1', status: 'running' }))
      .mockResolvedValueOnce(sseResponse([
        'data: {"type":"run","runId":"pub-run-1","status":"running"}\n\n',
        ':pages-heartbeat 1\n\n',
        'data: {"type":"run","runId":"pub-run-1","status":"completed","content":{"synopsis":"Photosynthesis …"},"producedAt":1788755461020,"inputSummary":"Photosynthesis"}\n\n',
        'data: [DONE]\n\n',
      ]))
      .mockResolvedValueOnce(jsonResponse(completedDetail))

    const result = await callTool('msq_get_public_page_run', { slug: 'topic-explainer', runId: 'pub-run-1' })

    expect(getRequestAt(fetchMock, 0).url.pathname).toBe('/api/public/pages/topic-explainer/runs/pub-run-1')
    expect(getRequestAt(fetchMock, 1).url.pathname).toBe('/api/public/pages/topic-explainer/runs/pub-run-1/stream')
    expect(getRequestAt(fetchMock, 1).url.origin).toBe('https://agents.missionsquad.ai')
    expect(result).toEqual(completedDetail)
  })

  it('returns a terminal public run without opening the stream', async () => {
    const errorDetail = { runId: 'pub-run-2', status: 'error', error: 'The run failed to produce a valid edition. Please try again.' }
    fetchMock.mockResolvedValueOnce(jsonResponse(errorDetail))

    const result = await callTool('msq_get_public_page_run', { slug: 'topic-explainer', runId: 'pub-run-2' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(errorDetail)
  })
})

import type { FastMCP } from '@missionsquad/fastmcp'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMissionSquadTools } from '../src/tools.js'
import { skillTools } from '../src/skill-tools.js'

interface RegisteredTool {
  name: string
  parameters: z.ZodTypeAny
  execute: (args: unknown, context: { extraArgs?: Record<string, unknown> }) => Promise<string>
}
class FakeServer {
  tools = new Map<string, RegisteredTool>()
  addTool(tool: RegisteredTool) { this.tools.set(tool.name, tool) }
}
const context = { extraArgs: { apiKey: 'isolated-mcp-skill-test-key', baseUrl: 'https://api.missionsquad.invalid/v1' } }
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
const skill = { name: 'weekly-report', description: 'Write the weekly report. Use for status updates.', instructions: '# Steps\n1. Gather.' }

describe('skill and directive MCP tools', () => {
  let server: FakeServer
  let fetchMock: ReturnType<typeof vi.fn>
  // Arguments reach execute unparsed, as FastMCP delivers them for tools with deferred validation.
  async function call(name: string, args: unknown = {}) {
    return JSON.parse(await server.tools.get(name)!.execute(args, context))
  }
  function lastRequest() {
    const [url, init] = fetchMock.mock.calls[0]
    return { url: new URL(url), init }
  }
  beforeEach(() => {
    server = new FakeServer()
    registerMissionSquadTools(server as unknown as FastMCP<undefined>)
    fetchMock = vi.fn().mockImplementation(async () => response({ success: true, data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('advertises an object schema and a substantial description for every tool, without credentials', () => {
    expect(skillTools).toHaveLength(9)
    for (const tool of skillTools) {
      const advertised = zodToJsonSchema(tool.parameters)
      expect(advertised).toMatchObject({ type: 'object' })
      expect(JSON.stringify(advertised)).not.toContain('apiKey')
      expect(tool.description.length).toBeGreaterThan(100)
      expect(server.tools.has(tool.name)).toBe(true)
    }
  })

  it.each([
    ['msq_list_skills', {}, 'GET', '/v1/core/skills', undefined],
    ['msq_get_skill', { id: 'abc123' }, 'GET', '/v1/core/skills/abc123', undefined],
    ['msq_create_skill', skill, 'POST', '/v1/core/skills', skill],
    ['msq_create_skill', { ...skill, enabled: false }, 'POST', '/v1/core/skills', { ...skill, enabled: false }],
    ['msq_update_skill', { id: 'abc123', ...skill }, 'PUT', '/v1/core/skills/abc123', skill],
    ['msq_delete_skill', { id: 'abc123' }, 'DELETE', '/v1/core/skills/abc123', undefined],
    ['msq_import_skill', { content: '---\nname: a\ndescription: d\n---\nBody', overwrite: true }, 'POST', '/v1/core/skills/import',
      { content: '---\nname: a\ndescription: d\n---\nBody', overwrite: true }],
    ['msq_set_agent_skills', { agentName: 'Research Lead', skills: ['weekly-report', 'abc123'] }, 'PUT', '/v1/core/update/agent',
      { name: 'Research Lead', skills: ['weekly-report', 'abc123'] }],
    ['msq_set_agent_skills', { agentName: 'Research Lead', skills: [] }, 'PUT', '/v1/core/update/agent', { name: 'Research Lead', skills: [] }],
    ['msq_get_directives', {}, 'GET', '/v1/core/directives', undefined],
    ['msq_set_directives', { directives: 'Reply in British English.' }, 'PUT', '/v1/core/directives', { directives: 'Reply in British English.' }],
    ['msq_set_directives', { directives: '' }, 'PUT', '/v1/core/directives', { directives: '' }],
  ])('routes %s %j through the authenticated API', async (name, args, method, path, body) => {
    await call(String(name), args)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = lastRequest()
    expect(url.pathname).toBe(path)
    expect(url.search).toBe('')
    expect(init.method).toBe(method)
    expect(init.headers['x-api-key']).toBe(context.extraArgs.apiKey)
    if (body === undefined) expect(init.body).toBeUndefined()
    else expect(JSON.parse(init.body)).toEqual(body)
  })

  it('escapes a skill id so it cannot change the request path', async () => {
    await call('msq_get_skill', { id: '../directives?x=1' })
    const { url } = lastRequest()
    expect(url.pathname).toBe('/v1/core/skills/..%2Fdirectives%3Fx%3D1')
    expect(url.search).toBe('')
  })

  it('returns the API payload unchanged as compact JSON', async () => {
    const payload = { success: true, data: { owned: [{ id: 'abc', name: 'a', agents: ['x'] }], shared: [] } }
    fetchMock.mockResolvedValueOnce(response(payload))
    expect(await server.tools.get('msq_list_skills')!.execute({}, context)).toBe(JSON.stringify(payload))
  })

  it.each([
    ['msq_get_skill', {}, 'id'],
    ['msq_create_skill', { ...skill, name: 'Weekly Report' }, 'name'],
    ['msq_create_skill', { ...skill, name: 'weekly--report' }, 'name'],
    ['msq_create_skill', { ...skill, name: 'a'.repeat(65) }, 'name'],
    ['msq_create_skill', { ...skill, description: '' }, 'description'],
    ['msq_create_skill', { ...skill, description: 'a'.repeat(1025) }, 'description'],
    ['msq_create_skill', { name: skill.name, description: skill.description }, 'instructions'],
    ['msq_create_skill', { ...skill, enabled: 'yes' }, 'enabled'],
    ['msq_update_skill', skill, 'id'],
    ['msq_import_skill', {}, 'content'],
    ['msq_import_skill', { content: 'x', overwrite: 'true' }, 'overwrite'],
    ['msq_set_agent_skills', { skills: [] }, 'agentName'],
    ['msq_set_agent_skills', { agentName: 'A' }, 'skills'],
    ['msq_set_agent_skills', { agentName: 'A', skills: [''] }, 'skills[0]'],
    ['msq_set_agent_skills', { agentName: 'A', skills: Array.from({ length: 51 }, (_value, index) => `s${index}`) }, 'skills'],
    ['msq_set_directives', {}, 'directives'],
    ['msq_set_directives', { directives: 'a'.repeat(8001) }, 'directives'],
  ])('rejects %s %j before any request is sent', async (name, args, field) => {
    const failure = await server.tools.get(String(name))!.execute(args, context).then(() => null, (error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    const body = JSON.parse(failure!.message.slice(failure!.message.indexOf('{')))
    expect(body.error).toBe('INVALID_TOOL_ARGUMENTS')
    expect(body.issues.map((issue: { field: string }) => issue.field)).toContain(field)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces an API refusal with its message', async () => {
    fetchMock.mockResolvedValueOnce(response({ success: false, message: 'A skill named "weekly-report" already exists' }, 409))
    await expect(server.tools.get('msq_create_skill')!.execute(skill, context)).rejects.toThrow('already exists')
  })
})

import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, expect, it } from 'vitest'

let client: Client
let server: Server
const requests: Array<{ url?: string; key?: string; body: unknown }> = []
let baseUrl: string
let compiledDir: string | undefined
const definition = {
  name: 'Customer review sentiment', systemPrompt: 'Reply positive, negative or neutral.',
  cases: [{ id: 'late', name: 'Late delivery', input: 'My parcel was late.', expected: 'negative' }],
  models: [{ modelId: 'configured-model' }],
  checks: [{ id: 'sentiment', type: 'exact', required: true, trim: true }],
}

beforeAll(async () => {
  // Compile current source independently of dist or the caller's build order.
  // A directory inside the repo retains its package type and dependency resolution.
  compiledDir = await mkdtemp(resolve('.eval-stdio-'))
  await promisify(execFile)(process.execPath, [resolve('node_modules/typescript/bin/tsc'),
    '--outDir', compiledDir, '--declaration', 'false', '--sourceMap', 'false'])
  // HTTP capture is deliberate: this verifies the MCP error boundary, not API execution.
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ url: request.url, key: request.headers['x-api-key']?.toString(), body: JSON.parse(Buffer.concat(chunks).toString()) })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ success: true, data: { id: 'saved-suite', revision: 1 } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  baseUrl = `http://127.0.0.1:${address.port}/v1`
  client = new Client({ name: 'eval-validation-regression', version: '1.0.0' }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: process.execPath, args: [resolve(compiledDir, 'index.js')], stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', MSQ_API_KEY: 'wrong-default', MSQ_BASE_URL: 'http://127.0.0.1:1/v1' },
  })
  await client.connect(transport)
  transport.stderr?.on('data', () => undefined)
}, 15000)

afterAll(async () => {
  await client?.close()
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (compiledDir) await rm(compiledDir, { recursive: true, force: true })
})

it('returns corrective tool errors over stdio, then accepts corrected input with hidden auth', async () => {
  const { tools } = await client.listTools()
  const tool = tools.find(tool => tool.name === 'msq_create_eval')!
  expect(tool.inputSchema.required).toContain('definition')
  expect(JSON.stringify(tool.inputSchema)).not.toContain('apiKey')
  const secret = 'private-test-key-not-for-response'
  const bad = await client.callTool({ name: 'msq_create_eval', arguments: {
    apiKey: secret, baseUrl, definition: { ...definition, concurrency: 8, models: [{}] },
  } })
  expect(bad.isError).toBe(true)
  const text = JSON.stringify(bad.content)
  expect(text).toContain('definition.concurrency')
  expect(text).toContain('definition.models[0].modelId')
  expect(text).toContain('msq_get_eval_options')
  expect(text).not.toContain(secret)
  expect(requests).toHaveLength(0)

  const omitted = await client.callTool({ name: 'msq_create_eval' })
  expect(omitted.isError).toBe(true)
  expect(JSON.stringify(omitted.content)).toContain('definition')
  expect(requests).toHaveLength(0)

  const good = await client.callTool({ name: 'msq_create_eval', arguments: { apiKey: secret, baseUrl, definition } })
  expect(good.isError).not.toBe(true)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ url: '/v1/core/evals', key: secret, body: { definition: { repetitions: 3, concurrency: 4, sharedSettings: {} } } })
  expect(requests[0].body).not.toHaveProperty('apiKey')
})

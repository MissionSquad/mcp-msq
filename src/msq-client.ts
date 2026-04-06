import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { appConfig, resolveRequestConfig, type ResolvedRequestConfig } from './config.js'
import { MsqApiError, MsqTransportError } from './errors.js'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface JsonRequestOptions {
  method: HttpMethod
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string | undefined>
}

interface EventStreamRequestOptions {
  path: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string | undefined>
}

interface FileUploadOptions {
  filePath: string
  purpose: string
  relativePath?: string
  collectionName?: string
  filename?: string
}

interface FileContentRequestOptions {
  fileId: string
  maxBytes?: number
}

interface FileContentResult {
  contentType: string | null
  contentLength: number | null
  bytesRead: number
  truncated: boolean
  base64: string
}

interface LimitedBufferResult {
  buffer: Buffer
  bytesRead: number
  truncated: boolean
}

interface ServerSentEvent {
  event?: string
  id?: string
  data: string
}

function parseContentLength(rawHeader: string | null): number | null {
  if (!rawHeader) {
    return null
  }

  const parsed = Number(rawHeader)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return Math.floor(parsed)
}

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<LimitedBufferResult> {
  if (!response.body) {
    return {
      buffer: Buffer.alloc(0),
      bytesRead: 0,
      truncated: false,
    }
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []

  let bytesRead = 0
  let bytesKept = 0
  let truncated = false

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    if (!value) {
      continue
    }

    bytesRead += value.byteLength

    if (bytesKept < maxBytes) {
      const remaining = maxBytes - bytesKept
      const nextSlice = value.byteLength > remaining ? value.subarray(0, remaining) : value

      if (nextSlice.byteLength > 0) {
        chunks.push(Buffer.from(nextSlice))
        bytesKept += nextSlice.byteLength
      }
    }

    if (bytesRead > maxBytes) {
      truncated = true
      await reader.cancel()
      break
    }
  }

  return {
    buffer: Buffer.concat(chunks),
    bytesRead,
    truncated,
  }
}

function parseServerSentEvent(rawEvent: string): ServerSentEvent | null {
  const lines = rawEvent.split(/\r?\n/)
  const dataLines: string[] = []
  let event: string | undefined
  let id: string | undefined

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(':')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
    let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : ''
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    if (field === 'data') {
      dataLines.push(value)
    } else if (field === 'event') {
      event = value
    } else if (field === 'id') {
      id = value
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    event,
    id,
    data: dataLines.join('\n'),
  }
}

export class MissionSquadClient {
  constructor(private readonly requestConfig: ResolvedRequestConfig) {}

  public async requestJson(options: JsonRequestOptions): Promise<unknown> {
    const url = this.buildUrl(options.path, options.query)

    const headers: Record<string, string> = {
      'x-api-key': this.requestConfig.apiKey,
      ...this.compactHeaders(options.headers),
    }

    let body: string | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    const response = await this.fetchWithTimeout(url, {
      method: options.method,
      headers,
      body,
    })

    return this.parseStructuredResponse(response, url)
  }

  public async consumeServerSentEvents(
    options: EventStreamRequestOptions,
    onEvent: (event: ServerSentEvent) => Promise<void> | void,
  ): Promise<void> {
    const url = this.buildUrl(options.path, options.query)

    const response = await this.fetchWithoutTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'x-api-key': this.requestConfig.apiKey,
        ...this.compactHeaders(options.headers),
      },
    })

    if (!response.ok) {
      const errorPayload = await this.parseErrorPayload(response)
      throw new MsqApiError(
        `MissionSquad API request failed with ${response.status} ${response.statusText}.`,
        response.status,
        response.statusText,
        url,
        errorPayload,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      throw new MsqTransportError(
        `MissionSquad API event stream returned unexpected content type: ${contentType || 'unknown'}.`,
      )
    }

    if (!response.body) {
      throw new MsqTransportError('MissionSquad API event stream did not include a response body.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

      while (true) {
        const separatorMatch = /\r?\n\r?\n/.exec(buffer)
        if (!separatorMatch || separatorMatch.index === undefined) {
          break
        }

        const rawEvent = buffer.slice(0, separatorMatch.index)
        buffer = buffer.slice(separatorMatch.index + separatorMatch[0].length)

        const parsed = parseServerSentEvent(rawEvent)
        if (parsed) {
          await onEvent(parsed)
        }
      }

      if (done) {
        const parsed = parseServerSentEvent(buffer)
        if (parsed) {
          await onEvent(parsed)
        }
        return
      }
    }
  }

  public async uploadFile(options: FileUploadOptions): Promise<unknown> {
    const payload = await readFile(options.filePath)
    const filename = options.filename?.trim() || basename(options.filePath)

    const form = new FormData()
    form.append('file', new Blob([payload]), filename)
    form.append('purpose', options.purpose)

    if (options.relativePath) {
      form.append('relativePath', options.relativePath)
    }

    if (options.collectionName) {
      form.append('collectionName', options.collectionName)
    }

    const url = this.buildUrl('files')

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.requestConfig.apiKey,
      },
      body: form,
    })

    return this.parseStructuredResponse(response, url)
  }

  public async getFileContent(
    options: FileContentRequestOptions,
  ): Promise<FileContentResult> {
    const maxBytes = options.maxBytes ?? this.requestConfig.defaultFileContentMaxBytes
    const url = this.buildUrl(`files/${encodeURIComponent(options.fileId)}/content`)

    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.requestConfig.apiKey,
      },
    })

    if (!response.ok) {
      const errorPayload = await this.parseErrorPayload(response)
      throw new MsqApiError(
        `MissionSquad API request failed with ${response.status} ${response.statusText}.`,
        response.status,
        response.statusText,
        url,
        errorPayload,
      )
    }

    const limited = await readResponseBodyWithLimit(response, maxBytes)

    return {
      contentType: response.headers.get('content-type'),
      contentLength: parseContentLength(response.headers.get('content-length')),
      bytesRead: limited.bytesRead,
      truncated: limited.truncated,
      base64: limited.buffer.toString('base64'),
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path
    const baseUrlWithSlash = this.requestConfig.baseUrl.endsWith('/')
      ? this.requestConfig.baseUrl
      : `${this.requestConfig.baseUrl}/`

    const url = new URL(normalizedPath, baseUrlWithSlash)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    return url.toString()
  }

  private compactHeaders(
    headers: Record<string, string | undefined> | undefined,
  ): Record<string, string> {
    if (!headers) {
      return {}
    }

    const output: Record<string, string> = {}

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        output[key] = value
      }
    }

    return output
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, this.requestConfig.httpTimeoutMs)

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MsqTransportError(
          `MissionSquad API request timed out after ${this.requestConfig.httpTimeoutMs}ms.`,
          error,
        )
      }

      throw new MsqTransportError('MissionSquad API request failed before receiving a response.', error)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async fetchWithoutTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init)
    } catch (error) {
      throw new MsqTransportError('MissionSquad API request failed before receiving a response.', error)
    }
  }

  private async parseStructuredResponse(response: Response, url: string): Promise<unknown> {
    const payload = await this.parseResponseBody(response)

    if (!response.ok) {
      throw new MsqApiError(
        `MissionSquad API request failed with ${response.status} ${response.statusText}.`,
        response.status,
        response.statusText,
        url,
        payload,
      )
    }

    return payload
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      try {
        return await response.json()
      } catch {
        return { parseError: 'Invalid JSON response body.' }
      }
    }

    const text = await response.text()
    if (text.length === 0) {
      return null
    }

    return text
  }

  private async parseErrorPayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      try {
        return await response.json()
      } catch {
        return { parseError: 'Invalid JSON error response body.' }
      }
    }

    try {
      const text = await response.text()
      return text.length > 0 ? text : null
    } catch {
      return null
    }
  }
}

export function createMissionSquadClient(
  extraArgs: Record<string, unknown> | undefined,
): MissionSquadClient {
  const requestConfig = resolveRequestConfig(extraArgs, appConfig)
  return new MissionSquadClient(requestConfig)
}

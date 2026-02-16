import { UserError } from '@missionsquad/fastmcp'
import dotenv from 'dotenv'
import { z } from 'zod'
import { MsqConfigError } from './errors.js'

dotenv.config()

const DEFAULT_BASE_URL = 'https://agents.missionsquad.ai/v1'

const EnvSchema = z.object({
  MSQ_API_KEY: z.string().optional(),
  MSQ_BASE_URL: z.string().optional(),
  MSQ_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  MSQ_DEFAULT_FILE_CONTENT_MAX_BYTES: z.coerce.number().int().positive().optional(),
})

const env = EnvSchema.parse(process.env)

export interface AppConfig {
  defaultApiKey: string | undefined
  defaultBaseUrl: string
  httpTimeoutMs: number
  defaultFileContentMaxBytes: number
}

export interface ResolvedRequestConfig {
  apiKey: string
  baseUrl: string
  httpTimeoutMs: number
  defaultFileContentMaxBytes: number
}

function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    throw new MsqConfigError('MissionSquad base URL must be a non-empty string.')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new MsqConfigError(`MissionSquad base URL is invalid: ${trimmed}`)
  }

  parsed.search = ''
  parsed.hash = ''

  if (parsed.pathname !== '/') {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  }

  return parsed.toString().replace(/\/$/, '')
}

function readHiddenString(
  extraArgs: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = extraArgs?.[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new UserError(`Hidden argument "${key}" must be a string when provided.`)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new UserError(`Hidden argument "${key}" must be a non-empty string when provided.`)
  }

  return trimmed
}

export const appConfig: AppConfig = {
  defaultApiKey: env.MSQ_API_KEY?.trim() || undefined,
  defaultBaseUrl: normalizeBaseUrl(env.MSQ_BASE_URL ?? DEFAULT_BASE_URL),
  httpTimeoutMs: env.MSQ_HTTP_TIMEOUT_MS ?? 30_000,
  defaultFileContentMaxBytes: env.MSQ_DEFAULT_FILE_CONTENT_MAX_BYTES ?? 1_048_576,
}

/**
 * Resolve authentication and base URL for a request.
 * Hidden extra args take precedence over environment defaults.
 */
export function resolveRequestConfig(
  extraArgs: Record<string, unknown> | undefined,
  defaults: AppConfig = appConfig,
): ResolvedRequestConfig {
  const apiKey = readHiddenString(extraArgs, 'apiKey') ?? defaults.defaultApiKey
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new UserError(
      'MissionSquad API key is required. Provide hidden argument "apiKey" or set MSQ_API_KEY.',
    )
  }

  const hiddenBaseUrl = readHiddenString(extraArgs, 'baseUrl')
  const baseUrl = hiddenBaseUrl ? normalizeBaseUrl(hiddenBaseUrl) : defaults.defaultBaseUrl

  return {
    apiKey: apiKey.trim(),
    baseUrl,
    httpTimeoutMs: defaults.httpTimeoutMs,
    defaultFileContentMaxBytes: defaults.defaultFileContentMaxBytes,
  }
}

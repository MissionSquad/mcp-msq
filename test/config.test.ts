import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FILE_CONTENT_MAX_BYTES,
  DEFAULT_HTTP_TIMEOUT_MS,
  resolveRequestConfig,
  type AppConfig,
} from '../src/config.js'

const TEST_DEFAULTS: AppConfig = {
  defaultApiKey: 'msq-default-key',
  defaultBaseUrl: 'https://agents.missionsquad.ai/v1',
  httpTimeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  defaultFileContentMaxBytes: DEFAULT_FILE_CONTENT_MAX_BYTES,
}

describe('resolveRequestConfig', () => {
  it('prefers hidden apiKey over environment fallback', () => {
    const resolved = resolveRequestConfig(
      {
        apiKey: 'msq-hidden-key',
      },
      TEST_DEFAULTS,
    )

    expect(resolved.apiKey).toBe('msq-hidden-key')
  })

  it('uses default base URL when hidden baseUrl is not provided', () => {
    const resolved = resolveRequestConfig(undefined, TEST_DEFAULTS)
    expect(resolved.baseUrl).toBe(TEST_DEFAULTS.defaultBaseUrl)
  })

  it('normalizes hidden baseUrl', () => {
    const resolved = resolveRequestConfig(
      {
        baseUrl: 'https://agents.missionsquad.ai/v1/',
      },
      TEST_DEFAULTS,
    )

    expect(resolved.baseUrl).toBe('https://agents.missionsquad.ai/v1')
  })

  it('warns when hidden baseUrl path does not end with /v1', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const resolved = resolveRequestConfig(
      {
        baseUrl: 'https://agents.missionsquad.ai/api',
      },
      TEST_DEFAULTS,
    )

    expect(resolved.baseUrl).toBe('https://agents.missionsquad.ai/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })

  it('does not warn when hidden baseUrl path ends with /v1', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const resolved = resolveRequestConfig(
      {
        baseUrl: 'https://agents.missionsquad.ai/nested/v1',
      },
      TEST_DEFAULTS,
    )

    expect(resolved.baseUrl).toBe('https://agents.missionsquad.ai/nested/v1')
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('throws when no apiKey is available', () => {
    expect(() =>
      resolveRequestConfig(undefined, {
        ...TEST_DEFAULTS,
        defaultApiKey: undefined,
      }),
    ).toThrow()
  })
})

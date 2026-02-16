import { describe, expect, it } from 'vitest'
import { resolveRequestConfig, type AppConfig } from '../src/config.js'

const TEST_DEFAULTS: AppConfig = {
  defaultApiKey: 'msq-default-key',
  defaultBaseUrl: 'https://agents.missionsquad.ai/v1',
  httpTimeoutMs: 30_000,
  defaultFileContentMaxBytes: 1_048_576,
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

  it('throws when no apiKey is available', () => {
    expect(() =>
      resolveRequestConfig(undefined, {
        ...TEST_DEFAULTS,
        defaultApiKey: undefined,
      }),
    ).toThrow()
  })
})

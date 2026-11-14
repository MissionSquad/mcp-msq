/**
 * MCP tools commonly return a string payload. This keeps output deterministic.
 */
export function stringifyResult(value: unknown): string {
  const result = JSON.stringify(
    value,
    (_key, currentValue) => {
      if (typeof currentValue === 'bigint') {
        return currentValue.toString()
      }
      return currentValue
    },
    2,
  )

  return result ?? 'null'
}

/**
 * Compact output for tools whose results an agent reads often. Text such as CSV is returned
 * as it is, not wrapped in a JSON string.
 */
export function compactResult(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, (_key, currentValue) => typeof currentValue === 'bigint' ? currentValue.toString() : currentValue) ?? 'null'
}

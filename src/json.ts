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

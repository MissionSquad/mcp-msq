import { UserError } from '@missionsquad/fastmcp'

export class MsqConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MsqConfigError'
  }
}

export class MsqTransportError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'MsqTransportError'
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

export class MsqApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    public readonly responseBody: unknown,
  ) {
    super(message)
    this.name = 'MsqApiError'
  }
}

function messageFromResponseBody(responseBody: unknown): string {
  if (typeof responseBody === 'string') {
    const trimmed = responseBody.trim()
    if (trimmed.length > 0) return trimmed
    return 'No response body.'
  }

  if (responseBody === null || typeof responseBody !== 'object') {
    return 'No response body.'
  }

  const record = responseBody as Record<string, unknown>

  const error = record.error
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  if (error !== null && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>
    const nestedMessage = errorRecord.message
    if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
      return nestedMessage
    }
  }

  const message = record.message
  if (typeof message === 'string' && message.trim().length > 0) {
    return message
  }

  return 'No response body.'
}

export function toUserError(error: unknown, prefix: string): UserError {
  if (error instanceof UserError) {
    return error
  }

  if (error instanceof MsqApiError) {
    const bodyMessage = messageFromResponseBody(error.responseBody)
    return new UserError(
      `${prefix}: MissionSquad API returned ${error.status} ${error.statusText}. ${bodyMessage}`,
    )
  }

  if (error instanceof MsqConfigError || error instanceof MsqTransportError) {
    return new UserError(`${prefix}: ${error.message}`)
  }

  if (error instanceof Error) {
    return new UserError(`${prefix}: ${error.message}`)
  }

  return new UserError(`${prefix}: ${String(error)}`)
}

#!/usr/bin/env node

import { FastMCP } from '@missionsquad/fastmcp'
import { routeConsoleStdoutToStderr } from './stdio-safe-console.js'
import { registerMissionSquadTools } from './tools.js'

routeConsoleStdoutToStderr()

const server = new FastMCP<undefined>({
  name: 'mcp-msq',
  version: '0.1.0',
})

registerMissionSquadTools(server)

async function main(): Promise<void> {
  await server.start({ transportType: 'stdio' })
}

async function shutdown(exitCode: number): Promise<void> {
  try {
    await server.stop()
  } finally {
    process.exit(exitCode)
  }
}

process.on('SIGINT', () => {
  void shutdown(0)
})

process.on('SIGTERM', () => {
  void shutdown(0)
})

process.on('uncaughtException', () => {
  void shutdown(1)
})

process.on('unhandledRejection', () => {
  void shutdown(1)
})

void main().catch(() => {
  void shutdown(1)
})

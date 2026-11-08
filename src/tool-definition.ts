import { z } from 'zod'
import type { MissionSquadClient } from './msq-client.js'

type ToolParams = z.ZodTypeAny

export interface MsqToolDefinition<TParams extends ToolParams> {
  name: string
  description: string
  parameters: TParams
  run: (client: MissionSquadClient, args: z.infer<TParams>) => Promise<unknown>
}

export function defineTool<TParams extends ToolParams>(
  definition: MsqToolDefinition<TParams>,
): MsqToolDefinition<TParams> {
  return definition
}


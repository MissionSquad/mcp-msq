import type { FastMCP } from '@missionsquad/fastmcp'
import { z } from 'zod'
import { MsqApiError, toUserError } from './errors.js'
import { stringifyResult } from './json.js'
import { logger } from './logger.js'
import { createMissionSquadClient, type MissionSquadClient } from './msq-client.js'
import {
  AddAgentSchema,
  AddModelSchema,
  AddProviderSchema,
  AddVectorStoreFileSchema,
  AgentWorkflowSchema,
  CancelVectorStoreSchema,
  ChatCompletionsSchema,
  CoreCollectionDiagnosticsSchema,
  CoreCollectionRecoverSchema,
  CoreCollectionSearchSchema,
  CreateScheduledRunSchema,
  CreateVectorStoreSchema,
  DeleteAgentSchema,
  DeleteModelSchema,
  DeleteProviderSchema,
  DiscoverProviderModelsSchema,
  EmbeddingsSchema,
  EmptySchema,
  FileContentSchema,
  FileIdSchema,
  GeneratePromptSchema,
  ScheduledRunIdSchema,
  ScrapeUrlSchema,
  UpdateAgentSchema,
  UpdateScheduledRunSchema,
  UploadFileSchema,
  VectorStoreFileSchema,
  VectorStoreIdSchema,
} from './schemas.js'

type ToolParams = z.ZodTypeAny

interface MsqToolDefinition<TParams extends ToolParams> {
  name: string
  description: string
  parameters: TParams
  run: (client: MissionSquadClient, args: z.infer<TParams>) => Promise<unknown>
}

function defineTool<TParams extends ToolParams>(
  definition: MsqToolDefinition<TParams>,
): MsqToolDefinition<TParams> {
  return definition
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

const msqTools = [
  defineTool({
    name: 'msq_list_models',
    description: 'List all models and agents in your MissionSquad namespace.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'models',
      }),
  }),
  defineTool({
    name: 'msq_get_model_map',
    description: 'Get the full model map keyed by model/agent name.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'modelmap',
      }),
  }),
  defineTool({
    name: 'msq_chat_completions',
    description: 'Create OpenAI-compatible chat completions in MissionSquad.',
    parameters: ChatCompletionsSchema,
    run: async (client, args) => {
      const headers: Record<string, string | undefined> = {
        'x-client-id': args.xClientId,
        'x-session-id': args.xSessionId,
      }

      const body = { ...args } as Record<string, unknown>
      delete body.xClientId
      delete body.xSessionId

      return client.requestJson({
        method: 'POST',
        path: 'chat/completions',
        headers,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_embeddings',
    description: 'Create OpenAI-compatible embeddings in MissionSquad.',
    parameters: EmbeddingsSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'embeddings',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_providers',
    description: 'List configured upstream providers for your account.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/providers',
      }),
  }),
  defineTool({
    name: 'msq_add_provider',
    description: 'Add or update a provider configuration.',
    parameters: AddProviderSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/add/provider',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_delete_provider',
    description: 'Delete a provider configuration by providerKey.',
    parameters: DeleteProviderSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/delete/provider',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_discover_provider_models',
    description: 'Discover available models from a configured provider.',
    parameters: DiscoverProviderModelsSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/models',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_add_model',
    description: 'Add a model to your MissionSquad namespace.',
    parameters: AddModelSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/add/model',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_delete_model',
    description: 'Delete a model or embedding model by modelId.',
    parameters: DeleteModelSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/delete/model',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_agents',
    description: 'List your MissionSquad agents.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/agents',
      }),
  }),
  defineTool({
    name: 'msq_add_agent',
    description:
      'Create or update an agent definition. '
      + 'Accepts systemPromptId (from msq_generate_prompt) as an alternative to systemPrompt — '
      + 'recommended for complex/long prompts to avoid output truncation. '
      + 'Use the `tools` parameter with function names; the server resolves them to MCP servers.',
    parameters: AddAgentSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/add/agent',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_update_agent',
    description:
      'Update specific fields of an existing agent without recreating it. '
      + 'Only provide fields you want to change; all others are preserved. '
      + 'Accepts systemPromptId from msq_generate_prompt as an alternative to systemPrompt.',
    parameters: UpdateAgentSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'PUT',
        path: 'core/update/agent',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_delete_agent',
    description: 'Delete an agent by name.',
    parameters: DeleteAgentSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/delete/agent',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_generate_prompt',
    description:
      'Generate a system prompt using MissionSquad core prompt generation. '
      + 'Returns the generated prompt text and a promptId. '
      + 'Pass the promptId to msq_add_agent or msq_update_agent via systemPromptId '
      + 'to avoid re-emitting the full prompt (prevents output truncation on large prompts).',
    parameters: GeneratePromptSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/generate/prompt',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_run_agent_workflow',
    description: 'Execute a MissionSquad agent workflow.',
    parameters: AgentWorkflowSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/agent-workflow',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_get_core_config',
    description: 'Get MissionSquad core config (models, agents, embeddings, collections).',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/config',
      }),
  }),
  defineTool({
    name: 'msq_scrape_url',
    description: 'Request MissionSquad to scrape text content from a URL.',
    parameters: ScrapeUrlSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/scrape-url',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_tools',
    description: 'List MissionSquad MCP tool inventories available to agents.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/tools',
      }),
  }),
  defineTool({
    name: 'msq_list_servers',
    description: 'List MissionSquad MCP server inventory and status.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/servers',
      }),
  }),
  defineTool({
    name: 'msq_list_core_collections',
    description: 'List MissionSquad core embedded collections.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/collections',
      }),
  }),
  defineTool({
    name: 'msq_search_core_collection',
    description: 'Search a MissionSquad core embedded collection.',
    parameters: CoreCollectionSearchSchema,
    run: async (client, args) => {
      const { collectionName, ...body } = args

      return client.requestJson({
        method: 'POST',
        path: `core/collections/${encodePathSegment(collectionName)}/search`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_get_core_collection_diagnostics',
    description: 'Get diagnostics for a MissionSquad core embedded collection.',
    parameters: CoreCollectionDiagnosticsSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `core/collections/${encodePathSegment(args.collectionName)}/diagnostics`,
      }),
  }),
  defineTool({
    name: 'msq_recover_core_collection',
    description: 'Run collection recovery for a MissionSquad core embedded collection.',
    parameters: CoreCollectionRecoverSchema,
    run: async (client, args) => {
      const { collectionName, ...body } = args

      return client.requestJson({
        method: 'POST',
        path: `core/collections/${encodePathSegment(collectionName)}/recover`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_list_vector_stores',
    description: 'List MissionSquad vector stores.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'vector_stores',
      }),
  }),
  defineTool({
    name: 'msq_create_vector_store',
    description: 'Create a MissionSquad vector store and optionally enqueue files.',
    parameters: CreateVectorStoreSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'vector_stores',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_get_vector_store',
    description: 'Get a MissionSquad vector store by id.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}`,
      }),
  }),
  defineTool({
    name: 'msq_delete_vector_store',
    description: 'Delete a MissionSquad vector store by id.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}`,
      }),
  }),
  defineTool({
    name: 'msq_list_vector_store_files',
    description: 'List files associated with a vector store.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}/files`,
      }),
  }),
  defineTool({
    name: 'msq_add_vector_store_file',
    description: 'Add an existing uploaded file to a vector store and embed it.',
    parameters: AddVectorStoreFileSchema,
    run: async (client, args) => {
      const { vectorStoreId, ...body } = args

      return client.requestJson({
        method: 'POST',
        path: `vector_stores/${encodePathSegment(vectorStoreId)}/files`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_get_vector_store_file',
    description: 'Get vector-store association details for a specific file.',
    parameters: VectorStoreFileSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}/files/${encodePathSegment(args.fileId)}`,
      }),
  }),
  defineTool({
    name: 'msq_cancel_vector_store_session',
    description: 'Cancel an in-progress vector-store embedding session by sessionId.',
    parameters: CancelVectorStoreSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'vector_stores/cancel',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_list_files',
    description: 'List uploaded files.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'files',
      }),
  }),
  defineTool({
    name: 'msq_upload_file',
    description: 'Upload a file for vector-store workflows.',
    parameters: UploadFileSchema,
    run: async (client, args) =>
      client.uploadFile({
        filePath: args.filePath,
        purpose: args.purpose,
        relativePath: args.relativePath,
        collectionName: args.collectionName,
        filename: args.filename,
      }),
  }),
  defineTool({
    name: 'msq_get_file',
    description: 'Get uploaded file metadata by id.',
    parameters: FileIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `files/${encodePathSegment(args.fileId)}`,
      }),
  }),
  defineTool({
    name: 'msq_delete_file',
    description: 'Delete an uploaded file by id.',
    parameters: FileIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `files/${encodePathSegment(args.fileId)}`,
      }),
  }),
  defineTool({
    name: 'msq_get_file_content',
    description: 'Fetch file content as base64 with byte limits for safe transport.',
    parameters: FileContentSchema,
    run: async (client, args) =>
      client.getFileContent({
        fileId: args.fileId,
        maxBytes: args.maxBytes,
      }),
  }),
  defineTool({
    name: 'msq_list_user_collections',
    description: 'List convenience user collections summary.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'user-collections',
      }),
  }),
  defineTool({
    name: 'msq_get_vector_store_file_details',
    description: 'Get decoded filename/path details for files in a vector store.',
    parameters: VectorStoreIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `vector_stores/${encodePathSegment(args.vectorStoreId)}/file-details`,
      }),
  }),
  defineTool({
    name: 'msq_list_scheduled_runs',
    description: 'List all scheduled runs for your account.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/scheduled-runs',
      }),
  }),
  defineTool({
    name: 'msq_create_scheduled_run',
    description: 'Create a new scheduled run for an agent with timing and delivery options.',
    parameters: CreateScheduledRunSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'POST',
        path: 'core/scheduled-runs',
        body: args,
      }),
  }),
  defineTool({
    name: 'msq_update_scheduled_run',
    description: 'Update an existing scheduled run by id.',
    parameters: UpdateScheduledRunSchema,
    run: async (client, args) => {
      const { id, ...body } = args

      return client.requestJson({
        method: 'PUT',
        path: `core/scheduled-runs/${encodePathSegment(id)}`,
        body,
      })
    },
  }),
  defineTool({
    name: 'msq_delete_scheduled_run',
    description: 'Delete a scheduled run by id.',
    parameters: ScheduledRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'DELETE',
        path: `core/scheduled-runs/${encodePathSegment(args.id)}`,
      }),
  }),
  defineTool({
    name: 'msq_toggle_scheduled_run',
    description: 'Toggle a scheduled run enabled/disabled by id.',
    parameters: ScheduledRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'PUT',
        path: `core/scheduled-runs/${encodePathSegment(args.id)}/toggle`,
      }),
  }),
  defineTool({
    name: 'msq_get_scheduled_run_results',
    description: 'Get execution results for a scheduled run by id.',
    parameters: ScheduledRunIdSchema,
    run: async (client, args) =>
      client.requestJson({
        method: 'GET',
        path: `core/scheduled-runs/${encodePathSegment(args.id)}/results`,
      }),
  }),
  defineTool({
    name: 'msq_get_user_settings',
    description: 'Get current user settings including utility agent configuration.',
    parameters: EmptySchema,
    run: async (client) =>
      client.requestJson({
        method: 'GET',
        path: 'core/user/settings',
      }),
  }),
] as const

export const MSQ_TOOL_NAMES = msqTools.map((tool) => tool.name)

export function registerMissionSquadTools(server: FastMCP<undefined>): void {
  for (const tool of msqTools) {
    server.addTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (args, context) => {
        logger.info(`Tool: ${tool.name} - called`)
        logger.debug(`Tool: ${tool.name} - extraArgs keys: ${context.extraArgs ? Object.keys(context.extraArgs).join(', ') : 'none'}`)
        try {
          const client = createMissionSquadClient(context.extraArgs)
          const run = tool.run as (
            client: MissionSquadClient,
            args: unknown,
          ) => Promise<unknown>
          const result = await run(client, args)
          logger.info(`Tool: ${tool.name} - success`)
          return stringifyResult(result)
        } catch (error) {
          if (error instanceof MsqApiError) {
            logger.error(
              `Tool: ${tool.name} - API error: ${error.status} ${error.statusText} | url=${error.url} | body=${JSON.stringify(error.responseBody)}`
            )
          } else {
            logger.error(`Tool: ${tool.name} - failed: ${error instanceof Error ? error.message : String(error)}`)
          }
          throw toUserError(error, `Tool ${tool.name} failed`)
        }
      },
    })
  }
}

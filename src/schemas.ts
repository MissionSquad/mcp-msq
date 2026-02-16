import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)
const MetadataSchema = z.record(z.unknown())

const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])

const ChatMessageSchema = z
  .object({
    role: MessageRoleSchema,
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
  })
  .passthrough()

const OpenAiFunctionToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: NonEmptyString,
    description: z.string().optional(),
    parameters: z.object({}).passthrough(),
  }),
})

const OpenAiToolChoiceSchema = z.union([z.string(), z.object({}).passthrough()])

const ChunkingStrategySchema = z.union([
  z.object({
    type: z.literal('auto'),
  }),
  z.object({
    type: z.literal('static'),
    static: z.object({
      max_chunk_size_tokens: z.number().int().positive(),
      chunk_overlap_tokens: z.number().int().min(0),
    }),
  }),
])

export const EmptySchema = z.object({})

export const ChatCompletionsSchema = z
  .object({
    model: NonEmptyString,
    messages: z.array(ChatMessageSchema).min(1),
    temperature: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    top_p: z.number().optional(),
    n: z.number().int().positive().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    tools: z.array(OpenAiFunctionToolSchema).optional(),
    tool_choice: OpenAiToolChoiceSchema.optional(),
    stream: z.boolean().optional(),
    xClientId: NonEmptyString.optional(),
    xSessionId: NonEmptyString.optional(),
  })
  .passthrough()

export const EmbeddingsSchema = z
  .object({
    model: NonEmptyString,
    input: z.union([z.string(), z.array(z.string()).min(1)]),
  })
  .passthrough()

export const AddProviderSchema = z.object({
  providerKey: NonEmptyString,
  apiKey: NonEmptyString.optional(),
  url: z.string().url().optional(),
})

export const DeleteProviderSchema = z.object({
  providerKey: NonEmptyString,
})

export const DiscoverProviderModelsSchema = z.object({
  providerKey: NonEmptyString,
  url: z.string().url().optional(),
  apiKey: NonEmptyString.optional(),
})

export const AddModelSchema = z.object({
  name: NonEmptyString,
  description: z.string(),
  providerKey: NonEmptyString,
  model: NonEmptyString,
  testResponse: z.boolean().optional(),
  getAllApiModels: z.boolean().optional(),
  extractEmbeddingModels: z.boolean().optional(),
})

export const DeleteModelSchema = z.object({
  modelId: NonEmptyString,
})

export const AddAgentSchema = z.object({
  name: NonEmptyString,
  description: z.string(),
  systemPrompt: z.string(),
  model: NonEmptyString,
  overwrite: z.boolean().optional(),
  addToday: z.boolean().optional(),
  timezoneOffset: NonEmptyString.optional(),
  selectedFunctions: z.record(z.array(z.string())).optional(),
})

export const DeleteAgentSchema = z.object({
  name: NonEmptyString,
})

export const GeneratePromptSchema = z.object({
  model: NonEmptyString,
  messages: z.array(ChatMessageSchema).min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['agent', 'workflow']).optional(),
  modelOptions: z.object({}).passthrough().optional(),
})

export const AgentWorkflowSchema = z.object({
  agentName: NonEmptyString,
  messages: z.array(ChatMessageSchema).min(1),
  data: z.object({}).passthrough().optional(),
  delimiter: z.string().optional(),
  concurrency: z.number().int().positive().optional(),
  failureMessage: z.string().optional(),
  failureInstruction: z.string().optional(),
})

export const ScrapeUrlSchema = z.object({
  url: z.string().url(),
})

export const CoreCollectionSearchSchema = z.object({
  collectionName: NonEmptyString,
  query: z.string().min(1),
  embeddingModelName: NonEmptyString,
  topK: z.number().int().positive().optional(),
})

export const CoreCollectionDiagnosticsSchema = z.object({
  collectionName: NonEmptyString,
})

export const CoreCollectionRecoverSchema = z.object({
  collectionName: NonEmptyString,
  strategy: z.enum(['auto', 'repair', 'reembed']).optional(),
  force: z.boolean().optional(),
})

export const CreateVectorStoreSchema = z.object({
  name: NonEmptyString,
  file_ids: z.array(NonEmptyString).optional(),
  chunking_strategy: ChunkingStrategySchema.optional(),
  metadata: MetadataSchema.optional(),
  embeddingModelName: NonEmptyString.optional(),
  enhancePDF: z.boolean().optional(),
  sseSessionId: NonEmptyString.optional(),
  batchSize: z.number().int().positive().optional(),
})

export const VectorStoreIdSchema = z.object({
  vectorStoreId: NonEmptyString,
})

export const VectorStoreFileSchema = z.object({
  vectorStoreId: NonEmptyString,
  fileId: NonEmptyString,
})

export const AddVectorStoreFileSchema = z.object({
  vectorStoreId: NonEmptyString,
  file_id: NonEmptyString,
  chunking_strategy: ChunkingStrategySchema.optional(),
  enhancePDF: z.boolean().optional(),
})

export const CancelVectorStoreSchema = z.object({
  sessionId: NonEmptyString,
})

export const UploadFileSchema = z.object({
  filePath: z.string().min(1),
  purpose: NonEmptyString,
  relativePath: z.string().optional(),
  collectionName: z.string().optional(),
  filename: z.string().optional(),
})

export const FileIdSchema = z.object({
  fileId: NonEmptyString,
})

export const FileContentSchema = z.object({
  fileId: NonEmptyString,
  maxBytes: z.number().int().positive().optional(),
})

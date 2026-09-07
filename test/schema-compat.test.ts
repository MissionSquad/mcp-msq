import { describe, expect, it } from 'vitest'
import {
  AddAgentSchema,
  AddVectorStoreFileSchema,
  ChatCompletionsSchema,
  CreateScheduledRunSchema,
  CreateVectorStoreSchema,
  FactoryScheduleCreateSchema,
  GeneratePromptSchema,
  PublishAgentSchema,
  UpdateAgentSchema,
} from '../src/schemas.js'

describe('MCP schema compatibility parsing', () => {
  it('accepts JSON-stringified chat message and function tool objects', () => {
    const message = { role: 'user', content: 'Summarize this' }
    const tool = {
      type: 'function',
      function: {
        name: 'lookup',
        description: 'Lookup a value',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
      },
    }

    const parsed = ChatCompletionsSchema.parse({
      model: 'agent-name',
      messages: [JSON.stringify(message)],
      tools: [JSON.stringify(tool)],
      tool_choice: JSON.stringify({ type: 'function', function: { name: 'lookup' } }),
    })

    expect(parsed.messages).toEqual([message])
    expect(parsed.tools).toEqual([tool])
    expect(parsed.tool_choice).toEqual({ type: 'function', function: { name: 'lookup' } })
  })

  it('accepts JSON-stringified generate-prompt message and model options', () => {
    const message = { role: 'user', content: 'Write a prompt' }
    const modelOptions = { temperature: 0.2 }

    const parsed = GeneratePromptSchema.parse({
      model: 'prompt-model',
      messages: [JSON.stringify(message)],
      modelOptions: JSON.stringify(modelOptions),
    })

    expect(parsed.messages).toEqual([message])
    expect(parsed.modelOptions).toEqual(modelOptions)
  })

  it('accepts JSON-stringified agent selectedFunctions and model options', () => {
    const selectedFunctions = { webtools: ['search'] }
    const modelOptions = { temperature: 0.1, maxTokens: 500 }

    const parsed = AddAgentSchema.parse({
      name: 'Researcher',
      description: 'Research agent',
      systemPrompt: 'Research carefully.',
      model: 'model-name',
      selectedFunctions: JSON.stringify(selectedFunctions),
      modelOptions: JSON.stringify(modelOptions),
    })

    expect(parsed.selectedFunctions).toEqual(selectedFunctions)
    expect(parsed.modelOptions).toEqual(modelOptions)
  })

  it('accepts omitted agent model options on create and update', () => {
    const addAgent = AddAgentSchema.parse({
      name: 'Researcher',
      description: 'Research agent',
      systemPrompt: 'Research carefully.',
      model: 'model-name',
    })
    const updateAgent = UpdateAgentSchema.parse({
      name: 'Researcher',
      description: 'Updated description',
    })

    expect(addAgent.modelOptions).toBeUndefined()
    expect(updateAgent.modelOptions).toBeUndefined()
  })

  it('accepts the verified publish-agent endpoint contract', () => {
    expect(PublishAgentSchema.parse({
      agentId: 'agent-1',
      agentName: 'Researcher',
    })).toEqual({
      agentId: 'agent-1',
      agentName: 'Researcher',
    })
  })

  it('reports malformed JSON object strings clearly', () => {
    const result = ChatCompletionsSchema.safeParse({
      model: 'agent-name',
      messages: ['{"role":"user","content":"missing close"'],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Invalid JSON object string')
    }
  })

  it('accepts JSON-stringified schedule time and slack metadata objects', () => {
    const time = { hour: 19, minute: 15 }
    const slackMetadata = {
      scheduleId: 'sched-1',
      slackUserId: 'U123',
      deliveryChannelId: 'C123',
      teamId: 'T123',
    }

    const factorySchedule = FactoryScheduleCreateSchema.parse({
      factoryConfigId: 'factory-1',
      timesToRun: [JSON.stringify(time)],
      repeatInterval: 'daily',
    })
    const scheduledRun = CreateScheduledRunSchema.parse({
      agentName: 'Agent',
      prompt: 'Run this',
      startDate: 1700000000000,
      timesToRun: [JSON.stringify(time)],
      repeatInterval: 'daily',
      deliveryMethod: 'slack',
      slackWebhookUrl: 'https://example.com/slack',
      slackMetadata: JSON.stringify(slackMetadata),
    })

    expect(factorySchedule.timesToRun).toEqual([time])
    expect(scheduledRun.timesToRun).toEqual([time])
    expect(scheduledRun.slackMetadata).toEqual(slackMetadata)
  })

  it('accepts JSON-stringified vector-store object options', () => {
    const chunkingStrategy = {
      type: 'static',
      static: {
        max_chunk_size_tokens: 800,
        chunk_overlap_tokens: 100,
      },
    }
    const metadata = { source: 'manual' }

    const vectorStore = CreateVectorStoreSchema.parse({
      name: 'Documents',
      chunking_strategy: JSON.stringify(chunkingStrategy),
      metadata: JSON.stringify(metadata),
    })
    const vectorStoreFile = AddVectorStoreFileSchema.parse({
      vectorStoreId: 'vs-1',
      file_id: 'file-1',
      chunking_strategy: JSON.stringify(chunkingStrategy),
    })

    expect(vectorStore.chunking_strategy).toEqual(chunkingStrategy)
    expect(vectorStore.metadata).toEqual(metadata)
    expect(vectorStoreFile.chunking_strategy).toEqual(chunkingStrategy)
  })
})

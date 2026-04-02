import { describe, expect, it } from 'vitest'
import { summarizeCoreConfig, summarizeServerInventories, summarizeToolInventories } from '../src/tools.js'

describe('MissionSquad MCP tool shaping', () => {
  it('summarizes core config maps into compact list-friendly arrays', () => {
    const input = {
      models: {
        model_a: { name: 'Model A', model: 'claude-sonnet-4-6', providerKey: 'anthropic' },
        model_b: { name: 'Model B', model: 'gpt-5.4', providerKey: 'openai' },
      },
      agents: {
        agent_a: { name: 'Agent A', model: 'model_a' },
      },
      embeddingModels: {},
      embeddedCollections: {},
      voices: {},
    }

    const shaped = summarizeCoreConfig(input) as Record<string, unknown>

    expect(shaped.models).toEqual([
      { id: 'model_a', name: 'Model A', model: 'claude-sonnet-4-6', providerKey: 'anthropic' },
      { id: 'model_b', name: 'Model B', model: 'gpt-5.4', providerKey: 'openai' },
    ])
    expect(shaped.agents).toEqual([
      { id: 'agent_a', name: 'Agent A', description: undefined, model: 'model_a' },
    ])
    expect(shaped.counts).toEqual({
      models: 2,
      agents: 1,
      squads: 0,
      missions: 0,
      embeddingModels: 0,
      embeddedCollections: 0,
      voices: 0,
    })
  })

  it('summarizes grouped tool inventories into a compact flat list', () => {
    const input = {
      success: true,
      tools: [
        {
          webtools: [
            { name: 'web_search', description: 'Search the web' },
          ],
        },
        {
          missionsquad: [
            { name: 'msq_get_core_config', description: 'Get core config' },
            { name: 'msq_list_tools', description: 'List tools' },
          ],
        },
      ],
    }

    const shaped = summarizeToolInventories(input) as Record<string, unknown>

    expect(shaped.tools).toEqual([
      { serverName: 'webtools', name: 'web_search', description: 'Search the web' },
      { serverName: 'missionsquad', name: 'msq_get_core_config', description: 'Get core config' },
      { serverName: 'missionsquad', name: 'msq_list_tools', description: 'List tools' },
    ])
    expect(shaped.serverNames).toEqual(['webtools', 'missionsquad'])
    expect(shaped.counts).toEqual({ servers: 2, tools: 3 })
  })

  it('summarizes server inventories into a compact filtered list', () => {
    const input = {
      success: true,
      servers: [
        {
          name: 'weather-server',
          displayName: 'Weather Server',
          transportType: 'stdio',
          description: 'Weather tools',
          installed: true,
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: { NODE_ENV: 'production' },
        },
        {
          name: 'disabled-server',
          displayName: 'Disabled Server',
          transportType: 'streamable_http',
          description: 'Should be omitted',
          installed: true,
          enabled: false,
        },
        {
          name: 'uninstalled-server',
          displayName: 'Uninstalled Server',
          transportType: 'streamable_http',
          description: 'Should be omitted',
          installed: false,
          enabled: true,
        },
      ],
    }

    const shaped = summarizeServerInventories(input) as Record<string, unknown>

    expect(shaped).toEqual({
      servers: [
        {
          name: 'weather-server',
          displayName: 'Weather Server',
          transportType: 'stdio',
          description: 'Weather tools',
        },
      ],
    })
  })
})

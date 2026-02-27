import { describe, expect, it } from 'vitest'
import { MSQ_TOOL_NAMES } from '../src/tools.js'

const EXPECTED_TOOL_NAMES = [
  'msq_list_models',
  'msq_get_model_map',
  'msq_chat_completions',
  'msq_embeddings',
  'msq_list_providers',
  'msq_add_provider',
  'msq_delete_provider',
  'msq_discover_provider_models',
  'msq_add_model',
  'msq_delete_model',
  'msq_list_agents',
  'msq_add_agent',
  'msq_update_agent',
  'msq_delete_agent',
  'msq_generate_prompt',
  'msq_run_agent_workflow',
  'msq_get_core_config',
  'msq_scrape_url',
  'msq_list_tools',
  'msq_list_servers',
  'msq_list_core_collections',
  'msq_search_core_collection',
  'msq_get_core_collection_diagnostics',
  'msq_recover_core_collection',
  'msq_list_vector_stores',
  'msq_create_vector_store',
  'msq_get_vector_store',
  'msq_delete_vector_store',
  'msq_list_vector_store_files',
  'msq_add_vector_store_file',
  'msq_get_vector_store_file',
  'msq_cancel_vector_store_session',
  'msq_list_files',
  'msq_upload_file',
  'msq_get_file',
  'msq_delete_file',
  'msq_get_file_content',
  'msq_list_user_collections',
  'msq_get_vector_store_file_details',
  'msq_list_scheduled_runs',
  'msq_create_scheduled_run',
  'msq_update_scheduled_run',
  'msq_delete_scheduled_run',
  'msq_toggle_scheduled_run',
  'msq_get_scheduled_run_results',
  'msq_get_user_settings',
] as const

describe('MissionSquad MCP tool coverage', () => {
  it('registers the expected tool surface', () => {
    expect(MSQ_TOOL_NAMES).toEqual(EXPECTED_TOOL_NAMES)
  })

  it('registers each tool exactly once', () => {
    expect(new Set(MSQ_TOOL_NAMES).size).toBe(EXPECTED_TOOL_NAMES.length)
  })
})

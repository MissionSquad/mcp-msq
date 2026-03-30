# @missionsquad/mcp-msq

MCP server interface for the MissionSquad platform API (`https://missionsquad.ai`).

This server exposes MissionSquad account-scoped operations for models, agents, providers, vector stores, files, and core utilities via FastMCP tools.

## Features

- FastMCP stdio server (`mcp-msq`)
- MissionSquad API key support via hidden tool arg (`apiKey`) or env fallback (`MSQ_API_KEY`)
- MissionSquad base URL override via hidden tool arg (`baseUrl`) or env fallback (`MSQ_BASE_URL`)
- Strict TypeScript and Zod-validated tool inputs
- Multipart file upload support (`POST /v1/files`)
- Bounded binary file-content retrieval (`GET /v1/files/:id/content`) with truncation metadata
- Build/test CI and npm publish workflow

## Verified API Coverage

Implemented from `missionsquad-docs/api/index.md` and the following reference pages:

- `chat-completions.md`
- `embeddings.md`
- `providers.md`
- `models.md`
- `agents.md`
- `core-utilities.md`
- `collections.md`
- `vector-stores.md`
- `files.md`
- `convenience.md`
- `endpoint-index.md`

Current implementation intentionally excludes Webhooks endpoints because the reference only lists routes without request/response contracts.

## Requirements

- Node.js `>=20`
- Yarn

## Installation

```bash
yarn install
yarn build
yarn start
```

Run as CLI after install/publish:

```bash
mcp-msq
```

## Configuration

Copy `.env.example` to `.env`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MSQ_API_KEY` | No | unset | MissionSquad API key fallback when hidden `apiKey` is not passed |
| `MSQ_BASE_URL` | No | `https://agents.missionsquad.ai/v1` | Base URL for v1 endpoints |
| `MSQ_HTTP_TIMEOUT_MS` | No | `30000` | Request timeout in milliseconds |
| `MSQ_DEFAULT_FILE_CONTENT_MAX_BYTES` | No | `1048576` | Default max bytes returned by `msq_get_file_content` |

## Hidden Arguments

The following are intentionally not in tool schemas and should be passed as hidden extra args:

- `apiKey`: MissionSquad API key for request authentication
- `baseUrl`: Optional base URL override

Resolution order per request:

1. Hidden extra arg
2. Environment fallback

If no API key is available, the tool returns a user-facing error.

## Tool Surface

### Core OpenAI-Compatible

- `msq_list_models`
- `msq_get_model_map`
- `msq_chat_completions`
- `msq_embeddings`

### Providers

- `msq_list_providers`
- `msq_add_provider`
- `msq_delete_provider`

### Models

- `msq_discover_provider_models`
- `msq_add_model`
- `msq_delete_model`

### Agents

- `msq_list_agents`
- `msq_add_agent`
- `msq_delete_agent`

### Core Utilities

- `msq_generate_prompt`
- `msq_list_workflows`
- `msq_get_workflow`
- `msq_create_workflow`
- `msq_update_workflow`
- `msq_run_workflow`
- `msq_get_workflow_run_status`
- `msq_get_workflow_result`
- `msq_get_core_config`
- `msq_get_core_config_summary`
- `msq_scrape_url`
- `msq_list_tools`
- `msq_list_tool_functions`
- `msq_list_servers`
- `msq_list_server_tools`

### Core Collections

- `msq_list_core_collections`
- `msq_search_core_collection`
- `msq_get_core_collection_diagnostics`
- `msq_recover_core_collection`

### Vector Stores

- `msq_list_vector_stores`
- `msq_create_vector_store`
- `msq_get_vector_store`
- `msq_delete_vector_store`
- `msq_list_vector_store_files`
- `msq_add_vector_store_file`
- `msq_get_vector_store_file`
- `msq_cancel_vector_store_session`

### Files

- `msq_list_files`
- `msq_upload_file`
- `msq_get_file`
- `msq_delete_file`
- `msq_get_file_content`

### Convenience

- `msq_list_user_collections`
- `msq_get_vector_store_file_details`

## PTC-Friendly Output Notes

The original MissionSquad tools remain available with their raw API-aligned output shapes:

- `msq_get_core_config`
- `msq_list_tools`

For programmatic tool calling and other iteration-heavy consumers, use the compact tools instead:

### `msq_get_core_config_summary`

Returns a compact summary with:

- `models`: array of model records
- `agents`: array of agent summaries
- `squads`
- `missions`
- `embeddingModels`
- `embeddedCollections`
- `voices`
- `counts`

This tool is intended for iteration and discovery, not for retrieving the full raw config payload.

### `msq_list_tool_functions`

Returns a compact summary with:

- `tools`: flat array of tool functions with `serverName`, `name`, and `description`
- `serverNames`
- `counts`

This tool is intended for discovery and agent/tool selection workflows.

### `msq_list_server_tools`

Returns the raw tool inventory for a single MCP server:

- input: `serverName`
- output: the same tool list structure returned by MissionSquad for that server only

Use this after `msq_list_servers` when you need detailed tool schemas for a specific server without loading the full global inventory.

## Workflow Lifecycle

Workflow management uses the persisted workflow config and workflow run endpoints rather than the deprecated legacy SSE workflow route.

Supported workflow operations:

- create a workflow config with `msq_create_workflow`
- update a workflow config with `msq_update_workflow`
- list workflow configs with `msq_list_workflows`
- fetch a single workflow config with `msq_get_workflow`
- start a workflow run with `msq_run_workflow`
- inspect helper/main status with `msq_get_workflow_run_status`
- fetch the final main-agent result with `msq_get_workflow_result`

`msq_get_workflow_run_status` returns helper success/failure state without helper content.

`msq_get_workflow_result` returns only the final main-agent response and will fail if the run is still in progress or did not complete successfully.

## File Upload and Download Notes

`msq_upload_file` accepts:

- `filePath` (required)
- `purpose` (required)
- `relativePath` (optional)
- `collectionName` (optional)
- `filename` (optional override)

`msq_get_file_content` returns:

- `contentType`
- `contentLength`
- `bytesRead`
- `truncated`
- `base64`

If response content exceeds `maxBytes` (or `MSQ_DEFAULT_FILE_CONTENT_MAX_BYTES`), payload is truncated safely and reported via `truncated: true`.

## Response Format

All tool handlers return deterministic JSON text strings. Parse text content on the client side if structured access is needed.

When a compact summary tool is used, the MCP output contract documented in this README is the authoritative interface for tool callers.

## Usage Examples

### JSON-RPC tools/call with hidden API key

```json
{
  "method": "tools/call",
  "params": {
    "name": "msq_list_models",
    "arguments": {
      "apiKey": "msq-..."
    }
  }
}
```

### JSON-RPC tools/call with body args

```json
{
  "method": "tools/call",
  "params": {
    "name": "msq_chat_completions",
    "arguments": {
      "model": "my-gpt4",
      "messages": [
        { "role": "user", "content": "Hello" }
      ],
      "apiKey": "msq-..."
    }
  }
}
```

### FastMCP-style client call

```ts
await client.callTool('msq_embeddings', {
  model: 'nomic-embed-text-v1.5',
  input: ['First sentence', 'Second sentence'],
  apiKey: 'msq-...',
})
```

### Workflow example

Create a workflow:

```ts
await client.callTool('msq_create_workflow', {
  name: 'Research Workflow',
  mainAgentId: 'agent_main_123',
  mainPrompt: 'Summarize findings from <collector|#|sourceA> and <collector|#|sourceB>',
  dataPayload: '{"sourceA":"https://a.example","sourceB":"https://b.example"}',
  concurrency: 2,
  delimiter: '|#|',
  apiKey: 'msq-...',
})
```

Start a workflow run:

```ts
await client.callTool('msq_run_workflow', {
  workflowId: 'wf_123',
  apiKey: 'msq-...',
})
```

Get workflow status:

```ts
await client.callTool('msq_get_workflow_run_status', {
  runId: 'run_abc',
  apiKey: 'msq-...',
})
```

Get the final result:

```ts
await client.callTool('msq_get_workflow_result', {
  runId: 'run_abc',
  apiKey: 'msq-...',
})
```

## Development

Scripts:

- `yarn build`
- `yarn start`
- `yarn dev`
- `yarn inspect`
- `yarn test`
- `yarn test:coverage`

## CI/CD

- `.github/workflows/build.yaml`: build + test on PR open/sync
- `.github/workflows/publish.yaml`: build + test + publish on `main` push (markdown-only changes ignored)

## License

MIT

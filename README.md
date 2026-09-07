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
- Compact MCP server discovery output for installed/enabled servers only
- Agent Pages management (owner builder API under `/v1/core/pages`) plus the anonymous public page read/run surface
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
- `msq_publish_agent`
- `msq_delete_agent`

`msq_add_agent` automatically ensures the created or overwritten agent is published. Its normal
creation response includes a `publish` field:

- `success: true`, `alreadyPublished`, and the published-agent record when publishing succeeds
- `success: false`, `error`, and optional API `status`/`details` when creation succeeded but
  publishing failed

`msq_publish_agent` accepts `agentId` and `agentName`. It is publish-only and idempotent from the
MCP caller's perspective: it checks current publish records before invoking the API's toggle
endpoint, so an already-published agent is not unpublished.

### Core Utilities

- `msq_generate_prompt`
- `msq_list_workflows`
- `msq_get_workflow`
- `msq_create_workflow`
- `msq_update_workflow`
- `msq_run_workflow`
- `msq_get_workflow_run_status`
- `msq_get_workflow_result`
- `msq_delete_workflow`
- `msq_list_workflow_runs`
- `msq_cancel_workflow_run`
- `msq_list_factories`
- `msq_get_factory`
- `msq_create_factory`
- `msq_update_factory`
- `msq_delete_factory`
- `msq_list_factory_runs`
- `msq_run_factory`
- `msq_get_factory_run_status`
- `msq_get_factory_result`
- `msq_list_factory_run_steps`
- `msq_get_factory_run_step`
- `msq_get_factory_run_step_hydrated`
- `msq_pause_factory_run`
- `msq_resume_factory_run`
- `msq_cancel_factory_run`
- `msq_list_factory_schedules`
- `msq_create_factory_schedule`
- `msq_update_factory_schedule`
- `msq_delete_factory_schedule`
- `msq_toggle_factory_schedule`
- `msq_get_core_config`
- `msq_get_core_config_summary`
- `msq_scrape_url`
- `msq_list_tools`
- `msq_list_tool_functions`
- `msq_list_servers`
- `msq_list_server_tools`

### Agent Pages

Owner (builder) surface — authenticated with the API key:

- `msq_list_pages`
- `msq_get_page`
- `msq_create_page`
- `msq_update_page`
- `msq_delete_page`
- `msq_publish_page`
- `msq_unpublish_page`
- `msq_compile_page_layout_schema`
- `msq_list_page_categories`
- `msq_run_page_preview`
- `msq_list_page_runs`
- `msq_get_page_run_status`
- `msq_get_page_run_result`
- `msq_delete_page_run`
- `msq_get_page_preview_token`
- `msq_get_page_email_preview`
- `msq_list_x402_networks`

Public surface — what an anonymous visitor of `<publicOrigin>/p/<slug>` sees (served from the API origin at
`/api/public/pages/...`, outside the `/v1` base path):

- `msq_get_public_page`
- `msq_get_public_page_content`
- `msq_list_public_page_runs`
- `msq_run_public_page`
- `msq_get_public_page_run`

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

### `msq_list_servers`

Returns a compact server list for discovery workflows:

- `servers`: array of records with only `name`, `displayName`, `transportType`, and `description`

This tool filters out servers that are not installed or not enabled.

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
- list a workflow's recent runs with `msq_list_workflow_runs`
- cancel an in-flight run with `msq_cancel_workflow_run`
- delete a workflow config with `msq_delete_workflow`

`msq_run_workflow` accepts:

- `workflowId` (required)
- `dataPayload` (optional JSON string override for this run only)

When `dataPayload` is provided to `msq_run_workflow`, it overrides the saved workflow config payload for that execution without modifying the workflow config itself.

`msq_get_workflow_run_status` returns helper success/failure state without helper content. For queued or running workflow runs, it waits on the MissionSquad workflow SSE stream and returns once the run reaches a terminal state.

`msq_get_workflow_result` returns only the final main-agent response and will fail if the run is still in progress or did not complete successfully.

## Factory Lifecycle

Factory management uses the persisted factory config, factory run, factory step, and factory schedule endpoints.

Supported factory operations:

- list factory configs with `msq_list_factories`
- fetch a single factory config with `msq_get_factory`
- create a factory config with `msq_create_factory`
- update a factory config with `msq_update_factory`
- delete a factory config with `msq_delete_factory`
- list recent runs for a factory with `msq_list_factory_runs`
- start a factory run with `msq_run_factory`
- wait for a run to complete or pause with `msq_get_factory_run_status`
- fetch the final carry payload with `msq_get_factory_result`
- inspect recorded step runs with `msq_list_factory_run_steps`
- fetch one step run with `msq_get_factory_run_step`
- fetch one step run plus linked workflow/chat details with `msq_get_factory_run_step_hydrated`
- pause, resume, or cancel runs with `msq_pause_factory_run`, `msq_resume_factory_run`, and `msq_cancel_factory_run`
- list, create, update, delete, or toggle schedules with the `msq_*factory_schedule*` tools

Recommended factory tool sequence:

- discover or select the factory with `msq_list_factories` or `msq_get_factory`
- start the run with `msq_run_factory`
- wait for completion or pause with `msq_get_factory_run_status`
- fetch the final output with `msq_get_factory_result`
- use the step tools only when you need debugging or execution detail

`msq_run_factory` accepts:

- `factoryConfigId` (required)
- `initialCarryPayload` (optional string; if omitted, MissionSquad starts the run with an empty string payload)

`msq_get_factory_run_status` returns compact high-level run status and intentionally omits the final `carryPayload`. For queued or running runs, it waits on the MissionSquad factory SSE stream and returns once the run becomes `completed`, `error`, `cancelled`, or `paused`.

`msq_get_factory_result` returns only the final run output in `result.carryPayload`. That payload may be plain text or a JSON string, so callers must not assume a specific format.

Factory schedule notes:

- `timesToRun` uses backend UTC storage shape: `[{ "hour": 19, "minute": 15 }]`
- `msq_create_factory_schedule` defaults to `repeatInterval: "once"` and `status: "enabled"` when omitted by the caller and backend
- weekly schedules require `daysOfWeek`
- monthly schedules require `dayOfMonth`

## Agent Pages Lifecycle

An Agent Page publishes an agent's, workflow's, or factory's output at a public URL
(`<publicOrigin>/p/<slug>`), either as scheduled editions or as on-demand runs. A page is:

- a **header** (title, description, owner byline, optional "Powered by" line),
- a **source** (`agent` | `workflow` | `factory`, referenced by owned id),
- a **layout** (block DSL compiled by the API to a strict JSON Schema every run must satisfy),
- a **run mode** (`on-demand` with an optional visitor input form, or `scheduled` daily/weekly),
- optional visibility (`publicListed: false` = unlisted, `visibility: 'private'` = owner-only), categories,
  x402 per-run payment (on-demand only), and platform options (platform pages only).

Recommended sequence:

1. `msq_list_page_categories` (optional) and `msq_list_x402_networks` (paid pages only) for valid values.
2. `msq_create_page` — returns a draft. Nothing is public yet.
3. For workflow/factory sources: `msq_compile_page_layout_schema` and paste the schema into the final
   agent's prompt so its raw output validates directly (skips the formatter call).
4. `msq_run_page_preview` → `msq_get_page_run_status` → `msq_get_page_run_result` to prove the source
   produces valid content before going live (owner runs do not count against the free-run cap).
5. `msq_publish_page` — allocates the slug from the title (stable afterwards) and returns `publicUrl`.
6. Verify as a visitor: `msq_get_public_page`, then `msq_run_public_page` → `msq_get_public_page_run`
   for on-demand pages or `msq_get_public_page_content` for scheduled editions.
7. Iterate with `msq_update_page` — prompt/layout edits apply on the next run without republishing.
8. Clean up failed attempts with `msq_delete_page_run`; `msq_unpublish_page` before `msq_delete_page`.

Notes:

- `msq_update_page` is a read-modify-write: only the fields you pass change, `null` removes an optional
  block, and switching `runMode` drops the other mode's blocks (unless supplied in the same call).
- On-demand input-form field names must match how the source reads input: agent pages receive the fields
  as a fenced "Run input" JSON block; workflow pages merge them over the workflow `dataPayload` (keys must
  exist there); factory pages pass them as the initial carry payload.
- Layouts containing `url` or `image` fields require a Gemini model on agent-source pages — OpenAI models
  reject the compiled `format: "uri"` in strict `response_format`.
- `msq_get_page_run_status` polls the owner run list (no owner-side event stream exists) up to
  `timeoutSeconds` (default 360; server-side runs are capped at 5 minutes). `msq_get_public_page_run`
  follows the public run's server-sent event stream instead.
- Owner run rows carry the raw provider error text; the public run detail returns only the fixed safe copy.
- Live pages return 409 on delete; deleted pages free their slug, unpublished pages keep it reserved.

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
  mainAgentName: 'Coordinator',
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

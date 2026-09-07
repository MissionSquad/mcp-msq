# MCP MissionSquad Server Implementation Handbook

## 1. Verification Baseline (Source of Truth)

This handbook is based on verified local sources only:

- `missionsquad-docs/api/index.md`
- `missionsquad-docs/api/reference/endpoint-index.md`
- `missionsquad-docs/api/reference/chat-completions.md`
- `missionsquad-docs/api/reference/embeddings.md`
- `missionsquad-docs/api/reference/providers.md`
- `missionsquad-docs/api/reference/models.md`
- `missionsquad-docs/api/reference/agents.md`
- `missionsquad-docs/api/reference/core-utilities.md`
- `missionsquad-docs/api/reference/collections.md`
- `missionsquad-docs/api/reference/vector-stores.md`
- `missionsquad-docs/api/reference/files.md`
- `missionsquad-docs/api/reference/convenience.md`
- `missionsquad-docs/api/reference/webhooks.md`
- `mcp-evm/README.md`
- `mcp-evm/IMPLEMENTATION_HANDBOOK.md`
- `mcp-evm/src/*.ts`
- `mcp-evm/.github/workflows/*.yaml`
- `mcp-evm/node_modules/@missionsquad/fastmcp/dist/FastMCP.d.ts`
- `mcp-evm/node_modules/@missionsquad/fastmcp/README.md` (extraArgs behavior)

No endpoint body schema or return schema was inferred from undocumented sources.

## 2. Scope and Non-Scope

### In Scope

Implement MCP tools for all MissionSquad API endpoints with documented request contracts in reference files:

- Core OpenAI-compatible endpoints (`/models`, `/modelmap`, `/chat/completions`, `/embeddings`)
- Providers, Models, Agents, Core Utilities, Core Collections
- Vector Stores, Files, Convenience endpoints

### Out of Scope (Current Version)

Webhooks are excluded from tool surface in this version because `webhooks.md` only lists routes and does not provide request/response contracts.

Required prerequisites to add webhooks safely:

- Request body schemas for create/update/trigger
- Response schemas for webhook resources and execution history
- Auth and token semantics for `/v1/webhooks/:webhookId/token`

## 3. Architecture Requirements

1. Do not expose `apiKey` or `baseUrl` in public tool schemas.
2. Resolve auth/base URL via hidden `context.extraArgs` first, then env fallback.
3. Validate all public tool arguments with Zod.
4. Keep HTTP transport, config, and tool wiring in separate modules.
5. Return deterministic JSON text from every tool.
6. Use strict TypeScript and avoid `any`.
7. Keep stdout clean for MCP protocol frames.

## 4. Project Structure (Create Exactly)

```text
mcp-msq/
  .github/
    workflows/
      build.yaml
      publish.yaml
  src/
    config.ts
    errors.ts
    index.ts
    json.ts
    msq-client.ts
    schemas.ts
    stdio-safe-console.ts
    tools.ts
  test/
    config.test.ts
    tool-coverage.test.ts
  .env.example
  .gitignore
  IMPLEMENTATION_HANDBOOK.md
  README.md
  package.json
  tsconfig.json
  yarn.lock
```

## 5. Runtime Configuration Contract

### Environment Variables

- `MSQ_API_KEY` (optional fallback)
- `MSQ_BASE_URL` (default `https://agents.missionsquad.ai/v1`)
- `MSQ_HTTP_TIMEOUT_MS` (default `30000`)
- `MSQ_DEFAULT_FILE_CONTENT_MAX_BYTES` (default `1048576`)

### Hidden Extra Args

- `apiKey` overrides `MSQ_API_KEY`
- `baseUrl` overrides `MSQ_BASE_URL`

Validation rules:

- If hidden value is provided, it must be a non-empty string.
- If `apiKey` cannot be resolved from hidden arg or env, tool call fails with `UserError`.

## 6. HTTP Client Responsibilities

`src/msq-client.ts` is the sole module responsible for MissionSquad HTTP I/O.

### Required Behavior

- Attach `x-api-key` to every request.
- Support JSON requests for `GET`/`POST`/`DELETE`/`PUT`.
- Support multipart upload for `POST /v1/files`.
- Apply request timeout via `AbortController`.
- Parse JSON responses when content type is JSON; otherwise return text/null.
- Throw typed errors:
  - `MsqApiError` for non-2xx responses
  - `MsqTransportError` for timeout/network failures
- For `GET /v1/files/:id/content`, stream and cap payload by `maxBytes`, returning:
  - `contentType`
  - `contentLength`
  - `bytesRead`
  - `truncated`
  - `base64`

## 7. Tool Mapping (Verified)

### Core OpenAI-Compatible

- `msq_list_models` → `GET /v1/models`
- `msq_get_model_map` → `GET /v1/modelmap`
- `msq_chat_completions` → `POST /v1/chat/completions`
- `msq_embeddings` → `POST /v1/embeddings`

### Providers

- `msq_list_providers` → `GET /v1/core/providers`
- `msq_add_provider` → `POST /v1/core/add/provider`
- `msq_delete_provider` → `POST /v1/core/delete/provider`

### Models

- `msq_discover_provider_models` → `POST /v1/core/models`
- `msq_add_model` → `POST /v1/core/add/model`
- `msq_delete_model` → `POST /v1/core/delete/model`

### Agents

- `msq_list_agents` → `GET /v1/core/agents`
- `msq_add_agent` → `POST /v1/core/add/agent`
  - On a verified success response, automatically ensure the returned agent is published.
  - Preserve the creation response and append a structured `publish` success or partial-failure result.
- `msq_publish_agent` → `GET /v1/core/agents/published`, then conditionally `POST /v1/core/agents/publish`
  - Input: `{ agentId: string; agentName: string }`
  - Publish-only MCP semantics: return the active record without toggling when already published.
  - Success output: `{ success: true; alreadyPublished: boolean; data: PublishedAgent }`
- `msq_delete_agent` → `POST /v1/core/delete/agent`

### Core Utilities

- `msq_generate_prompt` → `POST /v1/core/generate/prompt`
- `msq_run_agent_workflow` → `POST /v1/core/agent-workflow`
- `msq_get_core_config` → `GET /v1/core/config`
- `msq_get_core_config_summary` → `GET /v1/core/config`
  - MCP output contract is compact and list-friendly:
    - `models`, `agents`, `squads`, `missions`, `embeddingModels`, `embeddedCollections`, `voices` are arrays
    - `counts` summarizes totals
- `msq_scrape_url` → `POST /v1/core/scrape-url`
- `msq_list_tools` → `GET /v1/core/tools`
- `msq_list_tool_functions` → `GET /v1/core/tools`
  - MCP output contract is compact and list-friendly:
    - `tools` is a flat array with `serverName`, `name`, and `description`
    - `serverNames` lists available server names
    - `counts` summarizes totals
- `msq_list_servers` → `GET /v1/core/servers`
- `msq_list_server_tools` → `GET /v1/mcp/servers/:name/tools`
  - MCP output contract preserves the raw per-server tool list for detailed inspection

### Agent Pages (owner builder API — `combinedMiddleware`, API key accepted)

Verified against `missionsquad-api/src/controllers/pages.ts`, `services/page.ts`,
`utils/pageLayout.ts`, `types/pages.ts` and a live capture on 2026-09-06.

- `msq_list_pages` → `GET /v1/core/pages` → `{ pages: PageSummary[], publicOrigin }` (+ derived `publicUrl`)
- `msq_get_page` → `GET /v1/core/pages/:id` → `{ page: PageRecord, publicOrigin }` (+ derived `publicUrl`)
- `msq_create_page` → `POST /v1/core/pages` (body `PageDraftInput`; `onDemand` defaulted for on-demand pages)
- `msq_update_page` → `GET /v1/core/pages/:id` then `PUT /v1/core/pages/:id` with the merged full
  `PageDraftInput` (the API replaces every user-editable field; `null` removes optional blocks; runMode /
  pageType switches drop the blocks the §6 combination rules forbid unless supplied)
- `msq_delete_page` → `DELETE /v1/core/pages/:id` → `{ ok: true }` (409 while live)
- `msq_publish_page` → `POST /v1/core/pages/:id/publish` → `{ page, publicOrigin }`
- `msq_unpublish_page` → `POST /v1/core/pages/:id/unpublish` → `{ page, publicOrigin }`
- `msq_compile_page_layout_schema` → `POST /v1/core/pages/layout-schema` → `{ schema }`
- `msq_list_page_categories` → `GET /v1/core/pages/categories` → `{ categories }`
- `msq_run_page_preview` → `POST /v1/core/pages/:id/preview-run` (body `{ input? }`) → 202 `{ runId }`
- `msq_list_page_runs` → `GET /v1/core/pages/:id/runs?limit&offset` → `{ runs, total }`
  - MCP output omits each run's `content` document and adds `hasContent`
- `msq_get_page_run_status` → polls `GET /v1/core/pages/:id/runs` (newest first, scanned by run id) until
  `completed` | `error` or `timeoutSeconds`
- `msq_get_page_run_result` → same lookup; returns `content` + `usage` only for `completed` runs
- `msq_delete_page_run` → `DELETE /v1/core/pages/:id/runs/:runId` → `{ ok: true }` (409 while active)
- `msq_get_page_preview_token` → `GET /v1/core/pages/:id/preview-token` → `{ token, path }` (+ derived `url`)
- `msq_get_page_email_preview` → `GET /v1/core/pages/:id/email-preview` → `{ html }`
- `msq_list_x402_networks` → `GET /v1/core/x402/networks` → `{ networks }`

### Agent Pages (anonymous public API — origin-rooted, outside `/v1`)

The public surface is mounted at `/api/public/pages/...` on the API host. The client resolves these
paths against the ORIGIN of the configured base URL (`root: 'origin'`), so
`MSQ_BASE_URL=https://agents.missionsquad.ai/v1` yields `https://agents.missionsquad.ai/api/public/...`.

- `msq_get_public_page` → `GET /api/public/pages/:slug` → `{ descriptor }` | `{ redirect: { slug } }`
- `msq_get_public_page_content` → `GET /api/public/pages/:slug/content?view&period`
- `msq_list_public_page_runs` → `GET /api/public/pages/:slug/runs?q&limit&offset`
- `msq_run_public_page` → `POST /api/public/pages/:slug/runs` (body `{ input }`) → 202 `{ runId }`
- `msq_get_public_page_run` → `GET /api/public/pages/:slug/runs/:runId`, waiting on
  `GET /api/public/pages/:slug/runs/:runId/stream` (SSE `{ type: 'run', status, ... }` frames, `[DONE]`)
  while the run is queued/running

### Core Collections

- `msq_list_core_collections` → `GET /v1/core/collections`
- `msq_search_core_collection` → `POST /v1/core/collections/:collectionName/search`
- `msq_get_core_collection_diagnostics` → `GET /v1/core/collections/:collectionName/diagnostics`
- `msq_recover_core_collection` → `POST /v1/core/collections/:collectionName/recover`

### Vector Stores

- `msq_list_vector_stores` → `GET /v1/vector_stores`
- `msq_create_vector_store` → `POST /v1/vector_stores`
- `msq_get_vector_store` → `GET /v1/vector_stores/:id`
- `msq_delete_vector_store` → `DELETE /v1/vector_stores/:id`
- `msq_list_vector_store_files` → `GET /v1/vector_stores/:id/files`
- `msq_add_vector_store_file` → `POST /v1/vector_stores/:id/files`
- `msq_get_vector_store_file` → `GET /v1/vector_stores/:id/files/:fileId`
- `msq_cancel_vector_store_session` → `POST /v1/vector_stores/cancel`

### Files

- `msq_list_files` → `GET /v1/files`
- `msq_upload_file` → `POST /v1/files` (multipart)
- `msq_get_file` → `GET /v1/files/:id`
- `msq_delete_file` → `DELETE /v1/files/:id`
- `msq_get_file_content` → `GET /v1/files/:id/content`

### Convenience

- `msq_list_user_collections` → `GET /v1/user-collections`
- `msq_get_vector_store_file_details` → `GET /v1/vector_stores/:id/file-details`

## 8. Type Safety and Schema Rules

- Use explicit Zod schemas for every tool.
- Use permissive `.passthrough()` only where MissionSquad docs explicitly indicate OpenAI-compatible extra fields (`chat/completions`, `embeddings`).
- Keep route IDs/path params outside request body where endpoint is path-based.
- Encode path segments with `encodeURIComponent`.
- Keep unknown response payload typed as `unknown` at client boundary and serialize as text.

## 9. Error Handling Strategy

`src/errors.ts` owns domain error classes and conversion to `UserError`.

Rules:

- Preserve HTTP status and response body context in `MsqApiError`.
- Convert all thrown errors in tool execution to `UserError` with tool-specific prefix.
- Do not expose sensitive headers or keys in thrown messages.

## 10. Server Entrypoint and Stdio Safety

`src/index.ts` responsibilities:

- Initialize `FastMCP<undefined>` with name/version
- Register all tools from `src/tools.ts`
- Start with stdio transport
- Handle `SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`

`src/stdio-safe-console.ts` must redirect stdout-emitting console methods to stderr.

## 11. Build, Test, and Publish Contract

### package.json

Required fields:

- `main: dist/index.js`
- `types: dist/index.d.ts`
- `bin.mcp-msq: ./dist/index.js`
- `engines.node: >=20.0.0`
- `publishConfig.access: public`
- `files` includes built artifacts and docs

Required scripts:

- `build`: clean + `tsc` + `chmod +x dist/index.js`
- `test`: `vitest run`
- `prepublishOnly`: test + build

### GitHub Actions

- `build.yaml`: runs on PR opened/synchronize, installs deps, builds, tests
- `publish.yaml`: runs on push to `main`, installs deps, builds, tests, publishes with `NPM_TOKEN`

## 12. Step-by-Step Implementation Checklist

1. Create scaffold files (`package.json`, `tsconfig.json`, `.env.example`, workflows).
2. Implement config resolver with hidden arg precedence and validation.
3. Implement typed HTTP client (JSON + multipart + bounded binary reads).
4. Implement Zod schemas for all in-scope endpoints.
5. Register tools with one tool per endpoint and deterministic JSON string returns.
6. Add stdio-safe console routing.
7. Add tests:
   - tool coverage list
   - config resolution behavior
8. Run `yarn install`.
9. Run `yarn build`.
10. Run `yarn test`.
11. Confirm generated `dist` files and executable entrypoint.
12. Finalize README with usage examples and hidden arg behavior.

## 13. Completion Audit

Implementation is complete only if all are true:

1. `MSQ_TOOL_NAMES` exactly matches implemented endpoint tool surface.
2. No tool schema exposes `apiKey` or `baseUrl`.
3. `createMissionSquadClient(context.extraArgs)` is used per execution.
4. `yarn build` passes.
5. `yarn test` passes.
6. CI workflows exist and reference Yarn build/test flow.
7. README and handbook describe the same tool surface and scope.
8. Webhooks are either fully specified and implemented, or explicitly documented as out-of-scope with missing prerequisites.

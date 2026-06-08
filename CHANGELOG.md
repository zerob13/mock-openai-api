# Changelog

## Unreleased

- Upgraded the server toward a deterministic three-provider protocol simulator for OpenAI-compatible, Anthropic-compatible, and Gemini-compatible agent harness development.
- Added offline contract tests and gated SDK smoke tests. SDK smoke tests run only with `RUN_SDK_TESTS=1`.
- Added shared mock infrastructure for scenarios, deterministic IDs, in-memory state, provider errors, SSE formatting, usage estimates, and fixtures.
- Added OpenAI Responses API, modern Chat Completions state endpoints, embeddings, image edits/variations, and files support.
- Added first-party Anthropic `/v1/messages`, token counting, streaming/tool/thinking scenarios, and Anthropic-shaped files support.
- Added Gemini GenerateContent function calling, structured output, multimodal/file references, code execution/search mocks, files, cached contents, and countTokens support.
- Added mock latency and stream chunk delay controls for client timing tests.
- Added provider fixture seed examples and CI coverage for install, test, build, and lint.
- Preserved legacy endpoints: `/models`, `/chat/completions`, `/images/generations`, `/anthropic/v1/models`, `/anthropic/v1/messages`, and `/gemini/v1/...` aliases.

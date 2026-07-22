# Record / Replay 模式实施设计

> 状态：已实现并进入验收
> 调研与实现日期：2026-07-21 ～ 2026-07-22
> 目标分支：`codex/record-replay-design`

## 0. 当前实现快照

当前分支已经落地三协议 raw record/replay、跨协议 scenario 编译、Vue 3 + Varlet 管理后台、原子运行时配置和 JSONL capture 管理。实际控制面如下：

```text
┌ Dashboard ─ Recordings ─ Replay ─ Scenario Editor ─ API Test ─ Settings ┐
│ mode: Built-in / Record / Replay     API :3000     Admin :3001          │
└──────────────────────────────────────────────────────────────────────────┘
```

实现中的强制约束：

- Record 模式只有一条 Node.js raw HTTP transport，不提供会解析或归一化事件的替代路径。
- 非 loopback Admin listener 必须配置 bearer token，否则进程拒绝启动。
- public upstream 默认执行 DNS 解析、private/special-use 地址拒绝和连接地址 pinning；本地 upstream 必须显式打开 `allowPrivateNetwork`。
- 同协议 raw replay 只有在协议、`stream`、`include_usage`、完整性和 timing 条件同时满足时启用；否则走语义转换或拒绝不兼容绑定。
- 当前是 single-process / single-writer 文件存储；不支持多个进程共享同一 data directory。

## 1. 先明确边界

“原封不动重放”和“跨协议转换”不是同一种能力，不能共用一条数据链路：

- **Raw Replay**：同协议重放，保存并重放 HTTP entity body 的原始字节、上游响应状态、响应头和代理观察到的每次读取时间。它追求应用层字节保真。
- **Transcoded Replay**：跨协议重放，把录制内容解析为版本化语义模型，再编码成目标协议。它只能在明确支持的语义子集内转换，必然可能有损。

同协议录制与透传使用 Node.js 低层 HTTP transport，避免任何 provider client 对请求、响应或流事件做解析和归一化。跨协议重放由项目自己的 scenario IR/compiler 完成。

本设计中的“原始 chunk”特指 Node.js 从 upstream response stream 观察到的 `proxy_read_chunk`。它不是 TCP packet、TLS record 或 HTTP/2 DATA frame。内核、Node.js、反向代理和客户端仍可能重新切分网络写入；可以承诺的是：

1. response body 拼接后的字节序列一致；
2. SSE framing、换行、空白和未知事件不被改写；
3. 按代理观察到的 chunk 顺序和时间计划调用下游 `write`；
4. 不承诺客户端最终收到相同的网络 packet 边界。

响应 status、status text 与 end-to-end header values 会被记录；但 Node.js 会重新序列化 header casing、order 和 HTTP framing，因此 `Body Exact` 只指 response entity body bytes。Timing 另以 `Recorded Timing` / `Timing Degraded` 标记；两者都不宣称整段 HTTP wire bytes 完全一致。

用户要求中的“API key 不用记录脱敏”在本文中解释为：**API key 不落盘，录制文件和日志中的敏感值统一替换为 `[REDACTED]`**。请求体、普通参数、响应体仍完整保存。

## 2. 目标与非目标

### 2.1 目标

一次实施完成以下能力：

1. 支持三类下游端点：
   - `POST /v1/chat/completions`
   - `POST /v1/responses`
   - `POST /v1/messages`
2. Record 模式下按协议把请求透传到可配置的 OpenAI Chat、OpenAI Responses 或 Anthropic-compatible upstream。
3. 默认透传客户端原来的鉴权头；客户端只需要把 `baseURL` 改为本服务地址。
4. 每个请求写入一个独立、可恢复、可校验的录制文件。
5. 完整记录 request/response body bytes、状态、headers、错误、取消和每个 chunk 的单调时钟时间点。
6. Replay 模式下按录制延迟同协议重放；支持即时和倍率播放。
7. 把可支持的文本、Markdown、tool call、usage 和结束原因转换为另外两种协议。
8. 默认以已有 mock 数据生成内置 scenario；服务启动后即可使用。
9. 同进程启动 API listener 和管理后台 listener；后台管理录制、重放绑定、upstream、运行模式和可视化 scenario。

### 2.2 非目标

首版不扩张以下范围：

- 不新增 Gemini 能力；现有 Gemini 路由仅保持兼容。
- 不承诺 TCP/TLS/HTTP2 frame 级录制。
- 不把所有 provider-specific 内容强行映射到所有协议。
- 不实现基于 prompt 相似度的自动模糊匹配。
- 不引入数据库、消息队列、DI container、repository hierarchy 或分布式锁。
- 不支持多进程同时写同一个 data directory；首版为 single process / single writer。
- 不把录制文件当作安全脱敏后的公开数据；prompt、tool output 和响应本身仍可能敏感。

## 3. 实施前仓库基线与必须先修的约束

实施前项目是 CommonJS + Express 4 + TypeScript 的单进程服务，主要 mock 实现集中在 `src/services/openaiService.ts` 与 `src/data/mockData.ts`。该基线对新能力有以下直接影响：

| 现状 | 影响 | 实施决策 |
| --- | --- | --- |
| `express.json()` 在所有路由前运行 | 原始 request bytes、空白和字段顺序已丢失 | gateway routes 必须在任何 body parser 之前挂载 |
| `src/index.ts` 与 `src/cli.ts` 重复启动逻辑 | 新增双 listener 后容易继续漂移 | 合并为一个 `src/server.ts` bootstrap |
| `global.verboseLogging` | legacy route 仍依赖全局开关 | 本次保留兼容开关，但日志只输出 method 与 path；mode/upstream/binding 使用独立 runtime state |
| SSE 通过同步 generator 连续写出 | 没有真实延迟、backpressure 和 abort | replay 使用 async scheduler 与 `drain` |
| tool-call stream 会在首个 `[DONE]` 后继续写第二段 stream | 标准 SDK 会在第一个 `[DONE]` 结束 | 迁移内置数据时移除该非标准行为 |
| 类型只覆盖旧 Chat 子集 | 无法透明支持未知字段 | raw gateway 不用封闭 request schema |
| 没有自动化测试 | 协议和字节保真无回归保护 | Phase 0 先建立 transport 和 golden tests |
| Docker 没有持久化目录 | 容器重建丢录制 | 显式挂载 `/data`，多阶段构建 web/server |
| API 默认 wildcard CORS | 不能直接复用为高权限控制面 | API 与 admin 使用独立 app、listener 和 CORS 策略 |

新的 gateway 接管 `/v1/chat/completions` 与无 `/v1` alias；三个 built-in scenarios 是为新编译器重建的 text、Markdown、tool-call 样例，并未逐条迁移旧 `mockData.ts`。旧 models、images、Gemini 等 route 继续由 legacy router 提供，图片路由不在本功能范围内。

## 4. 协议调研结论

所有 raw gateway 均允许未知 JSON 字段、未知响应字段和未知 SSE event；协议分类只根据入口 route，不根据封闭 schema 猜测。

### 4.1 OpenAI 通用行为

OpenAI 使用：

```http
Authorization: Bearer <key>
Content-Type: application/json
```

还可能包含 `OpenAI-Organization`、`OpenAI-Project` 和 `X-Client-Request-Id`。录制应保留经过脱敏的 ordered raw headers，并保留 `x-request-id`、rate-limit、`openai-processing-ms` 等响应头以便排障。

OpenAI 明确允许未来新增 optional request parameter、response property 和 streaming event type，因此 parser 只能用于派生展示和转换，不能成为 raw passthrough 的校验门。

官方参考：

- [API overview](https://developers.openai.com/api/reference/overview)
- [Error codes](https://developers.openai.com/api/docs/guides/error-codes)

### 4.2 OpenAI Chat Completions

端点：

```http
POST /v1/chat/completions
```

请求核心字段为 `model`、`messages` 和可选的 `stream`；还必须透传 `tools`、`tool_choice`、`parallel_tool_calls`、`response_format`、`stream_options` 及任何未来字段。

非流式响应为 `chat.completion`，主要内容位于 `choices[].message`。Function tool call 位于 `message.tool_calls[]`，其中 `function.arguments` 是 JSON 字符串，不是已解析对象。

流式响应是 data-only SSE：

```text
data: {"object":"chat.completion.chunk",...}

data: [DONE]

```

`choices[].delta` 可包含 `role`、`content`、`refusal` 和 `tool_calls`。流式 tool arguments 是字符串片段，必须按 `(choice.index, tool_call.index)` 聚合，不能逐 chunk 解析为完整 JSON。

当前 Chat non-stream schema 还允许 `tool_calls[].type: "custom"`，其 `custom.input` 是 opaque string；官方 streaming reference 尚未定义对应 custom-tool delta，首版不得自行发明 Chat custom-tool SSE。Deprecated `message.function_call`、`delta.function_call` 和 `finish_reason: "function_call"` 仍在官方 schema 中。Raw Capture/Replay 会完整保留这些字段；当前 Semantic decoder 只转换公共 function-tool 子集，对 legacy/custom 形态返回 unsupported，而不是伪造等价事件。模型生成的 function arguments 官方不保证一定是合法 JSON，raw capture 与公共 IR 都保留原始字符串或 fragments。

当 `stream_options.include_usage=true` 时，`[DONE]` 前可能出现一个 `choices: []` 的 usage chunk；流提前结束时该 chunk 可能不存在。EOF 发生在 `[DONE]` 前必须标记为 incomplete，不能自行补齐。

官方参考：

- [Create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Chat streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)

### 4.3 OpenAI Responses

端点：

```http
POST /v1/responses
```

请求的 `input` 可以是字符串或 item 数组；常见字段包括 `instructions`、`conversation`、`previous_response_id`、`tools`、`tool_choice`、`parallel_tool_calls`、`stream`、`background`、`store`、`reasoning` 和 `text`。

非流式响应是 `object: "response"`，文本与 tool call 都是 `output[]` item。Function call 示例结构是：

```json
{
  "type": "function_call",
  "id": "fc_...",
  "call_id": "call_...",
  "name": "get_weather",
  "arguments": "{\"city\":\"Shanghai\"}",
  "status": "completed"
}
```

Responses streaming 使用具名 SSE event，而不是 Chat 的 data-only stream：

```text
event: response.created
data: {"type":"response.created",...}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"...",...}

event: response.completed
data: {"type":"response.completed","response":{...}}

```

常见文本生命周期：

```text
response.created
response.in_progress
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.done
response.content_part.done
response.output_item.done
response.completed
```

Tool call 常见生命周期：

```text
response.output_item.added
response.function_call_arguments.delta
response.function_call_arguments.done
response.output_item.done
response.completed
```

Responses 还存在 `custom_tool_call` output item 及 `response.custom_tool_call_input.delta/done`。Function/custom call 是 output item graph，不能假定 tool call 一定位于最后一个 item。

Raw Capture/Replay 必须原样保留 `sequence_number`，以及 `response.refusal.*`、`response.failed`、`response.incomplete`、`response.queued`、`error`、message `phase`、annotations、logprobs 与未来字段/事件。当前 Semantic decoder 只接受支持矩阵中的公共 event/type；遇到不支持的形态会明确报错，尚未实现带 source JSON path 的 extension IR。Responses 没有 Chat 风格的 `[DONE]` 约定；结束依据 terminal event 和真实 EOF。

官方参考：

- [Create response](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Streaming responses guide](https://developers.openai.com/api/docs/guides/streaming-responses)

### 4.4 Anthropic Messages

端点：

```http
POST /v1/messages
```

典型 headers：

```http
x-api-key: <key>
anthropic-version: 2023-06-01
content-type: application/json
```

部分 Anthropic-compatible 服务使用 `Authorization: Bearer <token>`。Raw gateway 不猜测鉴权方案，而是透传全部 end-to-end headers。录制副本只脱敏 `x-api-key`、`Authorization`、cookie 等 credential；`anthropic-version` 和 `anthropic-beta` 必须原值保存。

请求核心字段是 `model`、`max_tokens`、`messages`；system prompt 位于顶层 `system`。非流式 Message 至少包含 `id`、`type`、`role`、`content`、`model`、`stop_reason`、`stop_sequence`、可选 `stop_details` 和 `usage`。Tool 定义使用 `input_schema`。模型返回的 tool call 是 `content[]` 中的 `tool_use` block；tool result 是下一条 `user` message 中的 `tool_result` block，不存在 OpenAI 的 `role: "tool"`。

Anthropic streaming 使用具名 SSE event：

```text
message_start
content_block_start
content_block_delta
content_block_stop
message_delta
message_stop
```

每个 content block 都有稳定 `index`，生命周期是 `content_block_start` → 0..n 个 `content_block_delta` → `content_block_stop`；例如 `fallback` block 可以没有 delta。之后是 1..n 个 `message_delta` 和一个 `message_stop`。`message_delta.usage` 是累计值，不是该 chunk 的增量。

`ping` 可以出现在任意位置；已经返回 HTTP 200 后仍可能发送形如 `{ "type": "error", "error": { "type": "...", "message": "..." } }` 的 `event: error`。Recorder 将 `message_stop` 视为正常 terminal，也将后续真实 EOF 前观察到的 `event: error` 视为错误 terminal；两者都区别于没有 terminal event 的截断流。`request_id` 仅在上游实际提供时保存，不能假定所有 stream error 都有。常见 delta 包括 `text_delta`、`input_json_delta`、`thinking_delta` 和 `signature_delta`。`input_json_delta.partial_json` 同样不能逐事件当作完整 JSON 解析。未知 event/field 在 Raw Capture/Replay 中原样保存。

当前 stop reasons 至少包括 `end_turn`、`max_tokens`、`stop_sequence`、`tool_use`、`pause_turn`、`refusal` 和 `model_context_window_exceeded`。其中 `pause_turn`、`refusal` 与 context-window exhaustion 不能静默归为普通 `stop`。Usage 的 cache 和 server-tool details 保存为 source-specific details。

官方参考：

- [Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication)
- [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- [Errors](https://platform.claude.com/docs/en/api/errors)
- [Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)

## 5. 总体架构

### 5.1 双 listener、三运行模式、两条数据链路

```text
                                     ┌──────────────────────────┐
Client SDK ── HTTP ──> API listener ─┤ Runtime snapshot         │
                                     │ builtin / record / replay│
                                     └────────────┬─────────────┘
                                                  │
               ┌──────────────────────────────────┼──────────────────────────┐
               │                                  │                          │
          builtin mode                       record mode                replay mode
               │                                  │                          │
               v                                  v                          v
      Built-in scenario compiler       Raw HTTP proxy + tee      Active replay binding
               │                         │              │          │              │
               │                         │              v          v              v
               │                         │       Capture JSONL  Raw scheduler  IR compiler
               │                         v                         │              │
               │                      Upstream                    │              │
               └──────────────────────────── target protocol encoder ────────────┘
                                                  │
                                                  v
                                               Client

Browser ── HTTP ──> Admin listener ──> Control API / static Vue app / file store
```

运行模式定义：

- `builtin`：默认模式。使用版本化 scenario，不需要 upstream。
- `record`：请求按入口协议透明代理到该协议的 active upstream，同时写 capture。
- `replay`：根据 `(protocol, endpoint, stream)` 的 active binding 重放 capture 或 scenario。

每个请求在收到 headers 时获取一次不可变 runtime snapshot。后台切换模式只影响后续请求，不改变 in-flight request。

API listener 默认 `0.0.0.0:3000`。Admin listener 默认 `127.0.0.1:3001`，与 API 同进程、同生命周期启动，但不是公开在同一控制面。所谓“启动对应 API 服务”在后台中实现为启用 endpoint 和切换 runtime，而不是反复 bind/unbind 端口。

### 5.2 Upstream 解析

每个协议独立配置 active upstream：

```ts
type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'

interface UpstreamConfig {
  protocol: Protocol
  baseUrl: string
  allowPrivateNetwork: boolean
}
```

默认 endpoint：

| Protocol | Full endpoint URL |
| --- | --- |
| `openai-chat` | `https://api.openai.com/v1/chat/completions` |
| `openai-responses` | `https://api.openai.com/v1/responses` |
| `anthropic-messages` | `https://api.anthropic.com/v1/messages` |

Gateway 接受 `baseUrl`，再按协议只追加一次 canonical endpoint。URL 必须通过 WHATWG URL parse，禁止 userinfo、query 和 fragment。

首版鉴权只有 `passthrough`：

- OpenAI 的 `Authorization` 原样发给 upstream；
- Anthropic 的 `x-api-key` 或 `Authorization` 及 version/beta headers 原样发给 upstream；
- 录制副本中对应值被替换为 `[REDACTED]`。

后台不能选择任意环境变量并把值发送到任意 URL。若后续需要 server-owned credentials，只能增加启动时声明的 allowlisted credential reference，不能接受自由 `envName`。

## 6. Raw proxy 与 recorder

### 6.1 请求链路

Gateway route 必须先于 `express.json()`：

```text
incoming request
  -> classify by route
  -> snapshot runtime
  -> sanitize metadata copy
  -> open <capture-id>.llmcap.jsonl.partial
  -> create http/https upstream request
  -> record sanitized final upstream method/url/headers
  -> tee each incoming request byte chunk
       -> upstream request
       -> ordered capture writer
  -> copy upstream status/headers
  -> tee each upstream response byte chunk
       -> downstream response
       -> ordered capture writer
  -> record downstream-visible status/headers/body/trailers
  -> terminal record
  -> fsync/close/atomic rename
```

使用 Node.js `http.request` / `https.request`，不使用会自动解析或自动解压响应的 SDK。这样可以保留 compressed entity bytes，并避免把已解压 body 与原 `content-encoding` 错误组合。

标准 hop-by-hop headers 不进行端到端透传：

```text
connection
keep-alive
proxy-authenticate
proxy-authorization
te
trailer
transfer-encoding
upgrade
```

此外必须解析每次请求/响应的 `Connection` header，并移除它动态列出的任意 header name；只用固定列表不完整。Capture 仍保存经过脱敏的 incoming/upstream raw header snapshots，真正 forward/replay 时重新执行 hop-by-hop filtering。

`host` 根据 upstream 重写。`content-length` 仅在 request bytes 未改变时保留；重放响应时由 Node.js 决定 framing，不能同时盲目恢复原 `content-length` 与 `transfer-encoding`。

`upstream.request.head` 保存实际发给 upstream 的 method、full URL 和经过 Host 重写、hop-by-hop filtering 后的 sanitized headers；`upstream.request.end` 保存实际 forwarded body hash。这样 downstream request 与 upstream request 的差异可审计。

### 6.2 计时模型

使用两个时钟：

- `createdAt`：ISO 8601 wall clock，供人类浏览和文件排序；
- `process.hrtime.bigint()`：单调时钟，所有事件保存为相对 `atUs` 整数。

起点为 gateway 收到 downstream request headers。至少记录：

```text
request_headers_at
request_first_byte_at
request_end_at
upstream_dispatched_at
response_headers_at
response_first_byte_at
each_response_chunk_at
downstream_disconnect_at
upstream_end_at
capture_closed_at
```

派生指标：

```text
request_upload_us
dns_lookup_us
tcp_connect_us
tls_handshake_us
upstream_ttfb_us
first_body_byte_us
total_upstream_us
total_gateway_us
```

`socket`、`lookup`、`connect` 和 `secureConnect` 事件存在时写入 `upstream.network` records；连接复用时记录 `reusedSocket: true`，不伪造不存在的 DNS/TCP/TLS 分段时间。

Replay scheduler 以收到新 request headers 为时间原点，并发 drain incoming body。Response head/chunks 使用相对 `request_headers_at` 的 absolute offsets；选择 binding 或解析 body 完成时若目标时间已经过去，立即写出并记录 lateness。对于 upstream 在 request body 结束前就拒绝请求的 capture，首版无法在依赖 body 中 `stream` 字段选择 binding 的同时复现负 upload overlap，必须标记 `timingReplayable: false`，UI 显示 timing degraded，而不能伪造一个正 delay。

`response.body_chunk.atUs` 表示调用 downstream `write()` 的时间，另存 `upstreamObservedAtUs` 表示从 upstream readable 观察到该 chunk 的时间。Replay 使用 downstream write schedule；两者不能在背压场景中混为同一延迟。

### 6.3 背压、失败与取消

- 对 downstream `res.write()` 返回 `false` 时等待 `drain`，不丢 chunk、不重排。
- 对 upstream request `write()` 返回 `false` 时暂停 incoming request，等待 upstream `drain` 后继续，防止大 request body 堆积在内存。
- recorder 使用单文件 ordered write queue；request/response 循环等待本次落盘与 network drain 后才读取下一块，因此当前实现没有独立的积压阈值。
- recorder 创建或写入失败会中止本次代理；若尚未发 response 则返回协议外形的 `502`，否则关闭连接并保留可检查的 `.partial`。当前没有 fail-open 开关。
- upstream 在 headers 前失败：返回目标协议外形的 `502`，同时记录 failure 和完整的 downstream-visible `response.head/body/end`，其中 `source: "gateway"`。
- upstream 在 headers 后失败：关闭 downstream，不注入伪造 JSON 或 terminal SSE event。
- downstream 断开：abort upstream 并记录 `client_cancelled`；当前不在客户端离开后继续采样。
- 收到进程终止信号时停止接新请求，给 recorder 一个有界 flush window，未完成文件保留 `.partial`。

`upstream.response.head/trailers/end` 保存经过脱敏但尚未 hop-by-hop filtering 的 upstream status/raw header snapshots；`response.*` 永远表示客户端可见的 gateway response，`source` 为 `upstream` 或 `gateway`。Response body 在 raw path 中共用一份 `response.body_chunk` bytes，并以 `upstreamObservedAtUs` 关联 upstream read，避免无意义地双份 base64。Transport failure 可能没有 `upstream.response.head`，但只要 gateway 已向仍连接的客户端返回错误，就必须存在 `response.head/body/end`。同时记录 `downstreamBytesWritten`；它表示交给 Node response 的 bytes，不冒充客户端已经从网络读取的 bytes。

## 7. Capture 文件格式

### 7.1 为什么使用 JSONL

每个请求对应一个 `.llmcap.jsonl`：

- 流式追加，不把完整响应留在内存；
- 崩溃时已写数据仍可恢复；
- 每行可独立校验和展示；
- base64 保存任意 bytes，包括跨 UTF-8 边界的 chunk；
- schema 可通过 record `kind` 向后兼容扩展。

写入流程：

```text
<filename>.llmcap.jsonl.partial
  -> append records
  -> append capture.end
  -> flush + close
  -> atomic rename to <filename>.llmcap.jsonl
```

建议文件名：

```text
20260721T143052.183Z_openai-chat_cap_01J....llmcap.jsonl
```

文件名只用于排序和人工识别；真实标识来自首行 `id`。

### 7.2 Schema v1

示例只展示结构；实际 bytes 以 base64 保存：

```jsonl
{"kind":"capture","schema":"mock-openai-api.capture","schemaVersion":1,"id":"cap_01J...","createdAt":"2026-07-21T14:30:52.183Z","protocol":"openai-chat","source":"record","downstreamUrl":"http://127.0.0.1:3000/v1/chat/completions","upstreamUrl":"https://api.openai.com/v1/chat/completions","redactions":["request.headers.authorization"]}
{"kind":"request.head","atUs":0,"method":"POST","httpVersion":"1.1","rawHeaders":[["Host","127.0.0.1:3000"],["Authorization","[REDACTED]"],["Content-Type","application/json"]]}
{"kind":"request.body_chunk","seq":0,"atUs":411,"byteOffset":0,"bytesBase64":"eyJtb2RlbCI6Im..."}
{"kind":"request.end","atUs":612,"bytes":128,"sha256":"..."}
{"kind":"upstream.request.head","atUs":719,"method":"POST","url":"https://api.openai.com/v1/chat/completions","rawHeaders":[["Host","api.openai.com"],["Authorization","[REDACTED]"]]}
{"kind":"upstream.request.end","atUs":901,"bytes":128,"sha256":"..."}
{"kind":"upstream.response.head","atUs":95190,"status":200,"statusText":"OK","httpVersion":"1.1","rawHeaders":[["content-type","text/event-stream"],["connection","keep-alive"],["x-request-id","req_..."]]}
{"kind":"response.head","source":"upstream","atUs":95211,"status":200,"statusText":"OK","httpVersion":"1.1","rawHeaders":[["content-type","text/event-stream"],["x-request-id","req_..."]]}
{"kind":"response.body_chunk","seq":0,"upstreamObservedAtUs":98310,"atUs":98344,"byteOffset":0,"bytesBase64":"ZGF0YTogeyJpZCI6..."}
{"kind":"response.body_chunk","seq":1,"upstreamObservedAtUs":121850,"atUs":121880,"byteOffset":231,"bytesBase64":"ZGF0YTogW0RPTkVdCgo="}
{"kind":"response.end","atUs":122013,"bytes":250,"sha256":"...","eofObserved":true,"terminalMarker":{"kind":"openai-chat-done","observed":true}}
{"kind":"capture.end","atUs":122481,"outcome":"complete","requestBodyExact":true,"requestHeadersSanitized":true,"responseBodyExact":true,"timingReplayable":true,"downstreamBytesWritten":250}
```

Record union：

```ts
type CaptureRecord =
  | CaptureHeader
  | RequestHead
  | RequestBodyChunk
  | RequestTrailers
  | RequestEnd
  | UpstreamRequestHead
  | UpstreamNetwork
  | UpstreamRequestEnd
  | UpstreamResponseHead
  | UpstreamResponseTrailers
  | UpstreamResponseEnd
  | ResponseHead
  | ResponseBodyChunk
  | ResponseTrailers
  | ResponseEnd
  | ClientDisconnect
  | Failure
  | CaptureEnd
```

终态 `outcome`：

```text
complete
upstream_error
aborted
client_cancelled
timeout
recording_error
capture_truncated
```

每个完整文件至少包含 `capture`、`request.head`、`request.end` 和 `capture.end`。没有拿到 upstream response 时可以没有 upstream response metadata；但只要 gateway 向客户端写了自己的 400/502，就仍必须保存 `source: "gateway"` 的 `response.*`。客户端在任何 response 前断开时可以没有 `response.head`。`.partial` 可以缺失 terminal record，loader 必须将其视为 recoverable incomplete capture，而不是格式错误。

### 7.3 完整性与脱敏

分别计算 request body 和 response body 的 SHA-256。Raw replay 完成后在测试和后台显示：

```text
recorded response sha256 == replayed response sha256
```

脱敏至少覆盖大小写不敏感的：

```text
authorization
proxy-authorization
x-api-key
api-key
cookie
set-cookie
```

URL 还要移除 userinfo，并替换 query 中的：

```text
key
api_key
access_token
token
```

三类目标 API 的 key 都在 headers 中，因此 request body 默认可字节级保真。若用户配置 `sensitiveBodyPaths` 对 body 做结构化脱敏，文件必须标记 `requestBodyExact: false`；不能同时宣称 request body 原样录制。

Recorder 还要维护当前请求的 in-memory `SecretSet`。Body bytes 在写入 `.partial` 前先经过带有限 look-ahead 的跨 chunk byte scanner；raw bytes 仍原样透传。未命中 credential 时，scanner 延迟至足以排除跨边界匹配后，按原 bytes、边界、时间戳和 upstream observation 原样写出每个 proxy-read chunk；一旦命中才对录制副本替换 credential，并允许安全重分块，同时把对应 body exact flag 标记为 `false`、禁用 Raw Body Exact。不能先把 key 写入 `.partial`，再指望 final rename 前补救。

错误对象和日志中的 URL 也必须经过同一 sanitizer，不能把含 credentials 的 exception message 或 stack 原样落盘。

### 7.4 Raw 与 derived 的关系

Capture 只保存 raw source of truth，不把 parser 输出混进同一不可变文件。后台按需派生：

- request JSON；
- SSE event；
- SSE event 及其完成时间；
- protocol summary；
- conversion diagnostics。

一个 SSE event 可能跨多个 raw chunk，一个 raw chunk 也可能包含多个 SSE event。派生 parser 必须处理 `LF`、`CRLF`、多行 `data:`、comment、空行、半个 UTF-8 code point 和未知 field。事件时间取完成该事件最后一个 byte 所在 raw chunk 的 `atUs`。

派生数据只缓存于内存或重建索引，绝不覆盖原 capture。用户选择“Save as scenario”时才生成新的 editable `.scenario.json`。

转换器会在首个文本 delta 与 terminal 事件处补齐 `text.start` / `text.end`，并分配稳定的 `textId`；这是可视化编辑所需的派生生命周期，不会回写或冒充原始 SSE 事件。

## 8. Scenario 文件与可视化编辑

### 8.1 独立的可编辑格式

Capture 是不可变事实，Scenario 是可编辑模拟。每个 scenario 仍是一个独立文件：

```text
<scenario-id>.scenario.json
```

Schema v1：

```json
{
  "schema": "mock-openai-api.scenario",
  "kind": "scenario",
  "schemaVersion": 1,
  "id": "scn_tool_weather",
  "title": "Weather tool call",
  "description": "A portable tool-call example",
  "source": {
    "kind": "capture",
    "captureId": "cap_01J...",
    "protocol": "openai-chat"
  },
  "match": {
    "protocols": ["openai-chat", "openai-responses", "anthropic-messages"],
    "stream": true
  },
  "response": {
    "status": 200,
    "headers": { "cache-control": "no-cache" }
  },
  "timeline": [
    { "type": "message.start", "atUs": 0, "messageId": "msg_1", "role": "assistant" },
    { "type": "tool.start", "atUs": 12000, "toolCallId": "call_1", "name": "get_weather" },
    { "type": "tool.arguments.delta", "atUs": 26000, "toolCallId": "call_1", "delta": "{\"city\":" },
    { "type": "tool.arguments.delta", "atUs": 41000, "toolCallId": "call_1", "delta": "\"Shanghai\"}" },
    { "type": "tool.end", "atUs": 43000, "toolCallId": "call_1" },
    { "type": "finish", "atUs": 45000, "reason": "tool" },
    { "type": "usage", "atUs": 47000, "inputTokens": 12, "outputTokens": 9, "totalTokens": 21 }
  ]
}
```

Timeline event 首版支持：

```text
message.start
text.start
text.delta
text.end
tool.start
tool.arguments.delta
tool.end
usage
finish
error
ping
```

Markdown 在线路协议里仍是普通文本；编辑器用 `format: "markdown"` 提供预览提示，不制造不存在的协议类型。

首版 Scenario IR 只覆盖上述公共子集。Reasoning、custom tool、provider-specific extension、引用和多模态内容不会伪装成已完成的跨协议转换；需要保留这些内容时只能使用同协议 Raw Replay。完整 extension IR 与可配置 loss policy 留作后续。

`usage` 是 aggregate metadata event，不等于目标 SSE 中可任意插入的 frame。Compiler 必须按目标协议定位：Chat 先输出带 `finish_reason` 的 final choice chunk，再在请求 `stream_options.include_usage=true` 时输出 `choices: []` usage chunk，最后输出 `[DONE]`；Responses 把 usage 放进 terminal response object；Anthropic 按 message lifecycle 生成 cumulative usage。`finish` 表示模型语义结束，不表示 transport 已经 EOF。

### 8.2 ID 与时间确定性

- scenario 内稳定保存 logical IDs。
- 每次 replay invocation 以 `(scenarioId, invocationId, logicalId)` 生成目标协议 ID；同一流中的 start/delta/end 必须一致。
- `created` / `created_at` 默认在 invocation 开始时生成；可在 scenario 中固定以实现 snapshot test。
- timeline `atUs` 必须单调不减；编辑器阻止负数和乱序保存。
- 非流式编译器聚合完整 timeline 后一次返回；流式编译器按 timeline 输出 target SSE。

## 9. Replay 引擎

### 9.1 选择规则

用户要求“发送任意信息获得重放结果”，因此默认不做 prompt 匹配。后台维护 active binding：

```ts
interface ReplayBinding {
  protocol: Protocol
  endpoint: string
  stream: boolean
  source: { kind: 'capture' | 'scenario'; id: string }
  mode: 'body-exact' | 'transcoded'
  speed: 'instant' | number
}
```

键为 `(protocol, endpoint, stream)`。请求 body 中的 `stream` 和 `stream_options` 不影响 active source 选择，但会影响 replay eligibility/output：Scenario compiler 必须处理 Chat 的 `include_usage/include_obfuscation` 与 Responses 的 `include_obfuscation`；Body Exact capture 则比较录制请求与当前请求的 effective stream-control fingerprint，不一致时返回 `409 replay_options_mismatch`，绝不改写录制 bytes 后继续显示 Body Exact。其他内容默认不影响 active source 选择。后续可以增加显式策略，但不进入首版核心：

- exact request fingerprint；
- model + explicit tag；
- deterministic playlist。

不增加 embedding、相似度或随机 matcher。

### 9.2 Raw Replay

只有以下条件全部满足才显示 `Body Exact`：

1. source 是 `outcome: "complete"` 的完整 capture；
2. source protocol 与 target protocol 一致；
3. request 的 stream 形态与 capture 一致；
4. effective `stream_options` fingerprint 与 capture 一致；
5. response body 未被编辑或转换；
6. capture 没有 `capture_truncated` / `recording_error`；
7. `downstreamBytesWritten` 与 `response.end.bytes` 一致，且没有提前 client disconnect；
8. status、end-to-end header values、trailers 和 recorded termination semantics 都能在当前 HTTP runtime 重现。

流程：

```text
read response.head
  -> wait recorded request-header-to-response-head offset / playback rate
  -> write status + validated end-to-end headers
for each response.body_chunk
  -> wait absolute target time
  -> write original bytes
  -> respect drain and abort
finish exactly as recorded
```

完整且 body 未改变时可校验后恢复 `content-length`；partial/transcoded response 必须移除并重新计算。存在 response trailers 时在 body 完成后、`end()` 前使用目标 HTTP 版本支持的 trailer API；无法保持其语义时取消 `Body Exact` 资格。

使用 absolute deadline，避免每次相对 `setTimeout` 累积 drift：

```text
target = replayOrigin + recordedOffset / playbackRate
```

如果 scheduler 已迟到，立即写出但不重排。`instant` 跳过全部等待。首版倍率范围 `0.1` 到 `10`；实际 lateness 作为运行指标显示，不改写 capture。

完成流的 EOF、未完成流的 abrupt close 和 headers 后 error 应按 capture outcome 重现。不能为不完整 Chat 自动补 `[DONE]`，也不能为 Responses 或 Anthropic 自动补 terminal event。

### 9.3 Scenario / Transcoded Replay

Scenario 根据目标 route 编译为：

- OpenAI Chat JSON 或 data-only SSE + `[DONE]`；
- OpenAI Responses JSON 或 named SSE terminal lifecycle；
- Anthropic Message JSON 或 named SSE content-block lifecycle。

Raw capture 要跨协议时必须先解析为 IR。UI 展示转换报告，用户确认后保存 scenario；服务也可临时编译，但响应 header 要带：

```http
X-Mock-Replay-Mode: transcoded
X-Mock-Replay-Source: cap_...
```

同协议 raw replay 不添加这些 headers，避免破坏 response headers fidelity；对应信息只进入服务日志和后台活动视图。

### 9.4 Stream 与 non-stream

- Raw capture 不能在 stream/non-stream 之间伪装；没有对应 active binding 时返回 `409 replay_binding_mismatch`。
- Scenario 可以从同一 timeline 编译为 stream 或 non-stream。
- Record mode 不解析后重写 `stream`，而是原样代理。
- Replay/Builtin mode 做宽松 JSON parse 读取 `stream` 与上述 `stream_options`；无效 JSON 返回协议对应的 `400`。未知字段不参与 binding，但 parser/diagnostics 不得把它们误报为已经模拟。

## 10. 跨协议语义映射

### 10.1 首版支持矩阵

| Capability | Chat | Responses | Anthropic | 跨协议策略 |
| --- | --- | --- | --- | --- |
| Plain text / Markdown | `message.content` / `delta.content` | `output_text` / `response.output_text.delta` | `text` / `text_delta` | 支持 |
| Client function call | `tool_calls[]` | `function_call` item | `tool_use` block | 支持核心字段 |
| Tool arguments fragments | opaque string fragments | opaque string fragments | `partial_json` | 保留片段时间；Anthropic target 要求最终为 JSON object |
| Finish reason | `finish_reason` | response status/incomplete details | `stop_reason` | 映射公共 `stop/length/tool/content_filter/error/other` |
| Basic usage | prompt/completion/total | input/output/total | input/output | 支持基础计数 |
| Error before stream | HTTP + provider body | HTTP + provider body | HTTP + provider body | 映射 status/category，非字节等价 |
| Error during stream | provider error chunk/EOF | `error`/failed/incomplete | `event:error` | 编译为目标 error lifecycle；Raw Replay 保留原字节 |
| Ping | 无标准对应 | 无标准对应 | `event: ping` | Anthropic 输出 ping；其他目标忽略该编辑器提示事件 |
| Reasoning/custom tool/citations/multimodal/server tools | provider-specific | typed items/events | typed blocks | 首版不做跨协议保证；同协议 Raw Replay only |
| Multiple choices与完整 provider usage details | `n > 1` / details | output graph / details | block graph / cache details | 首版不做跨协议保证 |

### 10.2 规范化字段

Finish reason：

```ts
type FinishReason =
  | 'stop'
  | 'length'
  | 'tool'
  | 'content_filter'
  | 'error'
  | 'other'
```

`finish` 事件可保存可选 `sourceValue`，解析 capture 时保留已识别的原 stop value。例如：

```text
Chat tool_calls       -> tool
Chat legacy function_call -> tool with legacy source value
Anthropic tool_use    -> tool
Responses failed/error -> error path
Responses incomplete/max_output_tokens -> length
Responses incomplete/content_filter -> content_filter
Responses incomplete/other -> other with required diagnostic
Responses completed + any client function_call item -> tool
Responses completed otherwise -> stop
Chat length           -> length
Anthropic end_turn/stop_sequence -> stop with source value/sequence
Anthropic max_tokens  -> length
Anthropic model_context_window_exceeded -> length with source value
Anthropic pause_turn/refusal -> other
```

Usage 仅规范化 `inputTokens`、`outputTokens`、`totalTokens`。当前 IR 不保存 cache、reasoning、accepted/rejected prediction 等 provider details，因此这些内容只能依靠原 capture 的 Raw Replay 保真，不能声称已经转换。

Function arguments 在 IR 中始终是 opaque string fragments。编译到 Anthropic `tool_use.input` 时才拼接并验证 JSON object；Chat 与 Responses 继续输出 arguments string。当前 decoder 对不支持的 event type 返回明确错误，但不会为每个未消费字段建立 extension 节点。

### 10.3 转换策略

当前只有一条“公共子集”转换路径，没有可配置的 `strict` / `best-effort` 开关：

- 可识别的 text、function tool、基础 usage、finish、error 与 ping 编译到目标协议；
- 不支持的顶层 event/type 在 capture → scenario 时返回错误；
- UI 对所有跨协议 capture 固定显示 `Semantic / Transcoded` 与通用损失提示，不显示 `Body Exact`；
- 未读取的 provider-specific 字段当前不会形成逐 JSON path diagnostics，因此不能声称完整保留或精确报告；
- reasoning、signature 或安全 metadata 绝不由转换器捏造。

完整 extension IR、逐字段 conversion report 和双 loss policy 是明确的后续项，不属于本分支已实现能力。

## 11. 文件存储与目录管理

默认结构：

```text
<data-dir>/
├── captures/
│   ├── *.llmcap.jsonl
│   └── *.llmcap.jsonl.partial
├── scenarios/
│   └── *.scenario.json
├── trash/
└── runtime.json
```

- `data-dir` 由 CLI/env 在启动时指定；后台不提供任意服务器文件系统浏览器。
- loader 只在该 root 内操作，拒绝 `..`、绝对路径、NUL、symlink target 和非法 ID。
- 文件权限默认目录 `0700`、文件 `0600`；不依赖 umask 猜测。
- 首版用 `fs.readdir` + 顺序流式 summary 扫描，不增加 SQLite 或持久化 index。
- 外部复制文件后可在 UI 手动 Refresh。
- 删除先原子移动到 `trash/`；首版不提供永久清理和 restore API。
- import 使用带 64 MiB 硬上限的 raw `application/octet-stream`/JSON body，不引入 multipart parser；内存校验、写入唯一 `.partial`、复核 schema/hash 后再用同目录 hard-link 原子发布 final file，并清理临时链接。
- `.partial` 默认不参与 active replay，但可在后台查看或移入 trash。
- `runtime.json` 只保存 mode、active bindings、非敏感 upstream 配置和 revision；所有写入使用 temp + atomic rename。

## 12. Admin Control API

当前统一前缀：

```text
/admin/api
```

### 12.1 Runtime

```text
GET   /runtime
PATCH /runtime
```

`GET /runtime` 返回 mode、revision、enabled endpoints、active requests、data dir 状态和不含 secret 的 upstream summary。`PATCH` 必须携带当前 revision，避免多个 tab 静默覆盖。Dashboard 以低频 polling 更新，首版不再增加一套 admin activity SSE。

### 12.2 Upstream checks

```text
POST /upstreams/check
```

`check` 只做 URL/DNS/TLS/HTTP reachability check，不携带 API key，也不发送模型请求。后台不得自动探测 upstream；必须由用户点击触发。

### 12.3 Captures

```text
GET    /captures
GET    /captures/:id
POST   /captures/import
POST   /captures/:id/to-scenario
DELETE /captures/:id          # move to trash
```

List 使用轻量顺序扫描，不 materialize response body。Detail 返回 request/response/body/timeline/records，单次 materialization 上限为 64 MiB；首版没有 records cursor、download 和 restore。

### 12.4 Scenarios

```text
GET    /scenarios
GET    /scenarios/:id
PUT    /scenarios/:id
POST   /scenarios/preview/:protocol
DELETE /scenarios/:id
```

Preview 返回 target headers、non-stream JSON 或带时间点的 SSE frames，不真正占用 API binding。

### 12.5 Replay bindings

```text
GET /bindings
PUT /bindings
```

保存前校验 body-exact/transcoded 条件、source 完整性和 conversion diagnostics。

### 12.6 Request tester

测试台由浏览器直接 `fetch` API listener，而不是把 key 交给 Admin Control API：

```text
Browser -> API listener -> selected runtime path
```

这样 key 只存在于当前浏览器内存和真实 API request headers。为兼容独立端口的 SDK 与测试台，API listener 当前返回 wildcard CORS；它不使用 cookie 鉴权。测试台卸载或发送后清空未勾选“Keep in memory”的 key。页面、Pinia、LocalStorage 和 URL 都不保存 key。

## 13. Web 后台设计

### 13.1 技术栈

单一根 `package.json`，避免为 web 再建 workspace：

```text
Vue 3 + TypeScript
Vite
Vue Router
Pinia
Varlet UI
```

Pinia 首版只保留一个跨页面 store：

- `runtimeStore`：mode、revision、active request、binding summary；

录制列表、筛选、详情和 scenario draft 留在各 view 的 local state；不建立通用 CRUD/editor store。Editor 使用 route-leave guard 阻止未保存离开。Runtime 状态被顶部 mode switch、Dashboard、Replay 和 Settings 同时消费，因此保留一个 Pinia store 有实际收益。

Varlet 按[官方 Quickstart](https://varletjs.org/#/zh-CN/quickstart)接入，并只注册当前使用的组件：

```ts
import { createApp } from 'vue'
import { Button, Loading } from '@varlet/ui'
import '@varlet/ui/es/button/style'
import '@varlet/ui/es/loading/style'
import App from './App.vue'

createApp(App)
  .component(Button.name, Button)
  .component(Loading.name, Loading)
  .mount('#app')
```

Varlet 偏 mobile-first，首版桌面布局使用固定 CSS grid，不增加 resizable-pane dependency；dense table、keyboard focus 和 hover state 使用 native semantic elements 补足，不把 mobile card 直接拉宽冒充桌面界面。

### 13.2 信息架构

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Mock OpenAI API   Mode [Builtin ▾]   API ● :3000   Admin ● :3001        │
├───────────────────┬──────────────────────────────────────────────────────┤
│ Dashboard         │ Runtime                                              │
│ Recordings        │ ┌────────────┬────────────┬────────────┐             │
│ Replay            │ │ Requests 3 │ Captures 8 │ Errors 0   │             │
│ Scenario Editor   │ └────────────┴────────────┴────────────┘             │
│ Settings          │                                                      │
│                   │ Endpoint                    Binding          Status   │
│                   │ /v1/chat/completions        Built-in text    Ready    │
│                   │ /v1/responses               Tool scenario    Ready    │
│                   │ /v1/messages                Anthropic demo   Ready    │
│                   │                                                      │
│                   │ Recent activity                                      │
├───────────────────┴──────────────────────────────────────────────────────┤
│ Data /.../recordings   body-exact 2   transcoded 1   partial 0           │
└──────────────────────────────────────────────────────────────────────────┘
```

顶部 mode switch 是高风险操作：显示目标模式、影响范围和 active upstream；确认后原子提交 revision。Record 模式若某个 protocol 没有 upstream，则该 endpoint 显示 Disabled，不把请求误送到其他 provider。

### 13.3 Recordings 页面

左侧或顶部筛选：

```text
Protocol | Outcome | Stream | Date | Body Exact/Partial | Search
```

详情 tabs：

```text
Summary | Request | Response | Parsed | Timeline | Raw
```

Summary 展示 protocol、downstream/upstream URL、status、TTFB、total、bytes、hash 和 redactions。详情提供：

- Timeline：raw records 的 seq、gateway `atUs`、`upstreamObservedAtUs` 和 size；
- Parsed：non-stream JSON 或通用 SSE event/data 解析视图；
- Raw：完整 Admin detail payload。

Parsed 与 raw chunk 时间分开显示；当前没有计算“每个 SSE event 由哪些 chunk 贡献”的反向索引。

列表只读取轻量 summary；打开详情后按需 decode request/response/timeline，超过 64 MiB materialization 上限时返回明确错误。用户可以 Import、Save as Scenario、Bind to Replay、Move to Trash；Download、分页 raw 和 Restore 留作后续。

### 13.4 Replay 页面

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Target [OpenAI Responses ▾]  Stream [On]  Speed [1.0x]                  │
├──────────────────────────────────┬───────────────────────────────────────┤
│ Source                           │ Compatibility                          │
│ ( ) cap_... OpenAI Responses     │ Body Exact · Recorded Timing          │
│ (●) scn_weather Tool call        │ Transcoded                            │
│                                  │ ✓ text  ✓ tool call  ✓ usage           │
│                                  │ ! source stop reason normalized        │
├──────────────────────────────────┴───────────────────────────────────────┤
│ Endpoint: http://127.0.0.1:3000/v1/responses           [Copy] [Test]    │
│ [Activate binding]                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

同协议完整 capture 默认选择 Body Exact；跨协议时必须显示 conversion report。用户不能在有 warning 时误认为 raw replay。

### 13.5 Scenario Editor

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Scenario: Weather tool call *   Target [Anthropic ▾] [Preview] [Save]   │
├───────────────┬──────────────────────────────────┬───────────────────────┤
│ Add block     │ Timeline                         │ Properties             │
│ + Text        │ 0 ms    Message start            │ Type: Tool arguments   │
│ + Markdown    │ 12 ms   Tool start               │ Call ID [call_1      ] │
│ + Tool call   │ 26 ms   Arguments {"city":      │ Delta ["Shanghai"}]   │
│ + Usage       │ 41 ms   Arguments "Shanghai"}   │ Time [41000] µs       │
│ + Finish      │ 45 ms   Finish: tool             │ [Delete]               │
│ + Error       │ 47 ms   Usage                    │                        │
│ + Ping        │                                  │                        │
├───────────────┴──────────────────────────────────┴───────────────────────┤
│ Preview [Chat] [Responses] [Anthropic]                                  │
│ event: content_block_delta                                               │
│ data: {"type":"content_block_delta",...}                             │
└──────────────────────────────────────────────────────────────────────────┘
```

实现细节：

- 不引入 Monaco；JSON arguments 和 Markdown 使用 Varlet input/原生 textarea + schema validation + preview。
- 重排同时提供 pointer drag 与 keyboard Move up/down，不能只支持拖拽。
- Tool arguments 以 opaque string/fragments 保存；只有编译 Anthropic target 时服务端 preview/compiler 要求最终 JSON object。编辑器本地不会把 fragments 强制解析成 JSON。
- Text/Markdown 由 palette 生成可编辑的 start/delta/end block，用户可继续增加 delta 并手动调整 `atUs`。
- 三协议 preview 调用服务端 `/preview/:protocol`，服务端 compiler 是唯一事实来源；浏览器不再打包第二份协议 compiler。
- 保存前校验 logical ID 引用、timeline 单调性和 finish 唯一性；target compatibility 由三协议 Preview 调用服务端 compiler 验证。

### 13.6 Settings 与测试台

Settings：

- 三类 upstream cards；
- 每个协议只配置 provider base URL 和 private-network policy；
- 提示客户端鉴权头会原样透传，capture 副本会脱敏；
- private network policy；
- data dir 只读展示与 endpoint enable/disable；
- admin token 内存输入。

Request tester：

- protocol preset；
- model、stream、headers、raw JSON body；
- key masked input，仅内存；
- response status/headers；
- raw chunk timeline 与 parsed event；
- curl、OpenAI SDK、Anthropic SDK 示例片段。

小屏使用单列布局；桌面使用上述三栏布局。关键操作支持键盘、明显 focus ring、loading/error/empty state 和 dark/light theme。主题由根节点 data attribute 与统一 CSS variables 切换。

## 14. 安全设计

### 14.1 Admin 控制面

- Admin 默认只监听 loopback。
- 若 `ADMIN_HOST` 不是 loopback 且未配置 `ADMIN_TOKEN`，启动直接失败。
- Admin token 使用 `Authorization: Bearer`；不使用 cookie，避免额外 CSRF 状态。
- 远程 admin 首次打开时 UI 只在 memory 中接收 token；不写 URL、LocalStorage、Pinia 或 runtime file。Static assets 可以加载，所有 Control API 仍要求 token。
- Admin CORS 默认同源；API listener 为 SDK/tester 兼容启用 wildcard CORS，且不使用 cookie 鉴权。
- Docker image 默认让 Admin 只监听容器 loopback；发布 admin port 时必须显式设置非 loopback host 和 token。

### 14.2 SSRF

“任意 upstream”本身就是 SSRF 能力，必须局限在 admin：

- 只允许 `http:` / `https:`；
- 拒绝 URL userinfo；
- 默认拒绝 loopback、link-local、private、multicast 和 metadata IP；
- 使用 custom `lookup` 把 public upstream 连接固定到已经校验的 DNS result，避免校验后再次解析造成 DNS rebinding/TOCTOU；
- raw transparent proxy 不跟随 redirect，3xx status/headers/body 原样返回；
- local model server 场景由 admin 对单个 upstream 显式打开 `allowPrivateNetwork`；
- reachability check 有 5 秒连接检查超时；
- API request 不能通过 body/query 临时覆盖 upstream URL。

### 14.3 数据与日志

- 结构化日志只写 capture ID、mode、protocol、status、duration、byte counts 和 sanitized error code。
- 不写 request/response body、完整 headers、key 或完整 query。
- Capture directory 明确视为敏感数据；删除操作移动到 data root 内的 trash。
- Import、详情读取和删除都需要 admin auth；页面显示敏感数据提示，但不自动二次修改原始 prompt。
- Runtime 和 upstream 配置永不包含 actual key。

## 15. 依赖与运行时升级

截至 2026-07-22 lockfile 中实际使用的版本：

| Package | Latest snapshot |
| --- | --- |
| `vue` | `3.5.40` |
| `vite` | `8.1.5` |
| `@vitejs/plugin-vue` | `6.0.8` |
| `@varlet/ui` | `3.19.3` |
| `pinia` | `4.0.2` |
| `vue-router` | `5.2.0` |
| `typescript` | `5.9.3` |
| `vitest` | `4.1.10` |
| `express` | `5.2.1` |
| `commander` | `15.0.0` |
| `cors` | `2.8.6` |

TypeScript 7 与当前 Vue 类型工具链不兼容，因此使用最新兼容版 5.9.3；其余新增直接依赖使用当日最新版本并锁定。Varlet 当前依赖链中的 `axios`、`lodash`、`js-cookie`、`js-yaml` 与 `uuid` 通过 lockfile-compatible `overrides` 固定到已修复版本，完整 `npm audit` 和 production-only audit 均为 0。构建使用 `npm ci`，不能在部署时漂移版本。

项目统一使用 ESM，避免长期维护 CommonJS/ESM 双边界，并与 Node 22、Vite 和最新依赖保持一致。

```json
{
  "type": "module",
  "engines": {
    "node": ">=22.12"
  }
}
```

TypeScript 使用 `module` / `moduleResolution: "NodeNext"`。迁移清单包括 relative import 的 `.js` extensions、CLI shebang、`main`/`bin`/`start` 指向和 Express 5 handler typings。开发 server 使用 `tsx`，生产仍由 `tsc` 构建。Vite 和 server 使用各自 tsconfig；server 为 Node 22 的标准 `fetch`/`Request`/`Response` 类型包含 DOM lib。

## 16. 实际文件结构

保持一个 package 和有限职责文件：

```text
src/
├── admin.ts
├── app.ts
├── capture-utils.ts
├── gateway.ts
├── network.ts
├── recording.ts
├── runtime.ts
├── scenario-store.ts
├── scenario.ts
└── server.ts
web/
├── index.html
├── vite.config.ts
└── src/
    ├── main.ts
    ├── App.vue
    ├── router.ts
    ├── api.ts
    ├── stores/
    │   └── runtime.ts
    └── views/
tests/
├── capture-utils.test.ts
├── integration.test.ts
├── network.test.ts
├── recording.test.ts
├── runtime-server.test.ts
└── scenario.test.ts
```

不为每个协议建立 class hierarchy。协议逻辑使用 discriminated unions 和纯函数：

```ts
decodeCapture(protocol, records): ConversionResult<Scenario>
compileScenario(protocol, scenario, options): CompiledResponse
```

`npm run dev` 使用 `tsx watch` 启动 server，`npm run dev:web` 独立启动 Vite；不增加 process-runner dependency。

## 17. CLI、环境变量与 Docker

CLI：

```text
--host <host>
--port <port>
--admin-host <host>
--admin-port <port>
--data-dir <path>
--admin-token <token>
--verbose
```

环境变量：

```text
HOST
PORT
ADMIN_HOST
ADMIN_PORT
ADMIN_TOKEN
DATA_DIR
VERBOSE
```

CLI 入口读取 CLI 参数，容器/`npm start` 入口读取环境变量。mode、enabled endpoints、upstreams 和 bindings 存在 `DATA_DIR/runtime.json`；API key 永不写入 runtime。

Docker 使用多阶段构建：

1. `npm ci`；
2. build TypeScript + Vue；
3. production image 只安装 production dependencies；
4. 复制 `dist/server` 和 `dist/admin`；built-in scenarios 编译在 server bundle 中；
5. `/data` 作为持久化 mount；
6. image 声明 `3000/3001`，但默认 Admin 只监听容器 loopback；若改为 `0.0.0.0`，必须同时配置 `ADMIN_TOKEN`。

Vite 固定输出到 `dist/admin`。同步更新 package `files`、`main`、`bin`、`start` 和 CLI shebang，确保 `npm pack` 后的 `npx mock-openai-api` 与 Docker 一样包含后台静态资源与 built-ins。

Compose 示例目标：

```yaml
services:
  mock-openai-api:
    ports:
      - "3000:3000"
    volumes:
      - ./mock-data:/data
    environment:
      DATA_DIR: /data
      ADMIN_HOST: 0.0.0.0
      ADMIN_TOKEN: ${ADMIN_TOKEN:?Set ADMIN_TOKEN}
```

若经 Nginx/Caddy 使用 SSE，部署文档必须说明关闭 response buffering；否则 replay scheduler 的 write 时间不会等于客户端观察时间。

## 18. 分阶段实施记录与后续

下面保留原始路线，作为“计划过什么、实际交付到哪里”的追踪，不应把每条计划误读成已完成声明。当前状态：

| Phase | 当前结果 | 未完成/有意后移 |
| --- | --- | --- |
| 0 | Node 22 + ESM、latest direct deps、Vitest、统一 server bootstrap | legacy path-only verbose global 仍保留；本机无 Docker engine |
| 1 | 三协议 raw proxy、JSONL capture、body/key redaction、SSRF/DNS pinning、network/chunk timing；已解析到 canonical URL 的 DNS/SSRF/connect preflight 失败也生成 capture | 缺失或非法 upstream 配置无法构造 canonical URL，因而不生成 capture；无独立 upstream timeout policy |
| 2 | exact raw replay、speed/instant、runtime snapshot、built-ins | 无 prompt matcher、playlist |
| 3 | text/function-tool/basic-usage/finish/error 公共 IR 与三协议 compiler | extension IR、strict/best-effort、完整 provider semantics |
| 4 | list/detail/Parsed/Timeline/import/trash、Save as Scenario、Bind to Replay、Settings、API Test | download/restore/paged raw reader |
| 5 | Text/Markdown/function tool/usage/finish/error/ping 可视化编辑与 server preview | custom tool/reasoning blocks、逐字段 conversion report、完整组件/无障碍测试 |
| 6 | 双 listener、admin token、secure file permissions、Docker/Compose files、README | Docker image 由 release CI 验证；quota/disk-failure benchmark 与 compatibility client suite 待补 |

下列扩展不属于当前首版交付：自动 prompt 匹配、capture restore/download、分页 raw reader、完整 provider extension IR、strict/best-effort 双策略和多进程存储。

### Phase 0：建立可改造基线

改动：

1. 干净 `npm ci` 验证当前基线。
2. 单独完成 Node/ESM/TypeScript/Express/Commander migration：extensions、JSON imports、entry points、shebang、Express typings、`npm pack` smoke test；通过后再进入行为改动。
3. 提交锁定后的 latest dependency lockfile。
4. 合并 `src/index.ts` / `src/cli.ts` 到统一 bootstrap。
5. Legacy logger 只保留 method/path 输出；新 gateway 不记录 body、完整 headers 或完整 query。
6. 添加 Vitest 与本地 fake upstream integration harness。
7. 固化当前 Chat builtin 行为，明确修复首个 `[DONE]` 后继续写流的问题。

阶段验收目标：

- server build、完整 web admin build 通过；Docker build 由具备 engine 的 release gate 验证；
- 现有 Chat/Gemini smoke tests 通过；
- 日志测试证明 auth/query secret 不出现。

### Phase 1：Raw proxy + capture

改动：

1. 增加三类 gateway routes，放在 body parser 前。
2. 实现 upstream config 与 pass-through auth。
3. 实现 Node raw HTTP proxy、动态 hop-by-hop header 处理、pinned DNS lookup、redirect policy 和 abort。
4. 实现 JSONL recorder、base64 chunks、monotonic timestamps、hash、partial/atomic rename。
5. 实现 secret sanitizer 和 capture loader。

验收：

- stream/non-stream request body SHA-256 与 fake upstream 收到的 bytes 一致；
- downstream response body SHA-256 与 fake upstream 发出的 entity bytes 一致；
- gzip、跨 UTF-8 boundary、CRLF、多 event/chunk 和半 event/chunk 均不被改写；
- 401/429/500、headers 后 reset、timeout、client cancel 都生成准确 outcome；
- downstream 和最终 upstream sanitized headers/body hashes 均可审计；gateway 生成的 400/502 也有完整 `response.*`；
- capture 和日志中不存在测试 key；
- DNS rebinding、private/link-local/metadata IP、redirect 和 userinfo 安全测试在本阶段通过，不拖到最后补。

### Phase 2：Raw replay + builtin mode

改动：

1. 实现 active binding 与 per-request runtime snapshot。
2. 实现 absolute-time replay scheduler、speed、instant、drain 和 abort。
3. 迁移已有 mock data 为 built-in scenarios。
4. 支持完整、partial capture 浏览；partial 不可默认绑定。
5. 增加 mode 切换和 non-secret runtime persistence。

验收：

- same-protocol replay body hash 与 capture 完全一致；
- `Body Exact` 仅对 outcome、bytes、headers/trailers 和 termination semantics 全部满足条件的 capture 出现；
- Body Exact 遇到 effective `stream_options` mismatch 返回 409，不重编 raw bytes；
- chunk write 顺序一致，1x timing 在可定义容差内；
- response 早于 request body end 的 capture 明确显示 `timingReplayable: false`；
- mode 切换不改变 in-flight request；
- 无 upstream 时 builtin mode 默认可用。

### Phase 3：协议 parser、IR 与转换

改动：

1. 实现 tolerant SSE parser 与三协议 decoder。
2. 实现 scenario schema、validation 和三协议 compiler。
3. 实现 text、Markdown、function tool call、usage、finish/error 的公共支持矩阵。
4. 公共子集之外的 strict/best-effort diagnostics 留作后续扩展。

验收：

- 官方格式 golden fixtures 可 decode -> IR -> target compile；
- tool arguments 跨任意 byte/event fragment 可正确聚合；
- invalid function arguments 仍按 opaque string 保留；仅 target-specific compiler 决定 warning/422；
- legacy Chat `function_call`、unknown fields/items/events 由 Raw Capture/Replay 保真；Semantic decoder 明确返回 unsupported；
- OpenAI Chat 只在正确位置产生一个 `[DONE]`；
- Responses 保持 event lifecycle 和 sequence；
- Anthropic 保持 block index、ping、stream error 与 cumulative usage；
- unsupported semantics 返回明确错误，不静默丢失；未来再增加逐字段 extension IR 与 strict/best-effort policy。

### Phase 4：Admin API 与文件管理 UI

改动：

1. 实现 loopback admin listener、token 和 Control API。
2. 实现 capture/scenario list、filter、detail、Parsed/Timeline、import/trash；paged raw、download/restore 后移。
3. 实现 runtime dashboard、mode switch、upstream settings、binding page。
4. 实现 request tester 与 raw/parsed stream viewer。

验收：

- 默认 admin 不从外部网卡访问；
- 非 loopback 无 token 时拒绝启动；
- 大 capture 不会整体载入浏览器；
- 测试台 key 不进入 control API、Pinia、URL 或 LocalStorage；
- 外部复制合法文件后 Refresh 可识别，非法 schema 友好报错。

### Phase 5：可视化 Scenario Editor

改动：

1. 实现 block palette、timeline、properties、reorder 和 validation。
2. 实现 Markdown preview、tool fragment editor、usage/finish/error/ping blocks。
3. 实现三协议 JSON/SSE preview。
4. 实现 capture -> scenario conversion report 与保存。

验收：

- 不写代码即可制作 text、Markdown、单/并行 tool calls、错误与延迟；
- 保存前能定位 tool JSON warning/target-specific incompatibility、重复 ID、乱序时间；
- keyboard-only 可完成增删改和排序；
- preview 与后端实际 compiler snapshot 完全一致。

### Phase 6：硬化、文档和发布

改动：

1. 补齐 SSRF regression、path traversal、symlink、quota、disk failure tests。
2. 完成 Docker volume、admin exposure、reverse proxy SSE 文档。
3. 更新 README/README.zh/DEPLOYMENT，删除不真实的“Full compatibility”描述。
4. CI 执行 typecheck、unit、integration、web build、Docker build、`npm pack` smoke test。
5. 对大文件、大量小 chunk、慢客户端和并发录制做基准测试。

验收：

- 所有 Definition of Done 条目通过；
- clean checkout 只用 `npm ci && npm run build && npm test` 可复现；
- 默认配置不暴露 admin、不写 key、不丢 built-in capability。

## 19. 测试策略

### 19.1 Unit

- capture JSONL read/write、partial recovery、schema version；
- header/query/error sanitizer；
- URL resolution 与 SSRF address classification；
- SSE incremental parser：LF/CRLF/multiline/comment/partial UTF-8/unknown fields；
- 三协议 decoder/compiler golden snapshots；
- 公共子集 conversion matrix；未来的 strict/best-effort policy 另行测试；
- runtime revision 与 request snapshot；
- scheduler absolute timing math。

### 19.2 Integration

本地 fake upstream 必须能故意产生：

```text
custom status/statusText
duplicate/mixed-case headers
gzip/br body
one SSE event split across many reads
many SSE events in one read
UTF-8 code point split across reads
Chat [DONE]
Responses named terminal event without [DONE]
Anthropic ping and event:error after HTTP 200
slow chunks
disconnect before headers
disconnect after headers
response before request body end
trailers
large response
```

断言：

- request/response concatenated byte hashes；
- sanitized downstream/upstream header snapshots 与 forwarded request body hash；
- raw chunk seq、offset 和 monotonic timestamps；
- downstream bytes；
- replay bytes；
- capture terminal outcome；
- zero secret occurrence。

Release compatibility suite 再以锁定版本的 `openai` 和 `@anthropic-ai/sdk` 作为真实 downstream clients，覆盖三个 endpoint 的 stream/non-stream/text/function-call/error。它们只作为 dev contract tests，不进入 gateway 实现或 production dependencies。

### 19.3 Timing

Timing test 不断言不现实的 1 ms 精度。建议本地空闲环境：

```text
per chunk target error <= max(20 ms, recorded interval * 20%)
order must always match
instant mode must skip configured delay
slow downstream must not reorder or drop bytes
```

CI 只检查宽容差和顺序；更严格基准单独运行，避免 flaky test。

### 19.4 Web

- component tests：mode confirmation、filters、paged records、editor validation；
- server compiler 与 `/preview` API snapshots；
- smoke flow：import capture -> inspect -> convert -> edit -> bind -> call API -> inspect activity；
- keyboard navigation、focus、light/dark visual QA；
- 浏览器刷新和多 tab revision conflict。

## 20. Definition of Done

以下是 release 级验收清单。当前分支满足首版核心；第 9 项仅实现公共子集与通用 UI 告警，第 14 项的 Docker image build 等待具备 Docker engine 的 release CI，因此本文状态是“进入验收”而不是“已经发布”。

1. 三个 canonical endpoints 的 stream/non-stream 均可在 builtin、record、replay 模式工作。
2. Record 模式不经 JSON parse/re-serialize，不改写 raw request/response body。
3. 每请求一个独立文件；complete 文件原子落盘，异常 `.partial` 文件可解析、检查并显式标记，不伪装成 complete capture。
4. 由 request credential headers/query 提取出的 API key、cookie、URL credentials 不出现在在线生成的 capture、runtime、admin response 或 logs；import 拒绝包含未脱敏 credential headers/URL 的文件。
5. 同协议 raw replay 的 response body SHA-256 完全相等。
6. 每个 proxy read chunk 有 seq、byte offset、`bytesBase64`（可直接得到 size）和 monotonic timestamp。
7. Replay 支持 recorded speed、倍率和 instant，处理 backpressure 与 abort。
8. Chat `[DONE]`、Responses terminal event、Anthropic message lifecycle 都按各自协议生成，不互相套用。
9. 跨协议只承诺支持矩阵内语义；当前 unsupported event/type 返回错误，其他转换统一显示 Semantic/Transcoded 通用告警；逐字段 diagnostics 后移。
10. 默认 built-in scenarios 可直接使用并可在后台切换、预览和绑定；用户自建 scenario 可编辑。
11. 后台可管理指定 root 内文件、查看 raw timeline、import，并把删除项移入同一 data root 的 trash。
12. 管理后台和 API 一起启动，但默认不把 admin 控制面暴露到公网。
13. Production gateway 不依赖 provider SDK；协议保真路径只使用 Node.js HTTP primitives。
14. clean install 的 typecheck、unit、integration、web build 和 `npm pack` smoke test 全部通过；Docker build 由具备 Docker engine 的 release CI gate 验证。
15. Capture 同时保存 sanitized downstream/upstream request headers、upstream raw response header snapshot 和 downstream-visible response。
16. 无法复现 upload/response overlap 的 capture 明确标记 timing degraded，不把迟到调度冒充精确延迟。

## 21. 已确定的产品决策

这些问题不再留给实现阶段临时猜测：

| 问题 | 决策 |
| --- | --- |
| “原封不动”范围 | HTTP entity body bytes + observed read/write schedule，不宣称 packet/frame fidelity |
| API key | 透传但永不持久化，录制与日志统一 `[REDACTED]` |
| 默认模式 | `builtin` |
| 多条录制如何选择 | `(protocol, endpoint, stream)` active binding，默认忽略任意 prompt |
| 同协议与跨协议 | Raw Body Exact 与 Semantic Transcoded 分离 |
| 跨协议损失 | 当前只编译公共子集并统一标记 Semantic/Transcoded；strict/best-effort 与逐字段 warnings 后移 |
| Capture 是否可编辑 | 不可编辑；另存 Scenario 后编辑 |
| 数据库 | 首版不引入，目录顺序扫描 + schema validation |
| Admin 监听 | 同进程独立 listener，默认 `127.0.0.1:3001` |
| Upstream auth | 首版只允许 pass-through；不保存 secret |
| 多实例 | 首版 single process / single writer |
| Gemini | 不扩张，仅保持现有兼容 |

按此边界实施，可以同时满足透明录制、可验证重放、协议转换和可视化编辑，不引入无法参与原始录制的 provider abstraction。

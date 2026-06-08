import { buildAnthropicError, ProviderError } from "../../core/errors/providerErrors";
import { IdFactory } from "../../core/state/idFactory";
import { ScenarioName, ScenarioSelection } from "../../core/scenarioEngine";
import { anthropicEvent } from "../../core/sse/anthropicSse";
import { estimateTokens } from "../../core/usage/tokenEstimator";
import { buildAnthropicUsage } from "../../core/usage/usageBuilder";
import {
  validateAnthropicCountTokensRequest,
  validateAnthropicMessageRequest,
} from "../../core/validation/anthropicSchemas";

export type AnthropicMessageCreateRequest = {
  model?: string;
  messages?: AnthropicInputMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  metadata?: Record<string, unknown>;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
  thinking?: { type: "enabled" | "adaptive" | "disabled"; budget_tokens?: number; effort?: string };
  mcp_servers?: unknown[];
  service_tier?: "auto" | "standard_only";
};

export type AnthropicInputMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: object }
  | { type: "image"; source: unknown; cache_control?: object }
  | { type: "document"; source: unknown; title?: string; cache_control?: object }
  | {
      type: "tool_result";
      tool_use_id: string;
      content?: string | AnthropicContentBlock[];
      is_error?: boolean;
      cache_control?: object;
    };

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: object;
  strict?: boolean;
  cache_control?: object;
  eager_input_streaming?: boolean;
};

export type AnthropicOutputBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type AnthropicMessage = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicOutputBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

const seededFactories = new Map<string, IdFactory>();
const processFactory = new IdFactory();

export function createAnthropicMessage(
  request: AnthropicMessageCreateRequest,
  selection: ScenarioSelection
): ServiceResult<AnthropicMessage> {
  const validationError = validateAnthropicRequest(request);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  if (selection.scenario === "invalid_request") {
    return { ok: false, error: buildAnthropicError(400, "Invalid mock request scenario.") };
  }

  if (selection.scenario === "rate_limit") {
    return { ok: false, error: buildAnthropicError(429, "Mock rate limit exceeded.") };
  }

  if (selection.scenario === "invalid_tool_args") {
    return { ok: false, error: buildAnthropicError(400, "Invalid mock tool arguments.") };
  }

  const factory = getIdFactory(selection.seed);
  const scenario = refineScenarioFromRequest(request, selection.scenario);
  const content = buildContentBlocks(request, scenario, factory);
  const outputText = content.map((block) => JSON.stringify(block)).join(" ");
  const usage = buildAnthropicUsage(
    {
      system: request.system,
      messages: request.messages,
      tools: request.tools,
    },
    outputText
  );

  return {
    ok: true,
    value: {
      id: factory.next("message", "anthropic.messages"),
      type: "message",
      role: "assistant",
      model: request.model || "claude-sonnet-4-5",
      content,
      stop_reason: stopReasonForScenario(request, scenario),
      stop_sequence: null,
      usage,
    },
  };
}

export function countAnthropicMessageTokens(request: AnthropicMessageCreateRequest): ServiceResult<{
  input_tokens: number;
}> {
  const validationError = validateAnthropicTokenRequest(request);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  return {
    ok: true,
    value: {
      input_tokens: estimateTokens({
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      }),
    },
  };
}

export function encodeAnthropicMessageStream(message: AnthropicMessage): string {
  const chunks: string[] = [];

  chunks.push(
    anthropicEvent("message_start", {
      type: "message_start",
      message: {
        ...message,
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: 1,
        },
      },
    })
  );

  message.content.forEach((block, index) => {
    chunks.push(
      anthropicEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: contentBlockStart(block),
      })
    );

    if (block.type === "text") {
      splitText(block.text).forEach((text) => {
        chunks.push(
          anthropicEvent("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text },
          })
        );
      });
    }

    if (block.type === "tool_use") {
      splitJson(JSON.stringify(block.input)).forEach((partial_json) => {
        chunks.push(
          anthropicEvent("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json },
          })
        );
      });
    }

    if (block.type === "thinking") {
      chunks.push(
        anthropicEvent("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "thinking_delta", thinking: block.thinking },
        })
      );
      chunks.push(
        anthropicEvent("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature || "sig_mock_0001" },
        })
      );
    }

    chunks.push(anthropicEvent("content_block_stop", { type: "content_block_stop", index }));
  });

  chunks.push(
    anthropicEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: message.stop_reason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: message.usage.output_tokens,
      },
    })
  );
  chunks.push(anthropicEvent("message_stop", { type: "message_stop" }));

  return chunks.join("");
}

function validateAnthropicRequest(request: AnthropicMessageCreateRequest): ProviderError | undefined {
  const result = validateAnthropicMessageRequest(request);
  return result.ok ? undefined : buildAnthropicError(400, result.issue.message);
}

function validateAnthropicTokenRequest(request: AnthropicMessageCreateRequest): ProviderError | undefined {
  const result = validateAnthropicCountTokensRequest(request);
  return result.ok ? undefined : buildAnthropicError(400, result.issue.message);
}

function refineScenarioFromRequest(
  request: AnthropicMessageCreateRequest,
  scenario: ScenarioName
): ScenarioName {
  if (hasToolResult(request.messages)) {
    return "tool_result";
  }

  if (request.thinking && request.thinking.type !== "disabled") {
    return "thinking";
  }

  if ((scenario === "simple_text" || scenario === "stream_text") && request.tools && request.tools.length > 1) {
    return "parallel_tools";
  }

  if ((scenario === "simple_text" || scenario === "stream_text") && request.tools && request.tools.length > 0) {
    return "tool_call";
  }

  return scenario;
}

function buildContentBlocks(
  request: AnthropicMessageCreateRequest,
  scenario: ScenarioName,
  factory: IdFactory
): AnthropicOutputBlock[] {
  if (scenario === "tool_call") {
    return [
      { type: "text", text: "I'll check the requested information." },
      buildToolUseBlock(factory, request.tools?.[0]?.name || "get_order"),
    ];
  }

  if (scenario === "parallel_tools") {
    const tools = request.tools && request.tools.length > 0 ? request.tools : fallbackTools();
    return tools.slice(0, 4).map((tool) => buildToolUseBlock(factory, tool.name));
  }

  if (scenario === "tool_result") {
    return [
      {
        type: "text",
        text: `The tool result has been processed: ${extractToolResult(request.messages)}`,
      },
    ];
  }

  if (scenario === "thinking") {
    return [
      {
        type: "thinking",
        thinking: "We need to inspect the request and return a deterministic mock answer.",
        signature: factory.next("message", "anthropic.thinking.signature"),
      },
      { type: "text", text: "The deterministic thinking mock completed the request." },
    ];
  }

  if (scenario === "refusal") {
    return [{ type: "text", text: "I cannot comply with this mock request." }];
  }

  if (scenario === "file_reference") {
    return [{ type: "text", text: "The mock Claude model acknowledged the file reference." }];
  }

  if (scenario === "vision") {
    return [{ type: "text", text: "The mock Claude model inspected the image input." }];
  }

  if (scenario === "pause_turn") {
    return [{ type: "text", text: "The mock Claude turn is paused for external continuation." }];
  }

  return [{ type: "text", text: "Hello from Claude mock." }];
}

function buildToolUseBlock(factory: IdFactory, name: string): AnthropicOutputBlock {
  return {
    type: "tool_use",
    id: factory.next("toolUse", `anthropic.messages.${name}`),
    name,
    input: toolInput(name),
  };
}

function toolInput(name: string): Record<string, unknown> {
  if (name.includes("weather")) {
    return { city: "Tokyo" };
  }

  return { order_id: "A100" };
}

function fallbackTools(): AnthropicTool[] {
  return [
    { name: "get_order", input_schema: { type: "object" } },
    { name: "get_weather", input_schema: { type: "object" } },
  ];
}

function stopReasonForScenario(
  request: AnthropicMessageCreateRequest,
  scenario: ScenarioName
): AnthropicMessage["stop_reason"] {
  if (request.max_tokens !== undefined && request.max_tokens <= 1) {
    return "max_tokens";
  }

  if (scenario === "tool_call" || scenario === "parallel_tools") {
    return "tool_use";
  }

  if (scenario === "refusal") {
    return "refusal";
  }

  if (scenario === "pause_turn") {
    return "pause_turn";
  }

  return "end_turn";
}

function contentBlockStart(block: AnthropicOutputBlock): AnthropicOutputBlock {
  if (block.type === "text") {
    return { type: "text", text: "" };
  }

  if (block.type === "tool_use") {
    return { ...block, input: {} };
  }

  if (block.type === "thinking") {
    return { type: "thinking", thinking: "", signature: "" };
  }

  return block;
}

function hasToolResult(messages: AnthropicInputMessage[] | undefined): boolean {
  return Boolean(messages?.some((message) => containsToolResult(message.content)));
}

function containsToolResult(content: string | AnthropicContentBlock[]): boolean {
  return Array.isArray(content) && content.some((block) => block.type === "tool_result");
}

function extractToolResult(messages: AnthropicInputMessage[] | undefined): string {
  if (!messages) {
    return "{}";
  }

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    const block = message.content.find((content) => content.type === "tool_result");
    if (block?.type === "tool_result") {
      return typeof block.content === "string" ? block.content : JSON.stringify(block.content || {});
    }
  }

  return "{}";
}

function splitText(text: string): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += 3) {
    chunks.push(words.slice(index, index + 3).join(" ") + (index + 3 < words.length ? " " : ""));
  }

  return chunks;
}

function splitJson(json: string): string[] {
  const midpoint = Math.ceil(json.length / 2);
  return [json.slice(0, midpoint), json.slice(midpoint)].filter(Boolean);
}

function getIdFactory(seed: string): IdFactory {
  if (seed === "default") {
    return processFactory;
  }

  const existing = seededFactories.get(seed);
  if (existing) {
    return existing;
  }

  const factory = new IdFactory(seed);
  seededFactories.set(seed, factory);
  return factory;
}

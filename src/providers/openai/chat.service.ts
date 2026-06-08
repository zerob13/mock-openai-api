import { buildOpenAIError, ProviderError } from "../../core/errors/providerErrors";
import { IdFactory } from "../../core/state/idFactory";
import { MemoryStateStore, MockStateRecord } from "../../core/state/memoryStore";
import { ScenarioName, ScenarioSelection } from "../../core/scenarioEngine";
import { openAIDone, openAIData } from "../../core/sse/openaiSse";
import { buildOpenAIChatUsage, OpenAIChatUsage } from "../../core/usage/usageBuilder";
import {
  validateOpenAIChatCompletionRequest,
  ValidationIssue,
} from "../../core/validation/openaiSchemas";

export type ChatRole = "developer" | "system" | "user" | "assistant" | "tool" | "function";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } | string }
  | { type: "input_audio"; input_audio: { data?: string; format?: string } }
  | { type: "file"; file: { file_id?: string; file_data?: string; filename?: string } }
  | { type: "refusal"; refusal: string };

export type ChatMessage = {
  role: ChatRole;
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

export type ChatTool = {
  type?: "function" | "custom";
  name?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: object;
  };
  custom?: object;
};

export type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionCreateRequest = {
  model?: string;
  messages?: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "none" | "auto" | "required" | object;
  parallel_tool_calls?: boolean;
  response_format?: { type?: "text" | "json_object" | "json_schema"; json_schema?: object };
  stream?: boolean;
  stream_options?: { include_usage?: boolean; include_obfuscation?: boolean };
  metadata?: Record<string, string>;
  seed?: number;
  functions?: Array<{ name: string; description?: string; parameters?: object }>;
  function_call?: string | { name: string };
  modalities?: string[];
  audio?: object;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
};

export type ChatCompletionObject = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter";
  }>;
  usage: OpenAIChatUsage;
  system_fingerprint: string;
  metadata?: Record<string, string>;
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage> & {
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: "stop" | "tool_calls" | null;
  }>;
  usage?: OpenAIChatUsage | null;
};

export type ChatCompletionRecord = MockStateRecord & {
  completion: ChatCompletionObject;
  messages: ChatMessage[];
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

export const openAIChatStore = new MemoryStateStore();

const seededFactories = new Map<string, IdFactory>();
const processFactory = new IdFactory();

export function createOpenAIChatCompletion(
  request: ChatCompletionCreateRequest,
  selection: ScenarioSelection
): ServiceResult<{ completion: ChatCompletionObject; messages: ChatMessage[]; scenario: ScenarioName }> {
  const validationError = validateChatRequest(request);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  if (selection.scenario === "invalid_request") {
    return { ok: false, error: buildOpenAIError(400, "Invalid mock request scenario.") };
  }

  if (selection.scenario === "rate_limit") {
    return { ok: false, error: buildOpenAIError(429, "Mock rate limit exceeded.") };
  }

  if (selection.scenario === "invalid_tool_args") {
    return { ok: false, error: buildOpenAIError(400, "Invalid mock tool arguments.", "tools") };
  }

  const scenario = refineScenarioFromRequest(request, selection.scenario);
  const factory = getIdFactory(selection.seed);
  const outputMessage = buildAssistantMessage(request, scenario, factory);
  const outputText = outputMessage.content || JSON.stringify(outputMessage.tool_calls || []);
  const usage = buildOpenAIChatUsage(request.messages || [], outputText);
  const completion: ChatCompletionObject = {
    id: factory.next("chatCompletion", "openai.chat"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model || "gpt-4.1-mini",
    choices: [
      {
        index: 0,
        message: outputMessage,
        finish_reason: outputMessage.tool_calls ? "tool_calls" : "stop",
      },
    ],
    usage,
    system_fingerprint: "fp_mock_openai_chat",
    metadata: request.metadata || {},
  };
  const messages = [...(request.messages || []), outputMessage];

  openAIChatStore.create<ChatCompletionRecord>("chatCompletions", {
    id: completion.id,
    provider: "openai",
    completion,
    messages,
  });

  return { ok: true, value: { completion, messages, scenario } };
}

export function getOpenAIChatCompletion(completionId: string): ServiceResult<ChatCompletionObject> {
  const record = openAIChatStore.get<ChatCompletionRecord>("chatCompletions", completionId);

  if (!record) {
    return { ok: false, error: buildOpenAIError(404, `Chat completion '${completionId}' was not found.`) };
  }

  return { ok: true, value: record.completion };
}

export function updateOpenAIChatCompletion(
  completionId: string,
  patch: { metadata?: Record<string, string> }
): ServiceResult<ChatCompletionObject> {
  const record = openAIChatStore.get<ChatCompletionRecord>("chatCompletions", completionId);

  if (!record) {
    return { ok: false, error: buildOpenAIError(404, `Chat completion '${completionId}' was not found.`) };
  }

  const completion = {
    ...record.completion,
    metadata: patch.metadata || record.completion.metadata || {},
  };
  openAIChatStore.update<ChatCompletionRecord>("chatCompletions", completionId, { completion });

  return { ok: true, value: completion };
}

export function deleteOpenAIChatCompletion(completionId: string): ServiceResult<{
  id: string;
  object: "chat.completion.deleted";
  deleted: boolean;
}> {
  const deleted = openAIChatStore.delete("chatCompletions", completionId);

  if (!deleted) {
    return { ok: false, error: buildOpenAIError(404, `Chat completion '${completionId}' was not found.`) };
  }

  return { ok: true, value: { id: completionId, object: "chat.completion.deleted", deleted: true } };
}

export function listOpenAIChatMessages(completionId: string): ServiceResult<{
  object: "list";
  data: ChatMessage[];
  first_id: string | null;
  last_id: string | null;
  has_more: false;
}> {
  const record = openAIChatStore.get<ChatCompletionRecord>("chatCompletions", completionId);

  if (!record) {
    return { ok: false, error: buildOpenAIError(404, `Chat completion '${completionId}' was not found.`) };
  }

  const messages = record.messages.map((message, index) => ({
    id: `chatmsg_mock_${String(index + 1).padStart(4, "0")}`,
    ...message,
  }));

  return {
    ok: true,
    value: {
      object: "list",
      data: messages,
      first_id: messages[0]?.id || null,
      last_id: messages.at(-1)?.id || null,
      has_more: false,
    },
  };
}

export function encodeOpenAIChatCompletionStream(
  completion: ChatCompletionObject,
  scenario: ScenarioName,
  includeUsage: boolean
): string {
  const choice = completion.choices[0];
  const message = choice.message;
  const base = {
    id: completion.id,
    object: "chat.completion.chunk" as const,
    created: completion.created,
    model: completion.model,
    system_fingerprint: completion.system_fingerprint,
  };
  const chunks: string[] = [
    openAIData({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      usage: null,
    }),
  ];

  if (scenario === "tool_call" || scenario === "parallel_tools") {
    for (const [index, toolCall] of (message.tool_calls || []).entries()) {
      chunks.push(
        openAIData({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: toolCall.id,
                    type: "function",
                    function: { name: toolCall.function.name, arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
          usage: null,
        })
      );
      chunks.push(
        openAIData({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    function: { arguments: toolCall.function.arguments },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
          usage: null,
        })
      );
    }
    chunks.push(
      openAIData({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: includeUsage ? completion.usage : null,
      })
    );
    chunks.push(openAIDone());
    return chunks.join("");
  }

  for (const chunk of splitText(String(message.content || ""))) {
    chunks.push(
      openAIData({
        ...base,
        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        usage: null,
      })
    );
  }

  chunks.push(
    openAIData({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: includeUsage ? null : completion.usage,
    })
  );

  if (includeUsage) {
    chunks.push(
      openAIData({
        ...base,
        choices: [],
        usage: completion.usage,
      })
    );
  }

  chunks.push(openAIDone());
  return chunks.join("");
}

function validateChatRequest(request: ChatCompletionCreateRequest): ProviderError | undefined {
  const result = validateOpenAIChatCompletionRequest(request);
  return result.ok ? undefined : openAIValidationError(result.issue);
}

function refineScenarioFromRequest(
  request: ChatCompletionCreateRequest,
  scenario: ScenarioName
): ScenarioName {
  if (hasToolResult(request.messages)) {
    return "tool_result";
  }

  if (hasMultipleTools(request)) {
    return "parallel_tools";
  }

  if (hasTools(request)) {
    return "tool_call";
  }

  if (request.response_format?.type === "json_schema" || request.response_format?.type === "json_object") {
    return "structured_json";
  }

  const multimodal = inferChatMultimodalScenario(request.messages || []);
  if (multimodal) {
    return multimodal;
  }

  return scenario === "stream_text" ? "simple_text" : scenario;
}

function buildAssistantMessage(
  request: ChatCompletionCreateRequest,
  scenario: ScenarioName,
  factory: IdFactory
): ChatMessage {
  if (scenario === "tool_call" || scenario === "parallel_tools") {
    const names = toolNames(request);
    const selectedNames = scenario === "parallel_tools" ? names.slice(0, 4) : names.slice(0, 1);
    const fallback = scenario === "parallel_tools" ? ["get_order", "get_weather"] : ["get_order"];

    return {
      role: "assistant",
      content: null,
      tool_calls: (selectedNames.length > 0 ? selectedNames : fallback).map((name) => ({
        id: factory.next("call", `openai.chat.${name}`),
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(toolArguments(name)),
        },
      })),
    };
  }

  if (scenario === "tool_result") {
    return {
      role: "assistant",
      content: `The mock tool result was processed successfully: ${extractToolResult(request.messages)}`,
    };
  }

  if (scenario === "structured_json") {
    return {
      role: "assistant",
      content: '{"name":"UltraWidget","price":19.99,"currency":"USD"}',
    };
  }

  if (scenario === "vision") {
    return { role: "assistant", content: "The mock chat model inspected the image input." };
  }

  if (scenario === "multimodal_audio") {
    return { role: "assistant", content: "The mock chat model acknowledged the audio input." };
  }

  if (scenario === "file_reference") {
    return { role: "assistant", content: "The mock chat model acknowledged the file input." };
  }

  if (scenario === "refusal") {
    return { role: "assistant", content: "I cannot comply with this mock request." };
  }

  return { role: "assistant", content: "Hello from the mock OpenAI chat completion." };
}

function hasTools(request: ChatCompletionCreateRequest): boolean {
  return toolNames(request).length > 0;
}

function hasMultipleTools(request: ChatCompletionCreateRequest): boolean {
  return request.parallel_tool_calls === true && toolNames(request).length > 1;
}

function toolNames(request: ChatCompletionCreateRequest): string[] {
  const toolNamesFromTools = (request.tools || [])
    .map((tool) => tool.function?.name || tool.name)
    .filter((name): name is string => Boolean(name));
  const toolNamesFromFunctions = (request.functions || []).map((fn) => fn.name);

  return [...toolNamesFromTools, ...toolNamesFromFunctions];
}

function toolArguments(name: string): Record<string, unknown> {
  if (name.includes("weather")) {
    return { city: "Tokyo" };
  }

  return { order_id: "A100" };
}

function hasToolResult(messages: ChatMessage[] | undefined): boolean {
  return Boolean(messages?.some((message) => message.role === "tool" || message.role === "function"));
}

function extractToolResult(messages: ChatMessage[] | undefined): string {
  const message = messages?.find((item) => item.role === "tool" || item.role === "function");
  if (!message) {
    return "{}";
  }

  return typeof message.content === "string" ? message.content : JSON.stringify(message.content || {});
}

function inferChatMultimodalScenario(messages: ChatMessage[]): ScenarioName | undefined {
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (part.type === "input_audio") {
        return "multimodal_audio";
      }

      if (part.type === "file") {
        return "file_reference";
      }

      if (part.type === "image_url") {
        return "vision";
      }
    }
  }

  return undefined;
}

function splitText(text: string): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += 4) {
    chunks.push(words.slice(index, index + 4).join(" ") + (index + 4 < words.length ? " " : ""));
  }

  return chunks.length > 0 ? chunks : [text];
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

function openAIValidationError(issue: ValidationIssue): ProviderError {
  if (issue.code === "missing_parameter") {
    return {
      status: 400,
      body: {
        error: {
          message: issue.message,
          type: "invalid_request_error",
          code: "missing_parameter",
        },
      },
    };
  }

  return buildOpenAIError(400, issue.message, issue.param || undefined);
}

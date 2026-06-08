import { buildOpenAIError, ProviderError } from "../../core/errors/providerErrors";
import { IdFactory } from "../../core/state/idFactory";
import { MemoryStateStore, MockStateRecord } from "../../core/state/memoryStore";
import { ScenarioName, ScenarioSelection } from "../../core/scenarioEngine";
import { openAIDone, openAIEvent } from "../../core/sse/openaiSse";
import { estimateTokens } from "../../core/usage/tokenEstimator";
import { buildOpenAIResponsesUsage, OpenAIResponsesUsage } from "../../core/usage/usageBuilder";
import {
  validateOpenAIResponsesRequest,
  ValidationIssue,
} from "../../core/validation/openaiSchemas";

export type OpenAIResponseCreateRequest = {
  model?: string;
  input?: unknown;
  instructions?: string;
  previous_response_id?: string | null;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  reasoning?: Record<string, unknown> | null;
  text?: Record<string, unknown>;
  stream?: boolean;
  store?: boolean;
  background?: boolean;
  metadata?: Record<string, string>;
  include?: string[];
};

export type OpenAIResponseContent =
  | { type: "output_text"; text: string; annotations: unknown[] }
  | { type: "refusal"; refusal: string };

export type OpenAIResponseOutputItem =
  | {
      id: string;
      type: "message";
      status: "completed" | "in_progress" | "incomplete";
      role: "assistant";
      content: OpenAIResponseContent[];
    }
  | {
      id: string;
      type: "function_call";
      status: "completed";
      call_id: string;
      name: string;
      arguments: string;
    };

export type OpenAIResponseObject = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed" | "failed" | "in_progress" | "cancelled" | "queued" | "incomplete";
  model: string;
  output: OpenAIResponseOutputItem[];
  usage?: OpenAIResponsesUsage;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  previous_response_id?: string | null;
  reasoning?: Record<string, unknown> | null;
  text?: Record<string, unknown>;
  metadata?: Record<string, string>;
  error?: Record<string, unknown> | null;
  incomplete_details?: Record<string, unknown> | null;
};

export type OpenAIResponseRecord = MockStateRecord & {
  response: OpenAIResponseObject;
  input_items: unknown[];
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

export const openAIResponsesStore = new MemoryStateStore();

const seededFactories = new Map<string, IdFactory>();
const processFactory = new IdFactory();

export function createOpenAIResponse(
  request: OpenAIResponseCreateRequest,
  selection: ScenarioSelection
): ServiceResult<{ response: OpenAIResponseObject; inputItems: unknown[]; shouldStore: boolean }> {
  const validationResult = validateOpenAIResponsesRequest(request);
  if (!validationResult.ok) {
    return { ok: false, error: openAIValidationError(validationResult.issue) };
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

  if (request.previous_response_id && !openAIResponsesStore.get("responses", request.previous_response_id)) {
    return {
      ok: false,
      error: buildOpenAIError(404, `Response '${request.previous_response_id}' was not found.`),
    };
  }

  const factory = getIdFactory(selection.seed);
  const model = request.model || "gpt-4.1-mini";
  const responseId = factory.next("response", "openai.responses");
  const inputItems = normalizeInputItems(request.input, factory);
  const output = buildOutputItems(request, selection.scenario, factory);
  const status = statusForScenario(selection.scenario, request);
  const outputText = extractOutputText(output);
  const reasoningTokens = selection.scenario === "reasoning" || request.reasoning ? 8 : 0;
  const usage = buildOpenAIResponsesUsage(request.input || request, outputText, reasoningTokens);

  const response: OpenAIResponseObject = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output,
    usage,
    tools: request.tools || [],
    tool_choice: request.tool_choice || "auto",
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    previous_response_id: request.previous_response_id || null,
    reasoning: request.reasoning || (reasoningTokens > 0 ? { effort: "medium", summary: null } : null),
    text: request.text || { format: { type: "text" } },
    metadata: request.metadata || {},
    error: selection.scenario === "failed" ? { code: "mock_failed", message: "Mock response failed." } : null,
    incomplete_details: null,
  };

  const shouldStore = request.store !== false;
  if (shouldStore) {
    openAIResponsesStore.create<OpenAIResponseRecord>("responses", {
      id: response.id,
      provider: "openai",
      response,
      input_items: inputItems,
    });
  }

  return { ok: true, value: { response, inputItems, shouldStore } };
}

export function getOpenAIResponse(responseId: string): ServiceResult<OpenAIResponseObject> {
  const record = openAIResponsesStore.get<OpenAIResponseRecord>("responses", responseId);

  if (!record) {
    return { ok: false, error: buildOpenAIError(404, `Response '${responseId}' was not found.`) };
  }

  return { ok: true, value: record.response };
}

export function deleteOpenAIResponse(responseId: string): ServiceResult<{
  id: string;
  object: "response.deleted";
  deleted: boolean;
}> {
  const deleted = openAIResponsesStore.delete("responses", responseId);

  if (!deleted) {
    return { ok: false, error: buildOpenAIError(404, `Response '${responseId}' was not found.`) };
  }

  return { ok: true, value: { id: responseId, object: "response.deleted", deleted: true } };
}

export function cancelOpenAIResponse(responseId: string): ServiceResult<OpenAIResponseObject> {
  const record = openAIResponsesStore.get<OpenAIResponseRecord>("responses", responseId);

  if (!record) {
    return { ok: false, error: buildOpenAIError(404, `Response '${responseId}' was not found.`) };
  }

  if (record.response.status === "completed" || record.response.status === "failed") {
    return {
      ok: false,
      error: buildOpenAIError(409, `Response '${responseId}' cannot be cancelled.`),
    };
  }

  const updatedResponse: OpenAIResponseObject = {
    ...record.response,
    status: "cancelled",
    error: null,
  };

  openAIResponsesStore.update<OpenAIResponseRecord>("responses", responseId, {
    response: updatedResponse,
  });

  return { ok: true, value: updatedResponse };
}

export function listOpenAIResponseInputItems(responseId: string): ServiceResult<{
  object: "list";
  data: unknown[];
  first_id: string | null;
  last_id: string | null;
  has_more: false;
}> {
  const record = openAIResponsesStore.get<OpenAIResponseRecord>("responses", responseId);

  if (!record) {
    return { ok: false, error: buildOpenAIError(404, `Response '${responseId}' was not found.`) };
  }

  const ids = record.input_items
    .filter(isRecord)
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => Boolean(id));

  return {
    ok: true,
    value: {
      object: "list",
      data: record.input_items,
      first_id: ids[0] || null,
      last_id: ids.at(-1) || null,
      has_more: false,
    },
  };
}

export function countOpenAIResponseInputTokens(body: unknown): {
  object: "response.input_tokens";
  input_tokens: number;
} {
  return {
    object: "response.input_tokens",
    input_tokens: estimateTokens(isRecord(body) && "input" in body ? body.input : body),
  };
}

export function compactOpenAIResponse(
  body: OpenAIResponseCreateRequest,
  selection: ScenarioSelection
): ServiceResult<OpenAIResponseObject> {
  const result = createOpenAIResponse(
    {
      ...body,
      input: "Compacted conversation context for deterministic mock replay.",
      store: false,
    },
    { ...selection, scenario: "simple_text" }
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    value: {
      ...result.value.response,
      output: [
        buildMessageOutput(
          getIdFactory(selection.seed),
          "The prior conversation was compacted into a deterministic mock summary."
        ),
      ],
    },
  };
}

export function encodeOpenAIResponseStream(response: OpenAIResponseObject): string {
  const message = response.output.find((item) => item.type === "message");
  if (!message) {
    const terminalEvents = [
      openAIEvent("response.created", {
        type: "response.created",
        response: { id: response.id, object: "response", status: "in_progress" },
      }),
      openAIEvent(response.status === "failed" ? "response.failed" : "response.completed", {
        type: response.status === "failed" ? "response.failed" : "response.completed",
        response: { id: response.id, object: "response", status: response.status },
      }),
      openAIDone(),
    ];
    return terminalEvents.join("");
  }
  const messageId = message.id;
  const text = extractMessageText(message);
  const chunks = splitText(text);

  const events = [
    openAIEvent("response.created", {
      type: "response.created",
      response: { id: response.id, object: "response", status: "in_progress" },
    }),
    openAIEvent("response.in_progress", {
      type: "response.in_progress",
      response: { id: response.id, status: "in_progress" },
    }),
    openAIEvent("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: messageId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      },
    }),
    openAIEvent("response.content_part.added", {
      type: "response.content_part.added",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }),
    ...chunks.map((chunk) =>
      openAIEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta: chunk,
      })
    ),
    openAIEvent("response.output_text.done", {
      type: "response.output_text.done",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      text,
    }),
    openAIEvent("response.content_part.done", {
      type: "response.content_part.done",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text, annotations: [] },
    }),
    openAIEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: message,
    }),
    openAIEvent(response.status === "failed" ? "response.failed" : "response.completed", {
      type: response.status === "failed" ? "response.failed" : "response.completed",
      response: { id: response.id, object: "response", status: response.status },
    }),
    openAIDone(),
  ];

  return events.join("");
}

function buildOutputItems(
  request: OpenAIResponseCreateRequest,
  scenario: ScenarioName,
  factory: IdFactory
): OpenAIResponseOutputItem[] {
  if (scenario === "tool_call") {
    return [buildFunctionCallOutput(factory, firstToolName(request.tools))];
  }

  if (scenario === "parallel_tools") {
    const names = toolNames(request.tools);
    const selectedNames = names.length > 1 ? names : ["get_order", "get_weather"];
    return selectedNames.slice(0, 4).map((name) => buildFunctionCallOutput(factory, name));
  }

  if (scenario === "tool_result") {
    return [
      buildMessageOutput(
        factory,
        `The mock tool result was processed successfully: ${extractToolResultText(request.input)}`
      ),
    ];
  }

  if (scenario === "structured_json") {
    return [buildMessageOutput(factory, '{"name":"UltraWidget","price":19.99,"currency":"USD"}')];
  }

  if (scenario === "refusal") {
    return [
      {
        id: factory.next("message", "openai.responses.output"),
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "refusal", refusal: "I cannot comply with this mock request." }],
      },
    ];
  }

  if (scenario === "failed" || scenario === "cancelled") {
    return [];
  }

  return [
    buildMessageOutput(
      factory,
      scenario === "reasoning"
        ? "The mock response includes deterministic reasoning metadata."
        : "The agent harness protocol upgrade is on track across all provider mocks."
    ),
  ];
}

function buildMessageOutput(factory: IdFactory, text: string): OpenAIResponseOutputItem {
  return {
    id: factory.next("message", "openai.responses.output"),
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function buildFunctionCallOutput(factory: IdFactory, name: string): OpenAIResponseOutputItem {
  return {
    id: factory.next("functionCall", "openai.responses.output"),
    type: "function_call",
    status: "completed",
    call_id: factory.next("call", `openai.responses.${name}`),
    name,
    arguments: JSON.stringify(buildToolArguments(name)),
  };
}

function buildToolArguments(name: string): Record<string, unknown> {
  if (name.includes("weather")) {
    return { city: "Tokyo" };
  }

  if (name.includes("order")) {
    return { order_id: "A100" };
  }

  return { query: "mock" };
}

function normalizeInputItems(input: unknown, factory: IdFactory): unknown[] {
  if (Array.isArray(input)) {
    return input.map((item) => addInputId(item, factory));
  }

  if (typeof input === "string") {
    return [
      {
        id: factory.next("message", "openai.responses.input"),
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: input }],
      },
    ];
  }

  if (input && isRecord(input)) {
    return [addInputId(input, factory)];
  }

  return [
    {
      id: factory.next("message", "openai.responses.input"),
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello from the mock input." }],
    },
  ];
}

function addInputId(input: unknown, factory: IdFactory): unknown {
  if (!isRecord(input) || typeof input.id === "string") {
    return input;
  }

  return {
    ...input,
    id: factory.next("message", "openai.responses.input"),
  };
}

function statusForScenario(
  scenario: ScenarioName,
  request: OpenAIResponseCreateRequest
): OpenAIResponseObject["status"] {
  if (scenario === "failed") {
    return "failed";
  }

  if (scenario === "cancelled") {
    return "cancelled";
  }

  if (scenario === "background" || request.background) {
    return "queued";
  }

  return "completed";
}

function firstToolName(tools: Array<Record<string, unknown>> | undefined): string {
  return toolNames(tools)[0] || "get_order";
}

function toolNames(tools: Array<Record<string, unknown>> | undefined): string[] {
  if (!tools) {
    return [];
  }

  return tools
    .map((tool) => {
      if (typeof tool.name === "string") {
        return tool.name;
      }

      if (isRecord(tool.function) && typeof tool.function.name === "string") {
        return tool.function.name;
      }

      return undefined;
    })
    .filter((name): name is string => Boolean(name));
}

function extractToolResultText(input: unknown): string {
  const results: string[] = [];

  visit(input, (value) => {
    if (!isRecord(value)) {
      return;
    }

    if (typeof value.output === "string") {
      results.push(value.output);
    }

    if (typeof value.content === "string" && value.type === "tool_result") {
      results.push(value.content);
    }
  });

  return results[0] || "{}";
}

function extractOutputText(output: OpenAIResponseOutputItem[]): string {
  return output.map((item) => (item.type === "message" ? extractMessageText(item) : item.arguments)).join(" ");
}

function extractMessageText(message: Extract<OpenAIResponseOutputItem, { type: "message" }>): string {
  return message.content
    .map((content) => ("text" in content ? content.text : content.refusal))
    .join(" ");
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
  return buildOpenAIError(400, issue.message, issue.param || undefined);
}

function visit(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value);

  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, visitor));
    return;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((item) => visit(item, visitor));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

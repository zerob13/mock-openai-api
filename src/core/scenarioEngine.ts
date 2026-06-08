export type ProviderName = "openai" | "anthropic" | "gemini";

export type ScenarioName =
  | "simple_text"
  | "stream_text"
  | "tool_call"
  | "parallel_tools"
  | "tool_result"
  | "structured_json"
  | "vision"
  | "multimodal_audio"
  | "multimodal_video"
  | "file_reference"
  | "reasoning"
  | "thinking"
  | "background"
  | "pause_turn"
  | "cancelled"
  | "failed"
  | "refusal"
  | "safety_block"
  | "rate_limit"
  | "invalid_request"
  | "invalid_tool_args";

export type ScenarioInput = {
  provider: ProviderName;
  endpoint: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
  model?: string;
};

export type ScenarioSelection = {
  provider: ProviderName;
  scenario: ScenarioName;
  seed: string;
  latencyMs: number;
  streamChunkMs: number;
  forcedError?: number;
};

const SCENARIOS = new Set<ScenarioName>([
  "simple_text",
  "stream_text",
  "tool_call",
  "parallel_tools",
  "tool_result",
  "structured_json",
  "vision",
  "multimodal_audio",
  "multimodal_video",
  "file_reference",
  "reasoning",
  "thinking",
  "background",
  "pause_turn",
  "cancelled",
  "failed",
  "refusal",
  "safety_block",
  "rate_limit",
  "invalid_request",
  "invalid_tool_args",
]);

const ERROR_SCENARIOS: Record<number, ScenarioName> = {
  400: "invalid_request",
  409: "failed",
  429: "rate_limit",
  500: "failed",
  529: "rate_limit",
};

const MAX_MOCK_DELAY_MS = 30_000;

function clampDelay(value: number): number {
  return Math.min(value, MAX_MOCK_DELAY_MS);
}

export function selectScenario(input: ScenarioInput): ScenarioSelection {
  const forcedError = readNumberControl(input, "x-mock-error", "mock_error");
  const seed = readStringControl(input, "x-mock-seed", "mock_seed") || "default";
  const latencyMs = clampDelay(readNumberControl(input, "x-mock-latency-ms", "mock_latency_ms") || 0);
  const streamChunkMs = clampDelay(readNumberControl(input, "x-mock-stream-chunk-ms", "mock_stream_chunk_ms") || 0);

  if (forcedError !== undefined) {
    return {
      provider: input.provider,
      scenario: ERROR_SCENARIOS[forcedError] || "failed",
      seed,
      latencyMs,
      streamChunkMs,
      forcedError,
    };
  }

  const explicitScenario = readScenarioControl(input);
  if (explicitScenario) {
    return {
      provider: input.provider,
      scenario: explicitScenario,
      seed,
      latencyMs,
      streamChunkMs,
    };
  }

  return {
    provider: input.provider,
    scenario: inferScenario(input),
    seed,
    latencyMs,
    streamChunkMs,
  };
}

export function isScenarioName(value: unknown): value is ScenarioName {
  return typeof value === "string" && SCENARIOS.has(value as ScenarioName);
}

function inferScenario(input: ScenarioInput): ScenarioName {
  const body = input.body;
  const model = (input.model || readBodyString(body, "model") || "").toLowerCase();
  const isStreaming = readBodyBoolean(body, "stream");

  if (containsToolResult(body)) {
    return "tool_result";
  }

  if (containsParallelTools(body)) {
    return "parallel_tools";
  }

  if (containsToolDeclaration(body)) {
    return "tool_call";
  }

  if (containsStructuredOutputRequest(body)) {
    return "structured_json";
  }

  if (isStreaming) {
    return "stream_text";
  }

  const multimodal = inferMultimodalScenario(body);
  if (multimodal) {
    return multimodal;
  }

  if (
    readBodyBoolean(body, "background") ||
    readBooleanControl(input, "x-mock-background", "mock_background")
  ) {
    return "background";
  }

  if (model.includes("thinking")) {
    return "thinking";
  }

  if (model.includes("reasoning")) {
    return "reasoning";
  }

  if (model.includes("json")) {
    return "structured_json";
  }

  if (model.includes("refusal")) {
    return "refusal";
  }

  if (model.includes("safety")) {
    return "safety_block";
  }

  return "simple_text";
}

function readScenarioControl(input: ScenarioInput): ScenarioName | undefined {
  const value =
    readHeader(input.headers, "x-mock-scenario") ||
    readQueryString(input.query, "mock_scenario") ||
    readBodyString(input.body, "mock_scenario");

  return isScenarioName(value) ? value : undefined;
}

function readStringControl(
  input: ScenarioInput,
  headerName: string,
  queryName: string
): string | undefined {
  return (
    readHeader(input.headers, headerName) ||
    readQueryString(input.query, queryName) ||
    readBodyString(input.body, queryName)
  );
}

function readNumberControl(
  input: ScenarioInput,
  headerName: string,
  queryName: string
): number | undefined {
  const value =
    readHeader(input.headers, headerName) ||
    readQueryString(input.query, queryName) ||
    readBodyString(input.body, queryName);
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function readBooleanControl(input: ScenarioInput, headerName: string, queryName: string): boolean {
  const value =
    readHeader(input.headers, headerName) ||
    readQueryString(input.query, queryName) ||
    readBodyString(input.body, queryName);

  return parseBoolean(value);
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;

  return Array.isArray(value) ? value[0] : value;
}

function readQueryString(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function readBodyString(body: unknown, name: string): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const value = body[name];
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function readBodyBoolean(body: unknown, name: string): boolean {
  if (!isRecord(body)) {
    return false;
  }

  return parseBoolean(body[name]);
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function containsToolResult(value: unknown): boolean {
  return walk(value, (entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    return (
      entry.type === "function_call_output" ||
      entry.type === "computer_call_output" ||
      entry.type === "tool_result" ||
      isRecord(entry.functionResponse)
    );
  });
}

function containsParallelTools(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.parallel_tool_calls === true || value.parallelToolCalls === true) {
    return containsToolDeclaration(value);
  }

  if (Array.isArray(value.tools) && value.tools.length > 1) {
    return true;
  }

  return walk(value.tools, (entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.functionDeclarations)) {
      return false;
    }

    return entry.functionDeclarations.length > 1;
  });
}

function containsToolDeclaration(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (Array.isArray(value.tools) && value.tools.length > 0) {
    return true;
  }

  if (Array.isArray(value.functions) && value.functions.length > 0) {
    return true;
  }

  return walk(value, (entry) => {
    return isRecord(entry) && Array.isArray(entry.functionDeclarations) && entry.functionDeclarations.length > 0;
  });
}

function containsStructuredOutputRequest(value: unknown): boolean {
  return walk(value, (entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    if (entry.type === "json_schema" || entry.type === "json_object") {
      return true;
    }

    if (entry.responseMimeType === "application/json" || entry.responseMimeType === "text/x.enum") {
      return true;
    }

    return Boolean(entry.responseSchema || entry.json_schema);
  });
}

function inferMultimodalScenario(value: unknown): ScenarioName | undefined {
  let scenario: ScenarioName | undefined;

  walk(value, (entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const mimeType =
      readRecordString(entry, "mimeType") ||
      readRecordString(entry, "media_type") ||
      readRecordString(entry, "mime_type");

    if (
      entry.type === "input_audio" ||
      entry.input_audio ||
      (mimeType && mimeType.startsWith("audio/"))
    ) {
      scenario = "multimodal_audio";
      return true;
    }

    if (entry.type === "input_video" || (mimeType && mimeType.startsWith("video/"))) {
      scenario = "multimodal_video";
      return true;
    }

    if (
      entry.type === "input_image" ||
      entry.type === "image" ||
      entry.image_url ||
      (mimeType && mimeType.startsWith("image/"))
    ) {
      scenario = "vision";
      return true;
    }

    if (
      entry.type === "input_file" ||
      entry.type === "document" ||
      entry.file_id ||
      entry.fileData ||
      entry.file_data
    ) {
      scenario = "file_reference";
      return true;
    }

    return false;
  });

  return scenario;
}

function readRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function walk(value: unknown, predicate: (entry: unknown) => boolean): boolean {
  if (predicate(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => walk(entry, predicate));
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => walk(entry, predicate));
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

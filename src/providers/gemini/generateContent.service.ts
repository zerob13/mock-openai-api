import { buildGeminiError, ProviderError } from "../../core/errors/providerErrors";
import { IdFactory } from "../../core/state/idFactory";
import { ScenarioName, ScenarioSelection } from "../../core/scenarioEngine";
import { geminiData } from "../../core/sse/geminiSse";
import { estimateTokens } from "../../core/usage/tokenEstimator";
import { buildGeminiUsage } from "../../core/usage/usageBuilder";
import {
  validateGeminiCountTokensRequest,
  validateGeminiGenerateContentRequest,
} from "../../core/validation/geminiSchemas";

export type GeminiGenerateContentRequest = {
  contents?: GeminiContent[];
  systemInstruction?: GeminiContent;
  tools?: GeminiTool[];
  toolConfig?: Record<string, unknown>;
  safetySettings?: unknown[];
  generationConfig?: GeminiGenerationConfig;
  cachedContent?: string;
  serviceTier?: string;
  store?: boolean;
};

export type GeminiContent = {
  role?: "user" | "model";
  parts: GeminiPart[];
};

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType?: string; fileUri: string } }
  | { functionCall: { id?: string; name: string; args: Record<string, unknown> } }
  | { functionResponse: { id?: string; name: string; response: Record<string, unknown> } }
  | { executableCode: { language: string; code: string } }
  | { codeExecutionResult: { outcome: string; output: string } };

export type GeminiTool = {
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parameters?: object;
    response?: object;
  }>;
  codeExecution?: object;
  googleSearch?: object;
};

export type GeminiGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: "text/plain" | "application/json" | "text/x.enum";
  responseSchema?: Record<string, unknown>;
  thinkingConfig?: {
    thinkingBudget?: number;
    includeThoughts?: boolean;
  };
};

export type GeminiCandidate = {
  content: GeminiContent;
  finishReason?: "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER";
  safetyRatings?: unknown[];
  index?: number;
  citationMetadata?: object;
  groundingMetadata?: object;
};

export type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: object;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    promptTokensDetails?: unknown[];
    candidatesTokensDetails?: unknown[];
  };
  modelVersion?: string;
  responseId?: string;
};

export type GeminiCountTokensRequest = {
  contents?: GeminiContent[];
  generateContentRequest?: GeminiGenerateContentRequest;
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

const seededFactories = new Map<string, IdFactory>();
const processFactory = new IdFactory();

export function generateGeminiContent(
  model: string,
  request: GeminiGenerateContentRequest,
  selection: ScenarioSelection
): ServiceResult<GeminiGenerateContentResponse> {
  const validationError = validateGenerateContentRequest(request);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const functionResponseError = validateFunctionResponseIds(request);
  if (functionResponseError) {
    return { ok: false, error: functionResponseError };
  }

  if (selection.scenario === "invalid_request") {
    return { ok: false, error: buildGeminiError(400, "Invalid mock request scenario.") };
  }

  if (selection.scenario === "rate_limit") {
    return { ok: false, error: buildGeminiError(429, "Mock rate limit exceeded.") };
  }

  if (selection.scenario === "invalid_tool_args") {
    return { ok: false, error: buildGeminiError(400, "Invalid mock tool arguments.") };
  }

  const scenario = refineScenarioFromRequest(request, selection.scenario);
  const factory = getIdFactory(selection.seed);
  const parts = buildResponseParts(request, scenario, factory);
  const finishReason = scenario === "safety_block" || scenario === "refusal" ? "SAFETY" : "STOP";
  const responseId = factory.next("gemini", "gemini.generate");
  const groundingMetadata = hasGoogleSearchTool(request)
    ? {
        groundingChunks: [{ web: { title: "Mock Search Result", uri: "mock://search/result" } }],
        groundingSupports: [{ segment: { text: "mock search result" }, groundingChunkIndices: [0] }],
      }
    : undefined;
  const response: GeminiGenerateContentResponse = {
    candidates: [
      {
        content: {
          role: "model",
          parts,
        },
        finishReason,
        index: 0,
        safetyRatings: safetyRatings(finishReason),
        groundingMetadata,
      },
    ],
    usageMetadata: buildGeminiUsage(request, parts),
    modelVersion: cleanModelName(model),
    responseId,
  };

  if (scenario === "safety_block" || scenario === "refusal") {
    response.promptFeedback = {
      blockReason: "SAFETY",
      safetyRatings: safetyRatings("SAFETY"),
    };
  }

  return { ok: true, value: response };
}

export function countGeminiTokens(request: GeminiCountTokensRequest): ServiceResult<{ totalTokens: number }> {
  const validationResult = validateGeminiCountTokensRequest(request);

  if (!validationResult.ok) {
    return { ok: false, error: buildGeminiError(400, validationResult.issue.message) };
  }

  const payload = request.generateContentRequest || { contents: request.contents };
  return {
    ok: true,
    value: {
      totalTokens: estimateTokens(payload),
    },
  };
}

export function encodeGeminiGenerateContentStream(response: GeminiGenerateContentResponse): string {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content.parts || [];
  const functionParts = parts.filter((part) => "functionCall" in part);

  if (functionParts.length > 0) {
    return geminiData({
      candidates: [
        {
          content: { role: "model", parts: functionParts },
          index: 0,
          finishReason: "STOP",
        },
      ],
      responseId: response.responseId,
    });
  }

  const text = parts.map((part) => ("text" in part ? part.text : "")).join("");
  const chunks = splitText(text);
  const encoded = chunks
    .map((chunk, index) =>
      geminiData({
        candidates: [
          {
            content: { role: "model", parts: [{ text: chunk }] },
            index: 0,
            finishReason: index === chunks.length - 1 ? candidate?.finishReason || "STOP" : undefined,
            safetyRatings: index === chunks.length - 1 ? candidate?.safetyRatings || [] : undefined,
          },
        ],
        usageMetadata: index === chunks.length - 1 ? response.usageMetadata : undefined,
        modelVersion: index === chunks.length - 1 ? response.modelVersion : undefined,
        responseId: index === chunks.length - 1 ? response.responseId : undefined,
      })
    )
    .join("");

  return encoded;
}

function validateGenerateContentRequest(
  request: GeminiGenerateContentRequest
): ProviderError | undefined {
  const result = validateGeminiGenerateContentRequest(request);
  return result.ok ? undefined : buildGeminiError(400, result.issue.message);
}

function refineScenarioFromRequest(
  request: GeminiGenerateContentRequest,
  scenario: ScenarioName
): ScenarioName {
  if (containsFunctionResponse(request)) {
    return "tool_result";
  }

  if (request.generationConfig?.responseMimeType === "application/json" || request.generationConfig?.responseSchema) {
    return "structured_json";
  }

  if (request.generationConfig?.responseMimeType === "text/x.enum") {
    return "structured_json";
  }

  if (scenario === "simple_text" && countFunctionDeclarations(request.tools) > 1) {
    return "parallel_tools";
  }

  if (scenario === "simple_text" && countFunctionDeclarations(request.tools) > 0) {
    return "tool_call";
  }

  return scenario;
}

function buildResponseParts(
  request: GeminiGenerateContentRequest,
  scenario: ScenarioName,
  factory: IdFactory
): GeminiPart[] {
  if (hasCodeExecutionTool(request)) {
    return [
      { executableCode: { language: "PYTHON", code: 'print("mock code execution")' } },
      { codeExecutionResult: { outcome: "OUTCOME_OK", output: "mock code execution\n" } },
    ];
  }

  if (hasGoogleSearchTool(request)) {
    return [{ text: "The mock Gemini model returned a grounded search response." }];
  }

  if (scenario === "tool_call") {
    return [buildFunctionCallPart(factory, firstFunctionName(request.tools))];
  }

  if (scenario === "parallel_tools") {
    const names = functionNames(request.tools);
    const selectedNames = names.length > 1 ? names : ["get_order", "get_weather"];
    return selectedNames.slice(0, 4).map((name) => buildFunctionCallPart(factory, name));
  }

  if (scenario === "tool_result") {
    return [{ text: `The function response was processed: ${extractFunctionResponse(request)}` }];
  }

  if (scenario === "structured_json") {
    if (request.generationConfig?.responseMimeType === "text/x.enum") {
      return [{ text: firstEnumValue(request.generationConfig.responseSchema) || "positive" }];
    }

    return [{ text: '{"name":"UltraWidget","price":19.99,"currency":"USD"}' }];
  }

  if (scenario === "safety_block" || scenario === "refusal") {
    return [{ text: "The mock request was blocked by deterministic safety controls." }];
  }

  if (scenario === "vision") {
    return [{ text: "The mock Gemini model inspected the image input." }];
  }

  if (scenario === "multimodal_audio") {
    return [{ text: "The mock Gemini model acknowledged the audio input." }];
  }

  if (scenario === "multimodal_video") {
    return [{ text: "The mock Gemini model acknowledged the video input." }];
  }

  if (scenario === "file_reference") {
    return [{ text: "The mock Gemini model acknowledged the file reference." }];
  }

  return [{ text: "Hello from Gemini mock." }];
}

function buildFunctionCallPart(factory: IdFactory, name: string): GeminiPart {
  return {
    functionCall: {
      id: factory.next("functionCall", `gemini.generate.${name}`),
      name,
      args: functionArgs(name),
    },
  };
}

function functionArgs(name: string): Record<string, unknown> {
  if (name.includes("weather")) {
    return { city: "Tokyo" };
  }

  return { order_id: "A100" };
}

function firstFunctionName(tools: GeminiTool[] | undefined): string {
  return functionNames(tools)[0] || "get_order";
}

function functionNames(tools: GeminiTool[] | undefined): string[] {
  return (tools || []).flatMap((tool) =>
    (tool.functionDeclarations || []).map((declaration) => declaration.name)
  );
}

function countFunctionDeclarations(tools: GeminiTool[] | undefined): number {
  return functionNames(tools).length;
}

function containsFunctionResponse(request: GeminiGenerateContentRequest): boolean {
  return Boolean(
    request.contents?.some((content) =>
      content.parts.some((part) => "functionResponse" in part && Boolean(part.functionResponse))
    )
  );
}

function collectFunctionCallIds(request: GeminiGenerateContentRequest): Set<string> {
  const ids = new Set<string>();

  for (const content of request.contents || []) {
    for (const part of content.parts || []) {
      if ("functionCall" in part && part.functionCall.id) {
        ids.add(part.functionCall.id);
      }
    }
  }

  return ids;
}

function validateFunctionResponseIds(request: GeminiGenerateContentRequest): ProviderError | undefined {
  const functionCallIds = collectFunctionCallIds(request);
  const hasFunctionResponseId = (request.contents || []).some((content) =>
    (content.parts || []).some(
      (part) => "functionResponse" in part && Boolean(part.functionResponse?.id)
    )
  );

  if (functionCallIds.size === 0) {
    if (hasFunctionResponseId) {
      return buildGeminiError(400, "functionResponse id does not match a previous functionCall id");
    }
    return undefined;
  }

  for (const content of request.contents || []) {
    for (const part of content.parts || []) {
      if ("functionResponse" in part && part.functionResponse.id && !functionCallIds.has(part.functionResponse.id)) {
        return buildGeminiError(400, "functionResponse id does not match a previous functionCall id");
      }
    }
  }

  return undefined;
}

function hasCodeExecutionTool(request: GeminiGenerateContentRequest): boolean {
  return Boolean(request.tools?.some((tool) => tool.codeExecution));
}

function hasGoogleSearchTool(request: GeminiGenerateContentRequest): boolean {
  return Boolean(request.tools?.some((tool) => tool.googleSearch));
}

function extractFunctionResponse(request: GeminiGenerateContentRequest): string {
  for (const content of request.contents || []) {
    const part = content.parts.find((item) => "functionResponse" in item);
    if (part && "functionResponse" in part) {
      return JSON.stringify(part.functionResponse.response);
    }
  }

  return "{}";
}

function firstEnumValue(schema: Record<string, unknown> | undefined): string | undefined {
  const values = schema?.enum;
  return Array.isArray(values) && typeof values[0] === "string" ? values[0] : undefined;
}

function safetyRatings(finishReason: string): unknown[] {
  const probability = finishReason === "SAFETY" ? "HIGH" : "NEGLIGIBLE";

  return [
    { category: "HARM_CATEGORY_HATE_SPEECH", probability },
    { category: "HARM_CATEGORY_HARASSMENT", probability: "NEGLIGIBLE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "NEGLIGIBLE" },
  ];
}

function splitText(text: string): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += 3) {
    chunks.push(words.slice(index, index + 3).join(" ") + (index + 3 < words.length ? " " : ""));
  }

  return chunks.length > 0 ? chunks : [text];
}

function cleanModelName(model: string): string {
  return model.replace(/^models\//, "");
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

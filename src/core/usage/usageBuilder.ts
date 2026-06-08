import { estimateTokens } from "./tokenEstimator";

export type OpenAIResponsesUsage = {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
};

export type OpenAIChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: { reasoning_tokens: number };
};

export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type GeminiUsageMetadata = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
};

export function buildOpenAIResponsesUsage(
  input: unknown,
  output: unknown,
  reasoningTokens = 0,
  cachedTokens = 0
): OpenAIResponsesUsage {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);
  const safeReasoningTokens = Math.max(0, reasoningTokens);
  const safeCachedTokens = Math.max(0, cachedTokens);

  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: safeCachedTokens },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: safeReasoningTokens },
    total_tokens: inputTokens + outputTokens,
  };
}

export function buildOpenAIChatUsage(
  input: unknown,
  output: unknown,
  reasoningTokens = 0
): OpenAIChatUsage {
  const promptTokens = estimateTokens(input);
  const completionTokens = estimateTokens(output);
  const safeReasoningTokens = Math.max(0, reasoningTokens);
  const usage: OpenAIChatUsage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };

  if (safeReasoningTokens > 0) {
    usage.completion_tokens_details = { reasoning_tokens: safeReasoningTokens };
  }

  return usage;
}

export function buildAnthropicUsage(input: unknown, output: unknown): AnthropicUsage {
  return {
    input_tokens: estimateTokens(input),
    output_tokens: estimateTokens(output),
  };
}

export function buildGeminiUsage(input: unknown, output: unknown): GeminiUsageMetadata {
  const promptTokenCount = estimateTokens(input);
  const candidatesTokenCount = estimateTokens(output);

  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
  };
}

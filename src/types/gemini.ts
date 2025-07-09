// Google Gemini API types
export interface GeminiModel {
  name: string;
  version: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
  temperature: number;
  topP: number;
  topK: number;
}

export interface GeminiModelsResponse {
  models: GeminiModel[];
}

export interface GeminiContent {
  parts: GeminiPart[];
  role?: string;
}

export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiThinkingConfig {
  thinkingBudget?: number;
}

export interface GeminiGenerationConfig {
  stopSequences?: string[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  thinkingConfig?: GeminiThinkingConfig;
}

export interface GeminiSafetySettings {
  category: string;
  threshold: string;
}

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  tools?: any[];
  safetySettings?: GeminiSafetySettings[];
  generationConfig?: GeminiGenerationConfig;
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason: string;
  index: number;
  safetyRatings: GeminiSafetyRating[];
}

export interface GeminiSafetyRating {
  category: string;
  probability: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[];
  usageMetadata: GeminiUsageMetadata;
}

export interface GeminiStreamResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

export interface GeminiErrorResponse {
  error: {
    code: number;
    message: string;
    status: string;
  };
}
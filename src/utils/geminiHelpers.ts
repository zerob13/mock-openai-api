import { geminiMockModels } from '../data/geminiMockData';

/**
 * Get current timestamp
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Calculate approximate token count (rough estimation: 1 token ≈ 4 characters)
 */
export function calculateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generate unique model name for Gemini API
 */
export function generateModelName(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `models/gemini-${timestamp}-${random}`;
}

/**
 * Find model by ID
 */
export function findGeminiModelById(modelId: string) {
  // Remove 'models/' prefix if present
  const cleanModelId = modelId.replace('models/', '');
  return geminiMockModels.find(model => model.id === cleanModelId);
}

/**
 * Format error response for Gemini API
 */
export function formatGeminiErrorResponse(message: string, code: number = 400, status: string = 'INVALID_ARGUMENT') {
  return {
    error: {
      code,
      message,
      status
    }
  };
}

/**
 * Format streaming response for Gemini API
 */
export function formatGeminiStreamChunk(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Generate content ID for Gemini responses
 */
export function generateContentId(): string {
  return `content_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
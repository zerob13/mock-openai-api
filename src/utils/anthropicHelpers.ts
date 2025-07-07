import { MockModel } from "../types/index";
import { anthropicMockModels } from "../data/anthropicMockData";
import { StreamingEvent } from "../types/anthropic";

/**
 * Get current timestamp
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate message ID
 */
export function generateMessageId(): string {
  return `msg_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate tokens
 */
export function calculateTokens(text: string): number {
  return text.length;
}

/**
 * Find model by ID
 */
export function findModelById(modelId: string): MockModel | undefined {
  return anthropicMockModels.find(model => model.id === modelId);
}

/**
 * Format error response
 */
export function formatErrorResponse(message: string): any {
  return {
    error: {
      message: message,
      type: "invalid_request_error",
    },
    type: "error"
  };
}

export function SSEMessageFormatter(event: StreamingEvent, data: any): string {
  return `event: ${event}\n` +
                     `data: ${JSON.stringify(data)}\n\n`
}
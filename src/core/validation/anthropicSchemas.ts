export type ValidationIssue = {
  message: string;
  param?: string | null;
};

export type ValidationResult = { ok: true } | { ok: false; issue: ValidationIssue };

const MESSAGE_ROLES = new Set(["user", "assistant"]);
const CONTENT_BLOCK_TYPES = new Set([
  "text",
  "image",
  "document",
  "tool_result",
  "tool_use",
  "thinking",
  "redacted_thinking",
]);
const THINKING_TYPES = new Set(["enabled", "adaptive", "disabled"]);

export function validateAnthropicMessageRequest(request: unknown): ValidationResult {
  if (
    !isRecord(request) ||
    typeof request.model !== "string" ||
    request.model.trim().length === 0 ||
    !Array.isArray(request.messages) ||
    request.max_tokens === undefined
  ) {
    return invalid("Missing required fields: model, messages, or max_tokens");
  }

  if (!Number.isInteger(request.max_tokens) || Number(request.max_tokens) <= 0) {
    return { ok: false, issue: { message: "max_tokens must be a positive integer", param: "max_tokens" } };
  }

  const commonIssue = validateAnthropicCommonRequest(request, true);
  if (commonIssue) {
    return { ok: false, issue: commonIssue };
  }

  return { ok: true };
}

export function validateAnthropicCountTokensRequest(request: unknown): ValidationResult {
  if (
    !isRecord(request) ||
    typeof request.model !== "string" ||
    request.model.trim().length === 0 ||
    !Array.isArray(request.messages)
  ) {
    return invalid("Missing required fields: model or messages");
  }

  const commonIssue = validateAnthropicCommonRequest(request, false);
  if (commonIssue) {
    return { ok: false, issue: commonIssue };
  }

  return { ok: true };
}

function validateAnthropicCommonRequest(
  request: Record<string, unknown>,
  validateThinking: boolean
): ValidationIssue | undefined {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return { message: "messages must be a non-empty array", param: "messages" };
  }

  for (const [index, message] of request.messages.entries()) {
    if (!isRecord(message) || typeof message.role !== "string" || !MESSAGE_ROLES.has(message.role)) {
      return { message: "messages contains an invalid role", param: `messages.${index}.role` };
    }

    if (typeof message.content !== "string" && !Array.isArray(message.content)) {
      return { message: "message content must be a string or content block array", param: `messages.${index}.content` };
    }

    if (Array.isArray(message.content)) {
      const issue = validateContentBlocks(message.content, `messages.${index}.content`);
      if (issue) {
        return issue;
      }
    }
  }

  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools)) {
      return { message: "tools must be an array", param: "tools" };
    }

    for (const [index, tool] of request.tools.entries()) {
      if (!isRecord(tool) || typeof tool.name !== "string" || !isRecord(tool.input_schema)) {
        return { message: "tool requires name and input_schema", param: `tools.${index}` };
      }
    }
  }

  if (validateThinking && request.thinking !== undefined) {
    if (!isRecord(request.thinking) || typeof request.thinking.type !== "string" || !THINKING_TYPES.has(request.thinking.type)) {
      return { message: "thinking config has an invalid type", param: "thinking.type" };
    }

    if (
      request.thinking.type === "enabled" &&
      (!Number.isInteger(request.thinking.budget_tokens) || Number(request.thinking.budget_tokens) <= 0)
    ) {
      return { message: "enabled thinking requires positive budget_tokens", param: "thinking.budget_tokens" };
    }
  }

  return undefined;
}

function validateContentBlocks(blocks: unknown[], path: string): ValidationIssue | undefined {
  for (const [index, block] of blocks.entries()) {
    if (!isRecord(block) || typeof block.type !== "string" || !CONTENT_BLOCK_TYPES.has(block.type)) {
      return { message: "content block has an invalid type", param: `${path}.${index}.type` };
    }

    if (block.type === "text" && typeof block.text !== "string") {
      return { message: "text block requires text", param: `${path}.${index}.text` };
    }

    if ((block.type === "image" || block.type === "document") && !isRecord(block.source)) {
      return { message: `${block.type} block requires source`, param: `${path}.${index}.source` };
    }

    if (block.type === "tool_result" && typeof block.tool_use_id !== "string") {
      return { message: "tool_result block requires tool_use_id", param: `${path}.${index}.tool_use_id` };
    }

    if (
      block.type === "tool_use" &&
      (typeof block.id !== "string" || typeof block.name !== "string" || !isRecord(block.input))
    ) {
      return { message: "tool_use block requires id, name, and input", param: `${path}.${index}` };
    }

    if (block.type === "thinking" && typeof block.thinking !== "string") {
      return { message: "thinking block requires thinking", param: `${path}.${index}.thinking` };
    }

    if (block.type === "redacted_thinking" && typeof block.data !== "string") {
      return { message: "redacted_thinking block requires data", param: `${path}.${index}.data` };
    }
  }

  return undefined;
}

function invalid(message: string): ValidationResult {
  return { ok: false, issue: { message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

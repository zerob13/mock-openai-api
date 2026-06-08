export type ValidationIssue = {
  message: string;
  param?: string | null;
  code?: string;
};

export type ValidationResult = { ok: true } | { ok: false; issue: ValidationIssue };

const CHAT_ROLES = new Set(["developer", "system", "user", "assistant", "tool", "function"]);
const CHAT_PART_TYPES = new Set(["text", "image_url", "input_audio", "file", "refusal"]);
const RESPONSE_FORMAT_TYPES = new Set(["text", "json_object", "json_schema"]);
const TOOL_TYPES = new Set(["function", "custom"]);

export function validateOpenAIChatCompletionRequest(request: unknown): ValidationResult {
  if (!isRecord(request) || !request.model) {
    return missingParameter("model");
  }

  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return missingParameter("messages");
  }

  for (const [index, message] of request.messages.entries()) {
    if (!isRecord(message) || typeof message.role !== "string" || !CHAT_ROLES.has(message.role)) {
      return invalidRequest("messages contains an invalid role", `messages.${index}.role`);
    }

    const content = message.content;
    if (content !== undefined && content !== null && typeof content !== "string" && !Array.isArray(content)) {
      return invalidRequest("message content must be a string, null, or content part array", `messages.${index}.content`);
    }

    if (Array.isArray(content)) {
      const partIssue = validateOpenAIChatContentParts(content, `messages.${index}.content`);
      if (partIssue) {
        return { ok: false, issue: partIssue };
      }
    }
  }

  if (request.response_format !== undefined) {
    const responseFormatIssue = validateResponseFormat(request.response_format);
    if (responseFormatIssue) {
      return { ok: false, issue: responseFormatIssue };
    }
  }

  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools)) {
      return invalidRequest("tools must be an array", "tools");
    }

    for (const [index, tool] of request.tools.entries()) {
      const toolIssue = validateOpenAITool(tool, `tools.${index}`);
      if (toolIssue) {
        return { ok: false, issue: toolIssue };
      }
    }
  }

  return { ok: true };
}

export function validateOpenAIResponsesRequest(request: unknown): ValidationResult {
  if (!isRecord(request)) {
    return invalidRequest("request body must be an object");
  }

  if (request.input !== undefined && typeof request.input !== "string" && !Array.isArray(request.input) && !isRecord(request.input)) {
    return invalidRequest("input must be a string, object, or array", "input");
  }

  if (request.text !== undefined) {
    const text = request.text;
    if (!isRecord(text)) {
      return invalidRequest("text must be an object", "text");
    }

    if (text.format !== undefined) {
      const issue = validateResponseFormat(text.format);
      if (issue) {
        return { ok: false, issue };
      }
    }
  }

  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools)) {
      return invalidRequest("tools must be an array", "tools");
    }

    for (const [index, tool] of request.tools.entries()) {
      const issue = validateOpenAIResponseTool(tool, `tools.${index}`);
      if (issue) {
        return { ok: false, issue };
      }
    }
  }

  return { ok: true };
}

export function validateOpenAIEmbeddingsRequest(request: unknown): ValidationResult {
  if (!isRecord(request) || !request.model) {
    return missingParameter("model");
  }

  if (request.input === undefined) {
    return missingParameter("input");
  }

  if (
    typeof request.input !== "string" &&
    !Array.isArray(request.input)
  ) {
    return invalidRequest("input must be a string or array", "input");
  }

  if (request.dimensions !== undefined) {
    const dimensions = Number(request.dimensions);
    if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 2048) {
      return invalidRequest("dimensions must be an integer between 1 and 2048", "dimensions");
    }
  }

  if (
    request.encoding_format !== undefined &&
    request.encoding_format !== "float" &&
    request.encoding_format !== "base64"
  ) {
    return invalidRequest("encoding_format must be 'float' or 'base64'", "encoding_format");
  }

  return { ok: true };
}

function validateOpenAIChatContentParts(parts: unknown[], path: string): ValidationIssue | undefined {
  for (const [index, part] of parts.entries()) {
    if (!isRecord(part) || typeof part.type !== "string" || !CHAT_PART_TYPES.has(part.type)) {
      return {
        message: "message content part has an invalid type",
        param: `${path}.${index}.type`,
        code: "invalid_request",
      };
    }

    if (part.type === "text" && typeof part.text !== "string") {
      return { message: "text content part requires text", param: `${path}.${index}.text`, code: "invalid_request" };
    }

    if (part.type === "image_url" && part.image_url === undefined) {
      return { message: "image_url content part requires image_url", param: `${path}.${index}.image_url`, code: "invalid_request" };
    }

    if (part.type === "input_audio" && !isRecord(part.input_audio)) {
      return { message: "input_audio content part requires input_audio", param: `${path}.${index}.input_audio`, code: "invalid_request" };
    }

    if (part.type === "file" && !isRecord(part.file)) {
      return { message: "file content part requires file", param: `${path}.${index}.file`, code: "invalid_request" };
    }
  }

  return undefined;
}

function validateOpenAITool(tool: unknown, path: string): ValidationIssue | undefined {
  if (!isRecord(tool)) {
    return { message: "tool must be an object", param: path, code: "invalid_request" };
  }

  if (tool.type !== undefined && (typeof tool.type !== "string" || !TOOL_TYPES.has(tool.type))) {
    return { message: "tool has an invalid type", param: `${path}.type`, code: "invalid_request" };
  }

  if (tool.type === "function" && (!isRecord(tool.function) || typeof tool.function.name !== "string")) {
    return { message: "function tool requires function.name", param: `${path}.function.name`, code: "invalid_request" };
  }

  return undefined;
}

function validateOpenAIResponseTool(tool: unknown, path: string): ValidationIssue | undefined {
  if (!isRecord(tool) || typeof tool.type !== "string") {
    return { message: "tool requires a type", param: `${path}.type`, code: "invalid_request" };
  }

  if (tool.type === "function" && typeof tool.name !== "string") {
    return { message: "function tool requires name", param: `${path}.name`, code: "invalid_request" };
  }

  return undefined;
}

function validateResponseFormat(format: unknown): ValidationIssue | undefined {
  if (!isRecord(format) || typeof format.type !== "string" || !RESPONSE_FORMAT_TYPES.has(format.type)) {
    return { message: "response format has an invalid type", param: "response_format.type", code: "invalid_request" };
  }

  return undefined;
}

function missingParameter(param: string): ValidationResult {
  return {
    ok: false,
    issue: {
      message: `Missing required parameter: ${param}`,
      code: "missing_parameter",
    },
  };
}

function invalidRequest(message: string, param?: string): ValidationResult {
  return {
    ok: false,
    issue: {
      message,
      param: param || null,
      code: "invalid_request",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

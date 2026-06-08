export type ValidationIssue = {
  message: string;
  param?: string | null;
};

export type ValidationResult = { ok: true } | { ok: false; issue: ValidationIssue };

const CONTENT_ROLES = new Set(["user", "model"]);
const RESPONSE_MIME_TYPES = new Set(["text/plain", "application/json", "text/x.enum"]);

export function validateGeminiGenerateContentRequest(request: unknown): ValidationResult {
  if (!isRecord(request) || !Array.isArray(request.contents) || request.contents.length === 0) {
    return invalid("Request must contain at least one content item", "contents");
  }

  const contentIssue = validateGeminiContents(request.contents);
  if (contentIssue) {
    return { ok: false, issue: contentIssue };
  }

  const toolIssue = validateGeminiTools(request.tools);
  if (toolIssue) {
    return { ok: false, issue: toolIssue };
  }

  const generationConfigIssue = validateGeminiGenerationConfig(request.generationConfig);
  if (generationConfigIssue) {
    return { ok: false, issue: generationConfigIssue };
  }

  const idMismatchIssue = validateFunctionResponseIds(request.contents);
  if (idMismatchIssue) {
    return { ok: false, issue: idMismatchIssue };
  }

  return { ok: true };
}

export function validateGeminiCountTokensRequest(request: unknown): ValidationResult {
  if (!isRecord(request)) {
    return invalid("Request must contain at least one content item", "contents");
  }

  const payload = isRecord(request.generateContentRequest) ? request.generateContentRequest : { contents: request.contents };
  return validateGeminiGenerateContentRequest(payload);
}

function validateGeminiContents(contents: unknown[]): ValidationIssue | undefined {
  for (const [contentIndex, content] of contents.entries()) {
    if (!isRecord(content)) {
      return { message: "Each content item must be an object", param: `contents.${contentIndex}` };
    }

    if (content.role !== undefined && (typeof content.role !== "string" || !CONTENT_ROLES.has(content.role))) {
      return { message: "content role is invalid", param: `contents.${contentIndex}.role` };
    }

    if (!Array.isArray(content.parts) || content.parts.length === 0) {
      return { message: "Each content item must contain at least one part", param: `contents.${contentIndex}.parts` };
    }

    for (const [partIndex, part] of content.parts.entries()) {
      const issue = validateGeminiPart(part, `contents.${contentIndex}.parts.${partIndex}`);
      if (issue) {
        return issue;
      }
    }
  }

  return undefined;
}

function validateGeminiPart(part: unknown, path: string): ValidationIssue | undefined {
  if (!isRecord(part)) {
    return { message: "part must be an object", param: path };
  }

  const partFields = [
    "text",
    "inlineData",
    "fileData",
    "functionCall",
    "functionResponse",
    "executableCode",
    "codeExecutionResult",
  ].filter((field) => part[field] !== undefined);

  if (partFields.length !== 1) {
    return { message: "part must contain exactly one supported field", param: path };
  }

  if (part.text !== undefined && typeof part.text !== "string") {
    return { message: "text part requires string text", param: `${path}.text` };
  }

  if (part.inlineData !== undefined) {
    if (!isRecord(part.inlineData) || typeof part.inlineData.mimeType !== "string" || typeof part.inlineData.data !== "string") {
      return { message: "inlineData requires mimeType and data", param: `${path}.inlineData` };
    }
  }

  if (part.fileData !== undefined) {
    if (!isRecord(part.fileData) || typeof part.fileData.fileUri !== "string") {
      return { message: "fileData requires fileUri", param: `${path}.fileData.fileUri` };
    }
  }

  if (part.functionCall !== undefined) {
    if (!isRecord(part.functionCall) || typeof part.functionCall.name !== "string" || !isRecord(part.functionCall.args)) {
      return { message: "functionCall requires name and args", param: `${path}.functionCall` };
    }
  }

  if (part.functionResponse !== undefined) {
    if (!isRecord(part.functionResponse) || typeof part.functionResponse.name !== "string" || !isRecord(part.functionResponse.response)) {
      return { message: "functionResponse requires name and response", param: `${path}.functionResponse` };
    }
  }

  return undefined;
}

function validateGeminiTools(tools: unknown): ValidationIssue | undefined {
  if (tools === undefined) {
    return undefined;
  }

  if (!Array.isArray(tools)) {
    return { message: "tools must be an array", param: "tools" };
  }

  for (const [index, tool] of tools.entries()) {
    if (!isRecord(tool)) {
      return { message: "tool must be an object", param: `tools.${index}` };
    }

    if (tool.functionDeclarations !== undefined) {
      if (!Array.isArray(tool.functionDeclarations)) {
        return { message: "functionDeclarations must be an array", param: `tools.${index}.functionDeclarations` };
      }

      for (const [declarationIndex, declaration] of tool.functionDeclarations.entries()) {
        if (!isRecord(declaration) || typeof declaration.name !== "string") {
          return {
            message: "function declaration requires name",
            param: `tools.${index}.functionDeclarations.${declarationIndex}.name`,
          };
        }
      }
    }
  }

  return undefined;
}

function validateGeminiGenerationConfig(config: unknown): ValidationIssue | undefined {
  if (config === undefined) {
    return undefined;
  }

  if (!isRecord(config)) {
    return { message: "generationConfig must be an object", param: "generationConfig" };
  }

  if (
    config.responseMimeType !== undefined &&
    (typeof config.responseMimeType !== "string" || !RESPONSE_MIME_TYPES.has(config.responseMimeType))
  ) {
    return { message: "responseMimeType is invalid", param: "generationConfig.responseMimeType" };
  }

  return undefined;
}

function validateFunctionResponseIds(contents: unknown[]): ValidationIssue | undefined {
  const functionCallIds = new Set<string>();

  for (const content of contents) {
    if (!isRecord(content) || !Array.isArray(content.parts)) {
      continue;
    }

    for (const part of content.parts) {
      if (isRecord(part) && isRecord(part.functionCall) && typeof part.functionCall.id === "string") {
        functionCallIds.add(part.functionCall.id);
      }
    }
  }

  for (const [contentIndex, content] of contents.entries()) {
    if (!isRecord(content) || !Array.isArray(content.parts)) {
      continue;
    }

    for (const [partIndex, part] of content.parts.entries()) {
      if (
        isRecord(part) &&
        isRecord(part.functionResponse) &&
        typeof part.functionResponse.id === "string" &&
        functionCallIds.size > 0 &&
        !functionCallIds.has(part.functionResponse.id)
      ) {
        return {
          message: "functionResponse id does not match a previous functionCall id",
          param: `contents.${contentIndex}.parts.${partIndex}.functionResponse.id`,
        };
      }
    }
  }

  return undefined;
}

function invalid(message: string, param?: string): ValidationResult {
  return { ok: false, issue: { message, param: param || null } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

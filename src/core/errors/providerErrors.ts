import { ProviderName } from "../scenarioEngine";

export type InjectableErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 529;

export type ProviderError = {
  status: InjectableErrorStatus;
  body: unknown;
};

const ERROR_STATUSES = new Set<number>([400, 401, 403, 404, 409, 429, 500, 529]);

const DEFAULT_MESSAGES: Record<InjectableErrorStatus, string> = {
  400: "Invalid request.",
  401: "Authentication failed.",
  403: "Permission denied.",
  404: "Resource not found.",
  409: "Request conflicts with current resource state.",
  429: "Rate limit exceeded.",
  500: "Internal server error.",
  529: "Service overloaded.",
};

const OPENAI_TYPES: Record<InjectableErrorStatus, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  409: "conflict_error",
  429: "rate_limit_error",
  500: "server_error",
  529: "overloaded_error",
};

const OPENAI_CODES: Record<InjectableErrorStatus, string> = {
  400: "invalid_request",
  401: "invalid_api_key",
  403: "permission_denied",
  404: "not_found",
  409: "conflict",
  429: "rate_limit_exceeded",
  500: "internal_error",
  529: "overloaded",
};

const ANTHROPIC_TYPES: Record<InjectableErrorStatus, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  409: "conflict_error",
  429: "rate_limit_error",
  500: "api_error",
  529: "overloaded_error",
};

const GEMINI_STATUSES: Record<InjectableErrorStatus, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "ABORTED",
  429: "RESOURCE_EXHAUSTED",
  500: "INTERNAL",
  529: "UNAVAILABLE",
};

export function isInjectableErrorStatus(status: number): status is InjectableErrorStatus {
  return ERROR_STATUSES.has(status);
}

export function buildProviderError(
  provider: ProviderName,
  status: InjectableErrorStatus,
  message = DEFAULT_MESSAGES[status],
  param?: string
): ProviderError {
  if (provider === "openai") {
    return buildOpenAIError(status, message, param);
  }

  if (provider === "anthropic") {
    return buildAnthropicError(status, message);
  }

  return buildGeminiError(status, message);
}

export function buildOpenAIError(
  status: InjectableErrorStatus,
  message = DEFAULT_MESSAGES[status],
  param?: string
): ProviderError {
  return {
    status,
    body: {
      error: {
        message,
        type: OPENAI_TYPES[status],
        param: param || null,
        code: OPENAI_CODES[status],
      },
    },
  };
}

export function buildAnthropicError(
  status: InjectableErrorStatus,
  message = DEFAULT_MESSAGES[status]
): ProviderError {
  return {
    status,
    body: {
      type: "error",
      error: {
        type: ANTHROPIC_TYPES[status],
        message,
      },
    },
  };
}

export function buildGeminiError(
  status: InjectableErrorStatus,
  message = DEFAULT_MESSAGES[status]
): ProviderError {
  return {
    status,
    body: {
      error: {
        code: status,
        message,
        status: GEMINI_STATUSES[status],
      },
    },
  };
}

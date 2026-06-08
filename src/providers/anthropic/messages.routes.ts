import { Request, RequestHandler, Response, Router } from "express";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { ProviderError } from "../../core/errors/providerErrors";
import { readMockStreamChunkDelay } from "../../core/http/mockControls";
import { selectScenario } from "../../core/scenarioEngine";
import { ANTHROPIC_SSE_HEADERS } from "../../core/sse/anthropicSse";
import { sendEncodedSse } from "../../core/sse/streamWriter";
import {
  AnthropicMessageCreateRequest,
  countAnthropicMessageTokens,
  createAnthropicMessage,
  encodeAnthropicMessageStream,
  ServiceResult,
} from "./messages.service";

export const anthropicMessagesRouter: Router = Router();

anthropicMessagesRouter.post("/count_tokens", handleCountTokens as RequestHandler);
anthropicMessagesRouter.post("/", handleCreateMessage as RequestHandler);

export async function handleCreateMessage(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "anthropic",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  const request = req.body as AnthropicMessageCreateRequest;
  const result = createAnthropicMessage(request, selectAnthropicScenario(req));

  if (!result.ok) {
    return sendError(res, result.error);
  }

  if (request.stream) {
    await sendEncodedSse(
      res,
      ANTHROPIC_SSE_HEADERS,
      encodeAnthropicMessageStream(result.value),
      readMockStreamChunkDelay(req)
    );
    return;
  }

  res.json(result.value);
}

function handleCountTokens(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "anthropic",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  sendResult(res, countAnthropicMessageTokens(req.body as AnthropicMessageCreateRequest));
}

function selectAnthropicScenario(req: Request) {
  return selectScenario({
    provider: "anthropic",
    endpoint: req.path,
    method: req.method,
    headers: req.headers,
    query: req.query as Record<string, unknown>,
    body: req.body,
    model: typeof req.body?.model === "string" ? req.body.model : undefined,
  });
}

function sendResult<T>(res: Response, result: ServiceResult<T>) {
  if (!result.ok) {
    return sendError(res, result.error);
  }

  res.json(result.value);
}

function sendError(res: Response, error: ProviderError) {
  res.status(error.status).json(error.body);
}

export default anthropicMessagesRouter;

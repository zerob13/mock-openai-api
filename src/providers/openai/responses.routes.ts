import { Request, RequestHandler, Response, Router } from "express";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { ProviderError } from "../../core/errors/providerErrors";
import { readMockStreamChunkDelay } from "../../core/http/mockControls";
import { OPENAI_SSE_HEADERS } from "../../core/sse/openaiSse";
import { sendEncodedSse } from "../../core/sse/streamWriter";
import { selectScenario } from "../../core/scenarioEngine";
import {
  cancelOpenAIResponse,
  compactOpenAIResponse,
  countOpenAIResponseInputTokens,
  createOpenAIResponse,
  deleteOpenAIResponse,
  encodeOpenAIResponseStream,
  getOpenAIResponse,
  listOpenAIResponseInputItems,
  OpenAIResponseCreateRequest,
  ServiceResult,
} from "./responses.service";

export const openAIResponsesRouter: Router = Router();

openAIResponsesRouter.post("/input_tokens", handleInputTokens as RequestHandler);
openAIResponsesRouter.post("/compact", handleCompact as RequestHandler);
openAIResponsesRouter.post("/", handleCreateResponse as RequestHandler);
openAIResponsesRouter.get("/:response_id/input_items", handleInputItems as RequestHandler);
openAIResponsesRouter.post("/:response_id/cancel", handleCancelResponse as RequestHandler);
openAIResponsesRouter.get("/:response_id", handleGetResponse as RequestHandler);
openAIResponsesRouter.delete("/:response_id", handleDeleteResponse as RequestHandler);

async function handleCreateResponse(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  const request = req.body as OpenAIResponseCreateRequest;
  const selection = selectOpenAIScenario(req);
  const result = createOpenAIResponse(request, selection);

  if (!result.ok) {
    return sendError(res, result.error);
  }

  if (request.stream) {
    await sendEncodedSse(
      res,
      OPENAI_SSE_HEADERS,
      encodeOpenAIResponseStream(result.value.response),
      readMockStreamChunkDelay(req)
    );
    return;
  }

  res.json(result.value.response);
}

function handleGetResponse(req: Request, res: Response) {
  sendResult(res, getOpenAIResponse(req.params.response_id));
}

function handleDeleteResponse(req: Request, res: Response) {
  sendResult(res, deleteOpenAIResponse(req.params.response_id));
}

function handleCancelResponse(req: Request, res: Response) {
  sendResult(res, cancelOpenAIResponse(req.params.response_id));
}

function handleInputItems(req: Request, res: Response) {
  sendResult(res, listOpenAIResponseInputItems(req.params.response_id));
}

function handleInputTokens(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  res.json(countOpenAIResponseInputTokens(req.body));
}

function handleCompact(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  sendResult(res, compactOpenAIResponse(req.body as OpenAIResponseCreateRequest, selectOpenAIScenario(req)));
}

function selectOpenAIScenario(req: Request) {
  return selectScenario({
    provider: "openai",
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

export default openAIResponsesRouter;

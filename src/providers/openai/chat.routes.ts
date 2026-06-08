import { Request, RequestHandler, Response, Router } from "express";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { ProviderError } from "../../core/errors/providerErrors";
import { readMockStreamChunkDelay } from "../../core/http/mockControls";
import { selectScenario } from "../../core/scenarioEngine";
import { OPENAI_SSE_HEADERS } from "../../core/sse/openaiSse";
import { sendEncodedSse } from "../../core/sse/streamWriter";
import {
  ChatCompletionCreateRequest,
  createOpenAIChatCompletion,
  deleteOpenAIChatCompletion,
  encodeOpenAIChatCompletionStream,
  getOpenAIChatCompletion,
  listOpenAIChatMessages,
  ServiceResult,
  updateOpenAIChatCompletion,
} from "./chat.service";

export const openAIChatRouter: Router = Router();

openAIChatRouter.post("/", handleCreateChatCompletion as RequestHandler);
openAIChatRouter.get("/:completion_id/messages", handleListMessages as RequestHandler);
openAIChatRouter.get("/:completion_id", handleGetChatCompletion as RequestHandler);
openAIChatRouter.post("/:completion_id", handleUpdateChatCompletion as RequestHandler);
openAIChatRouter.delete("/:completion_id", handleDeleteChatCompletion as RequestHandler);

export async function handleCreateChatCompletion(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  const request = req.body as ChatCompletionCreateRequest;
  const result = createOpenAIChatCompletion(request, selectOpenAIChatScenario(req));

  if (!result.ok) {
    return sendError(res, result.error);
  }

  if (request.stream) {
    await sendEncodedSse(
      res,
      OPENAI_SSE_HEADERS,
      encodeOpenAIChatCompletionStream(
        result.value.completion,
        result.value.scenario,
        Boolean(request.stream_options?.include_usage)
      ),
      readMockStreamChunkDelay(req)
    );
    return;
  }

  res.json(result.value.completion);
}

function handleGetChatCompletion(req: Request, res: Response) {
  sendResult(res, getOpenAIChatCompletion(req.params.completion_id));
}

function handleUpdateChatCompletion(req: Request, res: Response) {
  sendResult(res, updateOpenAIChatCompletion(req.params.completion_id, req.body));
}

function handleDeleteChatCompletion(req: Request, res: Response) {
  sendResult(res, deleteOpenAIChatCompletion(req.params.completion_id));
}

function handleListMessages(req: Request, res: Response) {
  sendResult(res, listOpenAIChatMessages(req.params.completion_id));
}

function selectOpenAIChatScenario(req: Request) {
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

export default openAIChatRouter;

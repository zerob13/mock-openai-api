import { Request, RequestHandler, Response, Router } from "express";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { ProviderError } from "../../core/errors/providerErrors";
import { readMockStreamChunkDelay } from "../../core/http/mockControls";
import { selectScenario } from "../../core/scenarioEngine";
import { GEMINI_SSE_HEADERS } from "../../core/sse/geminiSse";
import { sendEncodedSse } from "../../core/sse/streamWriter";
import {
  countGeminiTokens,
  encodeGeminiGenerateContentStream,
  generateGeminiContent,
  GeminiCountTokensRequest,
  GeminiGenerateContentRequest,
  ServiceResult,
} from "./generateContent.service";

export const geminiGenerateContentRouter: Router = Router();

geminiGenerateContentRouter.post("/:model\\:generateContent", handleGenerateContent as RequestHandler);
geminiGenerateContentRouter.post("/:model\\:streamGenerateContent", handleGenerateContent as RequestHandler);
geminiGenerateContentRouter.post("/:model\\:countTokens", handleCountTokens as RequestHandler);

export async function handleGenerateContent(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "gemini",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  const request = req.body as GeminiGenerateContentRequest;
  const result = generateGeminiContent(req.params.model, request, selectGeminiScenario(req));

  if (!result.ok) {
    return sendError(res, result.error);
  }

  if (isStreamingRequest(req)) {
    await sendEncodedSse(
      res,
      GEMINI_SSE_HEADERS,
      encodeGeminiGenerateContentStream(result.value),
      readMockStreamChunkDelay(req)
    );
    return;
  }

  res.json(result.value);
}

export function handleCountTokens(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "gemini",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  sendResult(res, countGeminiTokens(req.body as GeminiCountTokensRequest));
}

function selectGeminiScenario(req: Request) {
  return selectScenario({
    provider: "gemini",
    endpoint: req.path,
    method: req.method,
    headers: req.headers,
    query: req.query as Record<string, unknown>,
    body: req.body,
    model: req.params.model,
  });
}

function isStreamingRequest(req: Request): boolean {
  return req.path.includes("streamGenerateContent") || req.query.alt === "sse";
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

export default geminiGenerateContentRouter;

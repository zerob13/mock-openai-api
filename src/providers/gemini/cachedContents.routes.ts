import { Request, RequestHandler, Response, Router } from "express";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { buildGeminiError, ProviderError } from "../../core/errors/providerErrors";
import { IdFactory } from "../../core/state/idFactory";
import { estimateTokens } from "../../core/usage/tokenEstimator";

export const geminiCachedContentsRouter: Router = Router();
const idFactory = new IdFactory();
const cachedContents = new Map<string, GeminiCachedContent>();

type GeminiCachedContent = {
  name: string;
  model?: string;
  contents?: unknown[];
  systemInstruction?: unknown;
  tools?: unknown[];
  createTime: string;
  updateTime: string;
  expireTime: string;
  usageMetadata: {
    totalTokenCount: number;
  };
};

geminiCachedContentsRouter.post("/v1beta/cachedContents", handleCreateCachedContent as RequestHandler);
geminiCachedContentsRouter.get("/v1beta/cachedContents", handleListCachedContents as RequestHandler);
geminiCachedContentsRouter.get("/v1beta/cachedContents/:name", handleGetCachedContent as RequestHandler);
geminiCachedContentsRouter.delete("/v1beta/cachedContents/:name", handleDeleteCachedContent as RequestHandler);

function handleCreateCachedContent(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const body = req.body as Partial<GeminiCachedContent>;
  const id = idFactory.next("cachedContent", "gemini.cachedContents");
  const now = new Date(0).toISOString();
  const cached: GeminiCachedContent = {
    name: `cachedContents/${id}`,
    model: body.model || "models/gemini-1.5-flash",
    contents: body.contents || [],
    systemInstruction: body.systemInstruction,
    tools: body.tools || [],
    createTime: now,
    updateTime: now,
    expireTime: new Date(24 * 60 * 60 * 1000).toISOString(),
    usageMetadata: {
      totalTokenCount: estimateTokens(body),
    },
  };

  cachedContents.set(cached.name, cached);
  cachedContents.set(id, cached);
  res.json(cached);
}

function handleListCachedContents(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  res.json({ cachedContents: Array.from(new Set(cachedContents.values())) });
}

function handleGetCachedContent(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const cached = cachedContents.get(req.params.name);
  return cached
    ? res.json(cached)
    : sendError(res, buildGeminiError(404, `Cached content '${req.params.name}' was not found.`));
}

function handleDeleteCachedContent(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const cached = cachedContents.get(req.params.name);
  if (!cached) {
    return sendError(res, buildGeminiError(404, `Cached content '${req.params.name}' was not found.`));
  }

  cachedContents.delete(cached.name);
  cachedContents.delete(cached.name.replace(/^cachedContents\//, ""));
  res.json({});
}

function getInjectedGeminiError(req: Request): ProviderError | undefined {
  return getInjectedProviderError({
    provider: "gemini",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });
}

function sendError(res: Response, error: ProviderError) {
  res.status(error.status).json(error.body);
}

export default geminiCachedContentsRouter;

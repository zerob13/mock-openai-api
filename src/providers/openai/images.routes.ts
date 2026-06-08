import { Request, RequestHandler, Response, Router } from "express";
import multer from "multer";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { ProviderError } from "../../core/errors/providerErrors";
import { ImgData } from "../../data/base64Img";

export const openAIImagesSupportRouter: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

openAIImagesSupportRouter.post("/edits", upload.any(), handleImageEdit as RequestHandler);
openAIImagesSupportRouter.post("/variations", upload.any(), handleImageVariation as RequestHandler);

function handleImageEdit(req: Request, res: Response) {
  sendImageResponse(req, res, "A deterministic mock image edit.");
}

function handleImageVariation(req: Request, res: Response) {
  sendImageResponse(req, res, "A deterministic mock image variation.");
}

function sendImageResponse(req: Request, res: Response, revisedPrompt: string) {
  const injectedError = getInjectedProviderError({
    provider: "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  const body = req.body as { n?: string | number; response_format?: string };
  const n = Number(body.n || 1);
  const count = Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 1;
  const responseFormat = body.response_format;

  res.json({
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: count }, () =>
      responseFormat === "b64_json"
        ? { b64_json: ImgData, revised_prompt: revisedPrompt }
        : { url: ImgData, revised_prompt: revisedPrompt }
    ),
  });
}

function sendError(res: Response, error: ProviderError) {
  res.status(error.status).json(error.body);
}

export default openAIImagesSupportRouter;

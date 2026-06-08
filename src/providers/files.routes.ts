import { Request, RequestHandler, Response, Router } from "express";
import multer from "multer";
import { getInjectedProviderError } from "../core/errors/errorInjector";
import { buildAnthropicError, buildOpenAIError, ProviderError } from "../core/errors/providerErrors";
import { IdFactory } from "../core/state/idFactory";

export const providerFilesRouter: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const idFactory = new IdFactory();
const openAIFiles = new Map<string, OpenAIFileObject>();
const anthropicFiles = new Map<string, AnthropicFileObject>();

type OpenAIFileObject = {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
};

type AnthropicFileObject = {
  id: string;
  type: "file";
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

providerFilesRouter.post("/", upload.any(), handleCreateFile as RequestHandler);
providerFilesRouter.get("/", handleListFiles as RequestHandler);
providerFilesRouter.get("/:file_id", handleGetFile as RequestHandler);
providerFilesRouter.delete("/:file_id", handleDeleteFile as RequestHandler);

function handleCreateFile(req: Request, res: Response) {
  const injectedError = getInjectedFileError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  if (isAnthropicRequest(req)) {
    const file = firstUploadedFile(req);
    const record: AnthropicFileObject = {
      id: idFactory.next("file", "anthropic.files"),
      type: "file",
      filename: file?.originalname || readBodyString(req, "filename") || "mock-upload.txt",
      mime_type: file?.mimetype || readBodyString(req, "mime_type") || "application/octet-stream",
      size_bytes: file?.size || Number(readBodyString(req, "size_bytes") || 0),
      created_at: new Date(0).toISOString(),
    };
    anthropicFiles.set(record.id, record);
    return res.json(record);
  }

  const file = firstUploadedFile(req);
  const record: OpenAIFileObject = {
    id: idFactory.next("file", "openai.files"),
    object: "file",
    bytes: file?.size || Number(readBodyString(req, "bytes") || 0),
    created_at: Math.floor(Date.now() / 1000),
    filename: file?.originalname || readBodyString(req, "filename") || "mock-upload.txt",
    purpose: readBodyString(req, "purpose") || "assistants",
  };
  openAIFiles.set(record.id, record);
  res.json(record);
}

function handleListFiles(req: Request, res: Response) {
  const injectedError = getInjectedFileError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  if (isAnthropicRequest(req)) {
    return res.json({
      data: Array.from(anthropicFiles.values()),
      has_more: false,
      first_id: firstId(anthropicFiles),
      last_id: lastId(anthropicFiles),
    });
  }

  res.json({
    object: "list",
    data: Array.from(openAIFiles.values()),
  });
}

function handleGetFile(req: Request, res: Response) {
  const injectedError = getInjectedFileError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  if (isAnthropicRequest(req)) {
    const record = anthropicFiles.get(req.params.file_id);
    return record
      ? res.json(record)
      : sendError(res, buildAnthropicError(404, `File '${req.params.file_id}' was not found.`));
  }

  const record = openAIFiles.get(req.params.file_id);
  return record
    ? res.json(record)
    : sendError(res, buildOpenAIError(404, `File '${req.params.file_id}' was not found.`));
}

function handleDeleteFile(req: Request, res: Response) {
  const injectedError = getInjectedFileError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  if (isAnthropicRequest(req)) {
    const deleted = anthropicFiles.delete(req.params.file_id);
    return deleted
      ? res.json({ id: req.params.file_id, type: "file_deleted", deleted: true })
      : sendError(res, buildAnthropicError(404, `File '${req.params.file_id}' was not found.`));
  }

  const deleted = openAIFiles.delete(req.params.file_id);
  return deleted
    ? res.json({ id: req.params.file_id, object: "file", deleted: true })
    : sendError(res, buildOpenAIError(404, `File '${req.params.file_id}' was not found.`));
}

function isAnthropicRequest(req: Request): boolean {
  const provider = req.header("x-provider") || req.query.provider;
  return Boolean(req.header("anthropic-version") || provider === "anthropic");
}

function firstUploadedFile(req: Request): Express.Multer.File | undefined {
  const files = req.files;
  return Array.isArray(files) ? files[0] : undefined;
}

function readBodyString(req: Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

function firstId<T extends { id: string }>(map: Map<string, T>): string | null {
  return Array.from(map.values())[0]?.id || null;
}

function lastId<T extends { id: string }>(map: Map<string, T>): string | null {
  return Array.from(map.values()).at(-1)?.id || null;
}

function getInjectedFileError(req: Request): ProviderError | undefined {
  return getInjectedProviderError({
    provider: isAnthropicRequest(req) ? "anthropic" : "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });
}

function sendError(res: Response, error: ProviderError) {
  res.status(error.status).json(error.body);
}

export default providerFilesRouter;

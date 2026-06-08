import { Request, RequestHandler, Response, Router } from "express";
import multer from "multer";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { buildGeminiError, ProviderError } from "../../core/errors/providerErrors";
import { IdFactory } from "../../core/state/idFactory";

export const geminiFilesRouter: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const idFactory = new IdFactory();
const files = new Map<string, GeminiFileObject>();
const pendingUploads = new Map<string, GeminiFileObject>();

type GeminiFileObject = {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  uri: string;
  state: "ACTIVE";
};

geminiFilesRouter.post("/upload/v1beta/files/:upload_id", handleFinalizeResumableUpload as RequestHandler);
geminiFilesRouter.post("/upload/v1beta/files", upload.any(), handleUploadFile as RequestHandler);
geminiFilesRouter.get("/v1beta/files", handleListFiles as RequestHandler);
geminiFilesRouter.get("/v1beta/files/:name", handleGetFile as RequestHandler);
geminiFilesRouter.delete("/v1beta/files/:name", handleDeleteFile as RequestHandler);

function handleUploadFile(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  if (isResumableUploadStart(req)) {
    return handleStartResumableUpload(req, res);
  }

  const uploadFile = firstUploadedFile(req);
  const id = idFactory.next("file", "gemini.files");
  const file = buildFileObject({
    id,
    displayName: uploadFile?.originalname || readBodyString(req, "displayName") || "mock-upload.txt",
    mimeType: uploadFile?.mimetype || readBodyString(req, "mimeType") || "application/octet-stream",
    sizeBytes: String(uploadFile?.size || Number(readBodyString(req, "sizeBytes") || 0)),
  });

  files.set(file.name, file);
  files.set(cleanFileId(file.name), file);
  res.json(file);
}

function handleStartResumableUpload(req: Request, res: Response) {
  const requestedFile = readRequestFile(req);
  const id = cleanFileId(readObjectString(requestedFile, "name")) || idFactory.next("file", "gemini.files");
  const file = buildFileObject({
    id,
    displayName:
      readObjectString(requestedFile, "displayName") ||
      readHeaderString(req, "x-goog-upload-file-name") ||
      "mock-upload.txt",
    mimeType:
      readObjectString(requestedFile, "mimeType") ||
      readHeaderString(req, "x-goog-upload-header-content-type") ||
      "application/octet-stream",
    sizeBytes:
      readObjectString(requestedFile, "sizeBytes") ||
      readHeaderString(req, "x-goog-upload-header-content-length") ||
      "0",
  });

  pendingUploads.set(id, file);
  res.setHeader("x-goog-upload-url", `https://generativelanguage.googleapis.com/upload/v1beta/files/${id}`);
  res.json({});
}

function handleFinalizeResumableUpload(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const id = req.params.upload_id;
  const file = pendingUploads.get(id) || buildFileObject({ id });

  pendingUploads.delete(id);
  files.set(file.name, file);
  files.set(cleanFileId(file.name), file);

  res.setHeader("x-goog-upload-status", "final");
  res.json({ file });
}

function handleListFiles(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const uniqueFiles = Array.from(new Set(files.values()));
  res.json({ files: uniqueFiles });
}

function handleGetFile(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const file = files.get(req.params.name);
  return file ? res.json(file) : sendError(res, buildGeminiError(404, `File '${req.params.name}' was not found.`));
}

function handleDeleteFile(req: Request, res: Response) {
  const injectedError = getInjectedGeminiError(req);
  if (injectedError) {
    return sendError(res, injectedError);
  }

  const file = files.get(req.params.name);
  if (!file) {
    return sendError(res, buildGeminiError(404, `File '${req.params.name}' was not found.`));
  }

  files.delete(file.name);
  files.delete(file.name.replace(/^files\//, ""));
  res.json({});
}

function firstUploadedFile(req: Request): Express.Multer.File | undefined {
  const uploadedFiles = req.files;
  return Array.isArray(uploadedFiles) ? uploadedFiles[0] : undefined;
}

function readBodyString(req: Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

function readRequestFile(req: Request): Record<string, unknown> {
  const file = (req.body as { file?: unknown } | undefined)?.file;
  return file && typeof file === "object" ? file as Record<string, unknown> : {};
}

function readObjectString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function readHeaderString(req: Request, key: string): string | undefined {
  const value = req.header(key);
  return value || undefined;
}

function isResumableUploadStart(req: Request): boolean {
  return req.header("x-goog-upload-command")?.toLowerCase().includes("start") || false;
}

function buildFileObject(input: {
  id: string;
  displayName?: string;
  mimeType?: string;
  sizeBytes?: string;
}): GeminiFileObject {
  const id = cleanFileId(input.id);
  const name = `files/${id}`;
  const now = new Date(0).toISOString();

  return {
    name,
    displayName: input.displayName || "mock-upload.txt",
    mimeType: input.mimeType || "application/octet-stream",
    sizeBytes: input.sizeBytes || "0",
    createTime: now,
    updateTime: now,
    expirationTime: new Date(24 * 60 * 60 * 1000).toISOString(),
    uri: `mock://${name}`,
    state: "ACTIVE",
  };
}

function cleanFileId(id: string | undefined): string {
  return (id || idFactory.next("file", "gemini.files")).replace(/^files\//, "");
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

export default geminiFilesRouter;

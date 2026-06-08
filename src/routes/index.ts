import { Router, Request, RequestHandler, Response } from "express";
import {
  handleGetModels,
  handleImageGeneration,
  handleHealthCheck,
} from "../controllers/openaiController";
import anthropicMessagesRouter, {
  handleCreateMessage as handleAnthropicMessage,
} from "../providers/anthropic/messages.routes";
import { handleListAnthropicModels } from "../providers/anthropic/models.routes";
import providerFilesRouter from "../providers/files.routes";
import geminiCachedContentsRouter from "../providers/gemini/cachedContents.routes";
import geminiFilesRouter from "../providers/gemini/files.routes";
import geminiGenerateContentRouter, {
  handleGenerateContent as handleGeminiGenerateContent,
} from "../providers/gemini/generateContent.routes";
import geminiTokensRouter from "../providers/gemini/tokens.routes";
import { handleListGeminiModels } from "../providers/gemini/models.routes";
import openAIChatRouter, {
  handleCreateChatCompletion,
} from "../providers/openai/chat.routes";
import openAIEmbeddingsRouter from "../providers/openai/embeddings.routes";
import openAIImagesSupportRouter from "../providers/openai/images.routes";
import openAIResponsesRouter from "../providers/openai/responses.routes";

const router: Router = Router();

// Debug middleware to log all requests to this router
router.use((req, res, next) => {
  if (global.verboseLogging) {
    console.log(`🔄 [Router] ${req.method} ${req.path} (originalUrl: ${req.originalUrl})`);
    console.log(`🔄 [Router] Base URL: ${req.baseUrl}`);
    console.log(`🔄 [Router] Request URL: ${req.url}`);
  }
  next();
});

// Health check endpoint
router.get("/health", handleHealthCheck as RequestHandler);

// OpenAI API compatible endpoints
router.get("/v1/models", handleProviderModels as RequestHandler);
router.get("/models", handleGetModels as RequestHandler);
router.use("/v1/responses", openAIResponsesRouter);
router.use("/v1/embeddings", openAIEmbeddingsRouter);
router.use("/v1/files", providerFilesRouter);
router.use("/v1/chat/completions", openAIChatRouter);
router.post("/chat/completions", handleCreateChatCompletion as RequestHandler);

// Anthropic API compatible endpoints
console.log('🔧 [Router] Registering Anthropic routes...');
router.use("/v1/messages", anthropicMessagesRouter);
router.get("/anthropic/v1/models", handleListAnthropicModels as RequestHandler);
router.post("/anthropic/v1/messages", handleAnthropicMessage as RequestHandler);
console.log('✅ [Router] Anthropic routes registered successfully');

// Gemini API compatible endpoints (matching Google's official format)
router.get("/v1beta/models", handleListGeminiModels as RequestHandler);
router.use("/v1beta/models", geminiTokensRouter);
router.use("/v1beta/models", geminiGenerateContentRouter);
// Legacy routes for backward compatibility
router.get("/gemini/v1/models", handleListGeminiModels as RequestHandler);
router.post("/gemini/v1/models/:model/generateContent", handleGeminiGenerateContent as RequestHandler);
router.post("/gemini/v1/models/:model/streamGenerateContent", handleGeminiGenerateContent as RequestHandler);

// Compatible endpoints for different versions
router.post("/v1/images/generations", handleImageGeneration as RequestHandler);
router.use("/v1/images", openAIImagesSupportRouter);
router.post("/images/generations", handleImageGeneration as RequestHandler);

router.use("/", geminiFilesRouter);
router.use("/", geminiCachedContentsRouter);

function handleProviderModels(req: Request, res: Response) {
  const provider = String(req.header("x-provider") || req.query.provider || "").toLowerCase();

  if (provider === "anthropic" || req.header("anthropic-version")) {
    return handleListAnthropicModels(req, res);
  }

  if (provider === "gemini" || provider === "google") {
    return handleListGeminiModels(req, res);
  }

  return handleGetModels(req, res);
}

export default router;

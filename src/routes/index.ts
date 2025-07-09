import { Router, RequestHandler } from "express";
import {
  handleGetModels,
  handleChatCompletion,
  handleImageGeneration,
  handleHealthCheck,
} from "../controllers/openaiController";
import {
  handleGetModels as handleGetAnthropicModels,
  handleMessage as handleAnthropicMessage,
} from "../controllers/anthropicController";
import {
  handleGetGeminiModels,
  handleGenerateContent,
} from "../controllers/geminiController";

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
router.get("/v1/models", handleGetModels as RequestHandler);
router.get("/models", handleGetModels as RequestHandler);
router.post("/v1/chat/completions", handleChatCompletion as RequestHandler);
router.post("/chat/completions", handleChatCompletion as RequestHandler);

// Anthropic API compatible endpoints
console.log('🔧 [Router] Registering Anthropic routes...');
router.get("/anthropic/v1/models", handleGetAnthropicModels as RequestHandler);
router.post("/anthropic/v1/messages", handleAnthropicMessage as RequestHandler);
console.log('✅ [Router] Anthropic routes registered successfully');

// Gemini API compatible endpoints (matching Google's official format)
router.get("/v1beta/models", handleGetGeminiModels as RequestHandler);
router.post("/v1beta/models/:model\\:generateContent", handleGenerateContent as RequestHandler);
router.post("/v1beta/models/:model\\:streamGenerateContent", handleGenerateContent as RequestHandler);
// Legacy routes for backward compatibility
router.get("/gemini/v1/models", handleGetGeminiModels as RequestHandler);
router.post("/gemini/v1/models/:model/generateContent", handleGenerateContent as RequestHandler);
router.post("/gemini/v1/models/:model/streamGenerateContent", handleGenerateContent as RequestHandler);

// Compatible endpoints for different versions
router.post("/v1/images/generations", handleImageGeneration as RequestHandler);
router.post("/images/generations", handleImageGeneration as RequestHandler);

export default router;

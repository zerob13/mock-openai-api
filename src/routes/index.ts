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

const router: Router = Router();

// Debug middleware to log all requests to this router
router.use((req, res, next) => {
  if (global.verboseLogging) {
    console.log(
      `Router - ${req.method} ${req.path} (originalUrl: ${req.originalUrl})`
    );
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
router.get("/anthropic/v1/models", handleGetAnthropicModels as RequestHandler);
router.post("/anthropic/v1/messages", handleAnthropicMessage as RequestHandler);

// Compatible endpoints for different versions
router.post("/v1/images/generations", handleImageGeneration as RequestHandler);
router.post("/images/generations", handleImageGeneration as RequestHandler);

export default router;

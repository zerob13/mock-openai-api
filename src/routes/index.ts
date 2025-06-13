import { Router, RequestHandler } from "express";
import {
  handleGetModels,
  handleChatCompletion,
  handleImageGeneration,
  handleHealthCheck,
} from "../controllers/openaiController";

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

// Compatible endpoints for different versions
router.post("/v1/images/generations", handleImageGeneration as RequestHandler);
router.post("/images/generations", handleImageGeneration as RequestHandler);

export default router;

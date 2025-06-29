import { Router } from 'express';
import {
  handleGetModels,
  handleChatCompletion,
  handleImageGeneration,
  handleHealthCheck
} from '../controllers/openaiController';
import { handleGeminiRequest } from '../controllers/geminiController';

const router = Router();

// Debug middleware to log all requests to this router
router.use((req, res, next) => {
  if (global.verboseLogging) {
    console.log(`Router - ${req.method} ${req.path} (originalUrl: ${req.originalUrl})`);
  }
  next();
});

// Health check endpoint
router.get('/health', handleHealthCheck);

// OpenAI API compatible endpoints
router.get('/v1/models', handleGetModels);
router.get('/models', handleGetModels);
router.post('/v1/chat/completions', handleChatCompletion);
router.post('/chat/completions', handleChatCompletion);

router.post('/v1beta/models/gemini-pro:generateContent', handleGeminiRequest);
router.post('/v1beta/models/gemini-2.0-flash:generateContent', handleGeminiRequest);

export default router; 

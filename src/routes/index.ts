import { Router } from 'express';
import {
  handleGetModels,
  handleChatCompletion,
  handleImageGeneration,
  handleHealthCheck
} from '../controllers/openaiController';

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

// Compatible endpoints for different versions
router.post('/v1/images/generations', handleImageGeneration);
router.post('/images/generations', handleImageGeneration);

export default router; 

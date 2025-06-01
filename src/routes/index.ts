import { Router } from 'express';
import {
  handleGetModels,
  handleChatCompletions,
  handleImageGeneration,
  handleHealthCheck
} from '../controllers/openaiController';

const router = Router();

// 健康检查端点
router.get('/health', handleHealthCheck);

// OpenAI API 兼容端点
router.get('/v1/models', handleGetModels);
router.post('/v1/chat/completions', handleChatCompletions);
router.post('/v1/images/generations', handleImageGeneration);

// 兼容不同版本的端点
router.get('/models', handleGetModels);
router.post('/chat/completions', handleChatCompletions);
router.post('/images/generations', handleImageGeneration);

export default router; 

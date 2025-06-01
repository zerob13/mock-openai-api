import { Request, Response } from 'express';
import { ChatCompletionRequest, ImageGenerationRequest } from '../types';
import {
  getModels,
  createChatCompletion,
  createChatCompletionStream,
  generateImage
} from '../services/openaiService';

/**
 * Get model list
 */
export function handleGetModels(req: Request, res: Response) {
  try {
    const models = getModels();
    res.json(models);
  } catch (error) {
    console.error('Get model list error:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'api_error',
        code: 'internal_error'
      }
    });
  }
}

/**
 * Handle chat completion request
 */
export function handleChatCompletion(req: Request, res: Response) {
  try {
    const request: ChatCompletionRequest = req.body;
    
    // Basic validation
    if (!request.model) {
      return res.status(400).json({
        error: {
          message: 'Missing required parameter: model',
          type: 'invalid_request_error',
          code: 'missing_parameter'
        }
      });
    }

    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Missing required parameter: messages',
          type: 'invalid_request_error',
          code: 'missing_parameter'
        }
      });
    }

    // Streaming response
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // Flush headers to ensure client receives headers immediately
      res.flushHeaders();

      const stream = createChatCompletionStream(request);
      for (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    } else {
      // Non-streaming response
      const completion = createChatCompletion(request);
      
      // Check if it's an error response
      if ('error' in completion) {
        return res.status(400).json(completion);
      }
      
      res.json(completion);
    }
  } catch (error) {
    console.error('Chat completion request error:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'api_error',
        code: 'internal_error'
      }
    });
  }
}

/**
 * Handle image generation request
 */
export function handleImageGeneration(req: Request, res: Response) {
  try {
    const request: ImageGenerationRequest = req.body;
    
    // Basic validation
    if (!request.prompt) {
      return res.status(400).json({
        error: {
          message: 'Missing required parameter: prompt',
          type: 'invalid_request_error',
          code: 'missing_parameter'
        }
      });
    }
    
    const imageResponse = generateImage(request);
    res.json(imageResponse);
  } catch (error) {
    console.error('Image generation request error:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'api_error',
        code: 'internal_error'
      }
    });
  }
}

/**
 * Handle health check
 */
export function handleHealthCheck(req: Request, res: Response) {
  res.json({
    status: 'ok',
    message: 'Mock OpenAI API server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
} 

import { Request, Response } from 'express';
import { 
  getGeminiModels, 
  generateContent, 
  streamGenerateContent 
} from '../services/geminiService';
import { GeminiGenerateContentRequest } from '../types/gemini';

/**
 * Get Gemini models
 */
export function handleGetGeminiModels(req: Request, res: Response) {
  try {
    const models = getGeminiModels();
    res.json(models);
  } catch (error) {
    console.error('Get Gemini models error:', error);
    res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
        status: 'INTERNAL'
      }
    });
  }
}

/**
 * Generate content
 */
export function handleGenerateContent(req: Request, res: Response) {
  try {
    const request: GeminiGenerateContentRequest = req.body;

    // Basic validation
    if (!request.contents || request.contents.length === 0) {
      return res.status(400).json({
        error: {
          code: 400,
          message: 'Request must contain at least one content item',
          status: 'INVALID_ARGUMENT'
        }
      });
    }

    // Check if streaming is requested
    const isStreaming = req.url.includes('streamGenerateContent') || req.query.alt === 'sse';

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      const stream = streamGenerateContent(request);
      for (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
      return;
    }

    // Non-streaming response
    const response = generateContent(request);

    // Check if it's an error response
    if ('error' in response) {
      return res.status(response.error.code).json(response);
    }

    res.json(response);

  } catch (error) {
    console.error('Generate content error:', error);
    res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
        status: 'INTERNAL'
      }
    });
  }
}
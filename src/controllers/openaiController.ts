import { Request, Response } from 'express';
import { ChatCompletionRequest, ImageGenerationRequest } from '../types';
import {
  getModels,
  createChatCompletion,
  createChatCompletionStream,
  createToolCallResponseStream,
  generateImage
} from '../services/openaiService';
import { findModelById } from '../utils/helpers';

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

    // Check if this is a tool-calls model and if we need to simulate the two-phase process
    const model = findModelById(request.model);
    const isToolCallModel = model && model.type === 'tool-calls';
    
    // Check if this is a request with tool results (second phase)
    const hasToolResults = request.messages.some(msg => msg.role === 'tool');

    // Streaming response
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // Flush headers to ensure client receives headers immediately
      res.flushHeaders();

      if (isToolCallModel && hasToolResults) {
        // This is the second phase of tool call - generate final response
        const toolMessage = request.messages.find(msg => msg.role === 'tool');
        const toolCallResponseStream = createToolCallResponseStream(
          request, 
          toolMessage?.tool_call_id || '', 
          toolMessage?.content || ''
        );
        
        for (const chunk of toolCallResponseStream) {
          res.write(chunk);
        }
      } else if (isToolCallModel && !hasToolResults) {
        // This is the first phase of tool call - but for demo purposes, 
        // we'll simulate both phases automatically with a delay
        const firstPhaseStream = createChatCompletionStream(request);
        for (const chunk of firstPhaseStream) {
          res.write(chunk);
        }
        
        // Simulate a delay and automatic second phase
        setTimeout(() => {
          console.log('Loop iteration 2 for event simulated_event_id');
          
          // Create a simulated second phase request
          const secondPhaseRequest = { ...request };
          
          const toolCallResponseStream = createToolCallResponseStream(
            secondPhaseRequest, 
            'call_0_8a90fac8-b281-49a0-bcc9-55d7f4603891', 
            'simulated tool result'
          );
          
          for (const chunk of toolCallResponseStream) {
            res.write(chunk);
          }
          res.end();
        }, 1000); // 1 second delay to simulate external tool execution
        
        return; // Don't end the response yet
      } else {
        // Normal streaming for non-tool-call models
        const stream = createChatCompletionStream(request);
        for (const chunk of stream) {
          res.write(chunk);
        }
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

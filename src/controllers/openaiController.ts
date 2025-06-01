import { Request, Response } from 'express';
import { ChatCompletionRequest, ImageGenerationRequest } from '../types';
import {
  getModels,
  createChatCompletion,
  createChatCompletionStream,
  generateImage
} from '../services/openaiService';

/**
 * 获取模型列表
 */
export function handleGetModels(req: Request, res: Response) {
  try {
    const models = getModels();
    res.json(models);
  } catch (error) {
    console.error('获取模型列表错误:', error);
    res.status(500).json({
      error: {
        message: '内部服务器错误',
        type: 'internal_server_error'
      }
    });
  }
}

/**
 * 处理聊天完成请求
 */
export function handleChatCompletions(req: Request, res: Response) {
  try {
    const request: ChatCompletionRequest = req.body;
    
    // 基本验证
    if (!request.model) {
      return res.status(400).json({
        error: {
          message: '缺少必需的参数: model',
          type: 'invalid_request_error',
          param: 'model'
        }
      });
    }

    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      return res.status(400).json({
        error: {
          message: '缺少必需的参数: messages',
          type: 'invalid_request_error',
          param: 'messages'
        }
      });
    }

    // 流式响应
    if (request.stream) {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      
      const streamGenerator = createChatCompletionStream(request);
      
      for (const chunk of streamGenerator) {
        res.write(chunk);
      }
      
      res.end();
    } else {
      // 非流式响应
      const completion = createChatCompletion(request);
      
      // 检查是否是错误响应
      if (completion.error) {
        return res.status(400).json(completion);
      }
      
      res.json(completion);
    }
  } catch (error) {
    console.error('聊天完成请求错误:', error);
    res.status(500).json({
      error: {
        message: '内部服务器错误',
        type: 'internal_server_error'
      }
    });
  }
}

/**
 * 处理图像生成请求
 */
export function handleImageGeneration(req: Request, res: Response) {
  try {
    const request: ImageGenerationRequest = req.body;
    
    // 基本验证
    if (!request.prompt) {
      return res.status(400).json({
        error: {
          message: '缺少必需的参数: prompt',
          type: 'invalid_request_error',
          param: 'prompt'
        }
      });
    }

    const imageResponse = generateImage(request);
    res.json(imageResponse);
  } catch (error) {
    console.error('图像生成请求错误:', error);
    res.status(500).json({
      error: {
        message: '内部服务器错误',
        type: 'internal_server_error'
      }
    });
  }
}

/**
 * 处理健康检查
 */
export function handleHealthCheck(req: Request, res: Response) {
  res.json({
    status: 'ok',
    message: 'Mock OpenAI API 服务器正在运行',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
} 

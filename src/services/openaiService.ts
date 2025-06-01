import {
  Model,
  ModelsResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ChatMessage
} from '../types';
import { mockModels, mockImageUrls } from '../data/mockData';
import {
  generateChatCompletionId,
  generateImageId,
  getCurrentTimestamp,
  findModelById,
  selectTestCase,
  calculateTokens,
  randomChoice,
  formatErrorResponse
} from '../utils/helpers';

/**
 * 获取模型列表
 */
export function getModels(): ModelsResponse {
  const models: Model[] = mockModels.map(mockModel => ({
    id: mockModel.id,
    object: 'model',
    created: getCurrentTimestamp(),
    owned_by: 'mock-openai'
  }));

  return {
    object: 'list',
    data: models
  };
}

/**
 * 创建聊天完成（非流式）
 */
export function createChatCompletion(request: ChatCompletionRequest): ChatCompletionResponse | any {
  // 验证模型
  const model = findModelById(request.model);
  if (!model) {
    return formatErrorResponse(`模型 '${request.model}' 不存在`);
  }

  // 获取最后一条用户消息
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find(msg => msg.role === 'user');

  if (!lastUserMessage) {
    return formatErrorResponse('未找到用户消息');
  }

  // 选择测试用例
  const testCase = selectTestCase(model, lastUserMessage.content);
  
  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();
  
  // 构建响应消息
  const responseMessage: ChatMessage = {
    role: 'assistant',
    content: testCase.response
  };

  // 如果是函数调用模型，添加函数调用
  if (model.type === 'function' && testCase.functionCall) {
    responseMessage.function_call = {
      name: testCase.functionCall.name,
      arguments: JSON.stringify(testCase.functionCall.arguments)
    };
  }

  const response: ChatCompletionResponse = {
    id,
    object: 'chat.completion',
    created: timestamp,
    model: request.model,
    choices: [{
      index: 0,
      message: responseMessage,
      finish_reason: model.type === 'function' && testCase.functionCall ? 'function_call' : 'stop'
    }],
    usage: {
      prompt_tokens: calculateTokens(lastUserMessage.content),
      completion_tokens: calculateTokens(testCase.response),
      total_tokens: calculateTokens(lastUserMessage.content + testCase.response)
    }
  };

  return response;
}

/**
 * 创建聊天完成（流式）
 */
export function* createChatCompletionStream(request: ChatCompletionRequest): Generator<string, void, unknown> {
  // 验证模型
  const model = findModelById(request.model);
  if (!model) {
    const errorChunk = `data: ${JSON.stringify(formatErrorResponse(`模型 '${request.model}' 不存在`))}\\n\\n`;
    yield errorChunk;
    return;
  }

  // 获取最后一条用户消息
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find(msg => msg.role === 'user');

  if (!lastUserMessage) {
    const errorChunk = `data: ${JSON.stringify(formatErrorResponse('未找到用户消息'))}\\n\\n`;
    yield errorChunk;
    return;
  }

  // 选择测试用例
  const testCase = selectTestCase(model, lastUserMessage.content);
  
  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();

  // 发送开始chunk
  const startChunk: ChatCompletionStreamChunk = {
    id,
    object: 'chat.completion.chunk',
    created: timestamp,
    model: request.model,
    choices: [{
      index: 0,
      delta: { role: 'assistant' },
      finish_reason: undefined
    }]
  };
  
  yield `data: ${JSON.stringify(startChunk)}\\n\\n`;

  // 如果有预定义的流式chunk，使用它们
  if (testCase.streamChunks && testCase.streamChunks.length > 0) {
    for (const chunkContent of testCase.streamChunks) {
      const chunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        choices: [{
          index: 0,
          delta: { content: chunkContent },
          finish_reason: undefined
        }]
      };
      
      yield `data: ${JSON.stringify(chunk)}\\n\\n`;
    }
  } else {
    // 否则将完整响应分割成chunks
    const words = testCase.response.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      const chunkContent = words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
      
      const chunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        choices: [{
          index: 0,
          delta: { content: chunkContent },
          finish_reason: undefined
        }]
      };
      
      yield `data: ${JSON.stringify(chunk)}\\n\\n`;
    }
  }

  // 处理函数调用
  if (model.type === 'function' && testCase.functionCall) {
    const functionChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      choices: [{
        index: 0,
        delta: {
          function_call: {
            name: testCase.functionCall.name,
            arguments: JSON.stringify(testCase.functionCall.arguments)
          }
        },
        finish_reason: undefined
      }]
    };
    
    yield `data: ${JSON.stringify(functionChunk)}\\n\\n`;
  }

  // 发送结束chunk
  const endChunk: ChatCompletionStreamChunk = {
    id,
    object: 'chat.completion.chunk',
    created: timestamp,
    model: request.model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: model.type === 'function' && testCase.functionCall ? 'function_call' : 'stop'
    }]
  };
  
  yield `data: ${JSON.stringify(endChunk)}\\n\\n`;
  yield 'data: [DONE]\\n\\n';
}

/**
 * 生成图像
 */
export function generateImage(request: ImageGenerationRequest): ImageGenerationResponse {
  const n = request.n || 1;
  const timestamp = getCurrentTimestamp();
  const size = request.size || '1024x1024';
  
  // 根据模型选择不同的图片
  const model = request.model || 'gpt-4o-image';
  let imageUrls = mockImageUrls;
  
  // 如果指定了 gpt-4o-image 模型，使用更高质量的占位图
  if (model === 'gpt-4o-image') {
    imageUrls = [
      `https://via.placeholder.com/${size}/FF6B6B/FFFFFF?text=GPT-4O+Image+1`,
      `https://via.placeholder.com/${size}/4ECDC4/FFFFFF?text=GPT-4O+Image+2`,
      `https://via.placeholder.com/${size}/45B7D1/FFFFFF?text=GPT-4O+Image+3`,
      `https://via.placeholder.com/${size}/96CEB4/FFFFFF?text=GPT-4O+Image+4`,
      `https://via.placeholder.com/${size}/FFEAA7/000000?text=GPT-4O+Image+5`,
      `https://via.placeholder.com/${size}/DDA0DD/000000?text=GPT-4O+Image+6`,
      `https://via.placeholder.com/${size}/F0E68C/000000?text=GPT-4O+Image+7`,
      `https://via.placeholder.com/${size}/FFA07A/000000?text=GPT-4O+Image+8`
    ];
  }
  
  const data = Array.from({ length: n }, () => {
    const imageUrl = randomChoice(imageUrls);
    
    if (request.response_format === 'b64_json') {
      // 模拟 base64 编码的图像（实际应用中这里会是真实的 base64）
      return {
        b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      };
    } else {
      return {
        url: imageUrl
      };
    }
  });

  return {
    created: timestamp,
    data
  };
} 

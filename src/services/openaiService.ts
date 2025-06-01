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
  let responseContent = testCase.response;
  
  // 如果是thinking-tag模型且有reasoning_content，则将其包装在<think>标签中
  if (model.type === 'thinking-tag' && testCase.reasoning_content) {
    responseContent = `<think>\n${testCase.reasoning_content}\n</think>\n\n${testCase.response}`;
  }
  
  const responseMessage: ChatMessage = {
    role: 'assistant',
    content: responseContent
  };

  // 如果是函数调用模型，添加函数调用（markdown 模型不会执行此逻辑）
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
    const errorChunk = `data: ${JSON.stringify(formatErrorResponse(`模型 '${request.model}' 不存在`))}\n\n`;
    yield errorChunk;
    return;
  }

  // 获取最后一条用户消息
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find(msg => msg.role === 'user');

  if (!lastUserMessage) {
    const errorChunk = `data: ${JSON.stringify(formatErrorResponse('未找到用户消息'))}\n\n`;
    yield errorChunk;
    return;
  }

  // 选择测试用例
  const testCase = selectTestCase(model, lastUserMessage.content);
  
  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();
  const systemFingerprint = `fp_${Math.random().toString(36).substr(2, 10)}_mock`;

  let completionTokens = 0;
  let reasoningTokens = 0;

  // 思考模式：先输出reasoning_content，再输出content
  if (model.type === 'thinking' && testCase.reasoning_content) {
    // 发送第一个chunk - role 和空 reasoning_content
    const startChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: { 
          role: 'assistant', 
          content: null,
          reasoning_content: '' 
        },
        logprobs: null,
        finish_reason: null
      }],
      usage: null
    };
    
    yield `data: ${JSON.stringify(startChunk)}\n\n`;

    // 输出reasoning_content chunks
    if (testCase.reasoning_chunks && testCase.reasoning_chunks.length > 0) {
      for (const reasoningChunk of testCase.reasoning_chunks) {
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { 
              content: null,
              reasoning_content: reasoningChunk 
            },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        reasoningTokens += calculateTokens(reasoningChunk);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    }

    // 开始输出content，reasoning_content设为null
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunkContent of testCase.streamChunks) {
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { 
              content: chunkContent,
              reasoning_content: null 
            },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(chunkContent);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    } else {
      // 否则将完整响应分割成chunks
      const words = testCase.response.split(' ');
      for (let i = 0; i < words.length; i += 1) {
        const chunkContent = words[i] + (i < words.length - 1 ? ' ' : '');
        
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { 
              content: chunkContent,
              reasoning_content: null 
            },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(chunkContent);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    }
  } else if (model.type === 'thinking-tag' && testCase.reasoning_content) {
    // thinking-tag模式：在content中用<think>标签包围reasoning_content
    // 发送第一个chunk - role 和空 content
    const startChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: { 
          role: 'assistant', 
          content: '' 
        },
        logprobs: null,
        finish_reason: null
      }],
      usage: null
    };
    
    yield `data: ${JSON.stringify(startChunk)}\n\n`;

    // 先输出<think>开始标签
    const thinkStartChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: { content: '<think>\n' },
        logprobs: null,
        finish_reason: null
      }],
      usage: null
    };
    
    completionTokens += calculateTokens('<think>\n');
    yield `data: ${JSON.stringify(thinkStartChunk)}\n\n`;

    // 输出reasoning_content chunks
    if (testCase.reasoning_chunks && testCase.reasoning_chunks.length > 0) {
      for (const reasoningChunk of testCase.reasoning_chunks) {
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { content: reasoningChunk },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(reasoningChunk);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    } else {
      // 输出完整的reasoning_content
      const reasoningChunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [{
          index: 0,
          delta: { content: testCase.reasoning_content },
          logprobs: null,
          finish_reason: null
        }],
        usage: null
      };
      
      completionTokens += calculateTokens(testCase.reasoning_content);
      yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
    }

    // 输出</think>结束标签和换行
    const thinkEndChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: { content: '\n</think>\n\n' },
        logprobs: null,
        finish_reason: null
      }],
      usage: null
    };
    
    completionTokens += calculateTokens('\n</think>\n\n');
    yield `data: ${JSON.stringify(thinkEndChunk)}\n\n`;

    // 输出正常的response content
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunkContent of testCase.streamChunks) {
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { content: chunkContent },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(chunkContent);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    } else {
      // 否则将完整响应分割成chunks
      const words = testCase.response.split(' ');
      for (let i = 0; i < words.length; i += 1) {
        const chunkContent = words[i] + (i < words.length - 1 ? ' ' : '');
        
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { content: chunkContent },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(chunkContent);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    }
  } else {
    // 非思考模式：正常输出
    // 发送第一个chunk - role 和空 content
    const startChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: { 
          role: 'assistant', 
          content: '' 
        },
        logprobs: null,
        finish_reason: null
      }],
      usage: null
    };
    
    yield `data: ${JSON.stringify(startChunk)}\n\n`;

    // 如果有预定义的流式chunk，使用它们
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunkContent of testCase.streamChunks) {
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { content: chunkContent },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(chunkContent);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    } else {
      // 否则将完整响应分割成chunks
      const words = testCase.response.split(' ');
      for (let i = 0; i < words.length; i += 1) {
        const chunkContent = words[i] + (i < words.length - 1 ? ' ' : '');
        
        const chunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: { content: chunkContent },
            logprobs: null,
            finish_reason: null
          }],
          usage: null
        };
        
        completionTokens += calculateTokens(chunkContent);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
      }
    }
  }

  // 处理函数调用（仅限 function 类型模型，markdown 模型不会执行此逻辑）
  if (model.type === 'function' && testCase.functionCall) {
    const functionChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: {
          function_call: {
            name: testCase.functionCall.name,
            arguments: JSON.stringify(testCase.functionCall.arguments)
          }
        },
        logprobs: null,
        finish_reason: null
      }],
      usage: null
    };
    
    yield `data: ${JSON.stringify(functionChunk)}\n\n`;
  }

  // 计算 token 使用量
  const promptTokens = calculateTokens(lastUserMessage.content);
  const totalTokens = promptTokens + completionTokens + reasoningTokens;

  // 发送最后一个chunk - 包含 finish_reason 和 usage
  const endChunk: ChatCompletionStreamChunk = {
    id,
    object: 'chat.completion.chunk',
    created: timestamp,
    model: request.model,
    system_fingerprint: systemFingerprint,
    choices: [{
      index: 0,
      delta: { 
        content: '',
        reasoning_content: null 
      },
      logprobs: null,
      finish_reason: model.type === 'function' && testCase.functionCall ? 'function_call' : 'stop'
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      prompt_tokens_details: {
        cached_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: reasoningTokens
      },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: promptTokens
    }
  };
  
  yield `data: ${JSON.stringify(endChunk)}\n\n`;
  yield `data: [DONE]\n\n`;
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

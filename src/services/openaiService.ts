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
 * Get model list
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
 * Create chat completion (non-streaming)
 */
export function createChatCompletion(request: ChatCompletionRequest): ChatCompletionResponse {
  // Validate model
  const model = findModelById(request.model);
  if (!model) {
    return formatErrorResponse(`Model '${request.model}' does not exist`);
  }

  // Get last user message
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find(msg => msg.role === 'user');

  if (!lastUserMessage) {
    return formatErrorResponse('No user message found');
  }

  // Select test case
  const testCase = selectTestCase(model, lastUserMessage.content || '');
  
  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();

  // Build response message
  let content = testCase.response;

  // If it's a thinking-tag model and has reasoning_content, wrap it in <think> tags
  if (model.type === 'thinking-tag' && testCase.reasoning_content) {
    content = `<think>\n${testCase.reasoning_content}\n</think>\n\n${testCase.response}`;
  }

  let responseMessage: ChatMessage = {
    role: 'assistant',
    content
  };

  // If it's a tool calls model, add tool calls
  if (model.type === 'tool-calls' && testCase.toolCall) {
    responseMessage.content = null;
    responseMessage.tool_calls = [{
      id: testCase.toolCall.id || `call_${Date.now()}`,
      type: 'function',
      function: {
        name: testCase.toolCall.name,
        arguments: JSON.stringify(testCase.toolCall.arguments)
      }
    }];
  }

  const promptTokens = calculateTokens(lastUserMessage.content || '');
  const completionTokens = calculateTokens(testCase.response || '');
  const reasoningTokens = testCase.reasoning_content ? calculateTokens(testCase.reasoning_content) : 0;

  let finishReason = 'stop';
  if (testCase.toolCall) {
    finishReason = 'tool_calls';
  }

  const response: ChatCompletionResponse = {
    id,
    object: 'chat.completion',
    created: timestamp,
    model: request.model,
    choices: [{
      index: 0,
      message: responseMessage,
      finish_reason: finishReason
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens + reasoningTokens,
      completion_tokens_details: {
        reasoning_tokens: reasoningTokens
      }
    }
  };

  return response;
}

/**
 * Create chat completion (streaming)
 */
export function* createChatCompletionStream(request: ChatCompletionRequest): Generator<string, void, unknown> {
  // Validate model
  const model = findModelById(request.model);
  if (!model) {
    const errorChunk = `data: ${JSON.stringify(formatErrorResponse(`Model '${request.model}' does not exist`))}\n\n`;
    yield errorChunk;
    return;
  }

  // Get last user message
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find(msg => msg.role === 'user');

  if (!lastUserMessage) {
    const errorChunk = `data: ${JSON.stringify(formatErrorResponse('No user message found'))}\n\n`;
    yield errorChunk;
    return;
  }

  // Select test case
  const testCase = selectTestCase(model, lastUserMessage.content || '');
  
  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();
  const systemFingerprint = `fp_${Math.random().toString(36).substr(2, 10)}_mock`;

  let completionTokens = 0;
  let reasoningTokens = 0;

  if (model.type === 'thinking') {
    // Thinking mode: output reasoning_content first, then content
    
    // Send first chunk - role and empty reasoning_content
    const firstChunk: ChatCompletionStreamChunk = {
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
          reasoning_content: testCase.reasoning_content || ''
        },
        finish_reason: null
      }]
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    // Output reasoning_content chunks
    if (testCase.reasoning_content && testCase.reasoning_chunks) {
      for (const chunk of testCase.reasoning_chunks) {
        const reasoningChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              reasoning_content: chunk
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
        reasoningTokens += calculateTokens(chunk);
      }
    }

    // Start outputting content, set reasoning_content to null
    const contentStartChunk: ChatCompletionStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [{
        index: 0,
        delta: {
          reasoning_content: null,
          content: ''
        },
        finish_reason: null
      }]
    };
    yield `data: ${JSON.stringify(contentStartChunk)}\n\n`;

    // Use predefined stream chunks if available
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunk of testCase.streamChunks) {
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: chunk
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunk);
      }
    } else {
      // Otherwise split the complete response into chunks
      const words = testCase.response.split(' ');
      for (let i = 0; i < words.length; i += 2) {
        const chunkText = words.slice(i, i + 2).join(' ') + (i + 2 < words.length ? ' ' : '');
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: chunkText
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunkText);
      }
    }

  } else if (model.type === 'thinking-tag') {
    // thinking-tag mode: surround reasoning_content with <think> tags in content
    // Send first chunk - role and empty content
    const firstChunk: ChatCompletionStreamChunk = {
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
        finish_reason: null
      }]
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    if (testCase.reasoning_content) {
      // First output <think> start tag
      const thinkStartChunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [{
          index: 0,
          delta: {
            content: '<think>\n'
          },
          finish_reason: null
        }]
      };
      yield `data: ${JSON.stringify(thinkStartChunk)}\n\n`;

      // Output reasoning_content chunks
      if (testCase.reasoning_chunks && testCase.reasoning_chunks.length > 0) {
        for (const chunk of testCase.reasoning_chunks) {
          const reasoningChunk: ChatCompletionStreamChunk = {
            id,
            object: 'chat.completion.chunk',
            created: timestamp,
            model: request.model,
            system_fingerprint: systemFingerprint,
            choices: [{
              index: 0,
              delta: {
                content: chunk
              },
              finish_reason: null
            }]
          };
          yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
          reasoningTokens += calculateTokens(chunk);
        }
      } else {
        // Output complete reasoning_content
        const reasoningChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: testCase.reasoning_content
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
        reasoningTokens += calculateTokens(testCase.reasoning_content);
      }

      // Output </think> end tag and newline
      const thinkEndChunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [{
          index: 0,
          delta: {
            content: '\n</think>\n\n'
          },
          finish_reason: null
        }]
      };
      yield `data: ${JSON.stringify(thinkEndChunk)}\n\n`;
    }

    // Output normal response content
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunk of testCase.streamChunks) {
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: chunk
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunk);
      }
    } else {
      // Otherwise split the complete response into chunks
      const words = testCase.response.split(' ');
      for (let i = 0; i < words.length; i += 2) {
        const chunkText = words.slice(i, i + 2).join(' ') + (i + 2 < words.length ? ' ' : '');
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: chunkText
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunkText);
      }
    }

  } else {
    // Non-thinking mode: normal output
    // Send first chunk - role and empty content
    const firstChunk: ChatCompletionStreamChunk = {
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
        finish_reason: null
      }]
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    // If there are predefined streaming chunks, use them
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunk of testCase.streamChunks) {
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: chunk
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunk);
      }
    } else {
      // Otherwise split the complete response into chunks
      const words = testCase.response.split(' ');
      for (let i = 0; i < words.length; i += 2) {
        const chunkText = words.slice(i, i + 2).join(' ') + (i + 2 < words.length ? ' ' : '');
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [{
            index: 0,
            delta: {
              content: chunkText
            },
            finish_reason: null
          }]
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunkText);
      }
    }

    // Handle tool calls (新的OpenAI格式)
    if (model.type === 'tool-calls' && testCase.toolCall) {
      // 第一阶段：发送tool call
      const toolCallChunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: testCase.toolCall.id || `call_${Date.now()}`,
              type: 'function',
              function: {
                name: testCase.toolCall.name,
                arguments: ""
              }
            }]
          },
          finish_reason: null
        }]
      };
      yield `data: ${JSON.stringify(toolCallChunk)}\n\n`;

      // 发送arguments
      const argumentsChunk: ChatCompletionStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: JSON.stringify(testCase.toolCall.arguments)
              }
            }]
          },
          finish_reason: null
        }]
      };
      yield `data: ${JSON.stringify(argumentsChunk)}\n\n`;
    }
  }

  // Calculate token usage
  const promptTokens = calculateTokens(lastUserMessage.content || '');

  // Send last chunk - contains finish_reason and usage
  const lastChunk: ChatCompletionStreamChunk = {
    id,
    object: 'chat.completion.chunk',
    created: timestamp,
    model: request.model,
    system_fingerprint: systemFingerprint,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: (model.type === 'tool-calls' && testCase.toolCall) ? 'tool_calls' : 'stop'
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens + reasoningTokens,
      completion_tokens_details: {
        reasoning_tokens: reasoningTokens
      }
    }
  };
  yield `data: ${JSON.stringify(lastChunk)}\n\n`;

  // Send end marker
  yield `data: [DONE]\n\n`;
}

/**
 * Generate image
 */
export function generateImage(request: ImageGenerationRequest): ImageGenerationResponse {
  const n = request.n || 1;
  const timestamp = getCurrentTimestamp();
  const size = request.size || '1024x1024';
  
  // Choose different images based on model
  const model = request.model || 'gpt-4o-image';
  let imageUrls = mockImageUrls;
  
  // If gpt-4o-image model is specified, use higher quality placeholder images
  if (model === 'gpt-4o-image') {
    imageUrls = [
      `https://placehold.co/${size}/FF6B6B/FFFFFF?text=GPT-4O+Image+1`,
      `https://placehold.co/${size}/4ECDC4/FFFFFF?text=GPT-4O+Image+2`,
      `https://placehold.co/${size}/45B7D1/FFFFFF?text=GPT-4O+Image+3`,
      `https://placehold.co/${size}/96CEB4/FFFFFF?text=GPT-4O+Image+4`,
      `https://placehold.co/${size}/FFEAA7/000000?text=GPT-4O+Image+5`,
      `https://placehold.co/${size}/DDA0DD/000000?text=GPT-4O+Image+6`,
      `https://placehold.co/${size}/F0E68C/000000?text=GPT-4O+Image+7`,
      `https://placehold.co/${size}/FFA07A/000000?text=GPT-4O+Image+8`
    ];
  }
  
  const data = Array.from({ length: n }, () => {
    const imageUrl = randomChoice(imageUrls);
    
    if (request.response_format === 'b64_json') {
      // Simulate base64 encoded image (in actual applications this would be real base64)
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

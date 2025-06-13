import {
  Model,
  ModelsResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ChatMessage,
} from "../types";
import { mockModels, mockImageUrls } from "../data/mockData";
import {
  generateChatCompletionId,
  getCurrentTimestamp,
  findModelById,
  selectTestCase,
  calculateTokens,
  randomChoice,
  formatErrorResponse,
} from "../utils/helpers";
/**
 * Get model list
 */
export function getModels(): ModelsResponse {
  const models: Model[] = mockModels.map((mockModel) => ({
    id: mockModel.id,
    object: "model",
    created: getCurrentTimestamp(),
    owned_by: "mock-openai",
  }));

  return {
    object: "list",
    data: models,
  };
}

/**
 * Create chat completion (non-streaming)
 */
export function createChatCompletion(
  request: ChatCompletionRequest
): ChatCompletionResponse {
  // Validate model
  const model = findModelById(request.model);
  if (!model) {
    return formatErrorResponse(`Model '${request.model}' does not exist`);
  }

  // Get last user message
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find((msg) => msg.role === "user");

  if (!lastUserMessage) {
    return formatErrorResponse("No user message found");
  }

  // Select test case
  const testCase = selectTestCase(model, lastUserMessage.content || "");

  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();

  // Build response message
  let content = testCase.response;

  // If it's a thinking-tag model and has reasoning_content, wrap it in <think> tags
  if (model.type === "thinking-tag" && testCase.reasoning_content) {
    content = `<think>\n${testCase.reasoning_content}\n</think>\n\n${testCase.response}`;
  }

  let responseMessage: ChatMessage = {
    role: "assistant",
    content,
  };

  // If it's a tool calls model, add tool calls
  if (model.type === "tool-calls" && testCase.toolCall) {
    responseMessage.content = null;
    responseMessage.tool_calls = [
      {
        id: testCase.toolCall.id || `call_${Date.now()}`,
        type: "function",
        function: {
          name: testCase.toolCall.name,
          arguments: JSON.stringify(testCase.toolCall.arguments),
        },
      },
    ];
  }

  const promptTokens = calculateTokens(lastUserMessage.content || "");
  const completionTokens = calculateTokens(testCase.response || "");
  const reasoningTokens = testCase.reasoning_content
    ? calculateTokens(testCase.reasoning_content)
    : 0;

  let finishReason = "stop";
  if (testCase.toolCall) {
    finishReason = "tool_calls";
  }

  const response: ChatCompletionResponse = {
    id,
    object: "chat.completion",
    created: timestamp,
    model: request.model,
    choices: [
      {
        index: 0,
        message: responseMessage,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens + reasoningTokens,
      completion_tokens_details: {
        reasoning_tokens: reasoningTokens,
      },
    },
  };

  return response;
}

/**
 * Create chat completion (streaming)
 */
export function* createChatCompletionStream(
  request: ChatCompletionRequest
): Generator<string, void, unknown> {
  // Validate model
  const model = findModelById(request.model);
  if (!model) {
    const errorChunk = `data: ${JSON.stringify(
      formatErrorResponse(`Model '${request.model}' does not exist`)
    )}\n\n`;
    yield errorChunk;
    return;
  }

  // Get last user message
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find((msg) => msg.role === "user");

  if (!lastUserMessage) {
    const errorChunk = `data: ${JSON.stringify(
      formatErrorResponse("No user message found")
    )}\n\n`;
    yield errorChunk;
    return;
  }

  // Select test case
  const testCase = selectTestCase(model, lastUserMessage.content || "");

  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();
  const systemFingerprint = `fp_${Math.random()
    .toString(36)
    .substr(2, 10)}_prod0425fp8`;

  let completionTokens = 0;
  let reasoningTokens = 0;

  // Handle tool calls first (tool-calls model type)
  if (model.type === "tool-calls" && testCase.toolCall) {
    // 第一阶段：发送tool call

    // Send first chunk - role and empty content
    const firstChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: "",
          },
          logprobs: null,
          finish_reason: null,
        },
      ],
      usage: null,
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    // Send tool call chunk with basic info
    const toolCallChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: testCase.toolCall.id || `call_0_${Date.now()}`,
                type: "function",
                function: {
                  name: testCase.toolCall.name,
                  arguments: "",
                },
              },
            ],
          },
          logprobs: null,
          finish_reason: null,
        },
      ],
      usage: null,
    };
    yield `data: ${JSON.stringify(toolCallChunk)}\n\n`;

    // Send arguments chunk
    const argumentsChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: JSON.stringify(testCase.toolCall.arguments),
                },
              },
            ],
          },
          logprobs: null,
          finish_reason: null,
        },
      ],
      usage: null,
    };
    yield `data: ${JSON.stringify(argumentsChunk)}\n\n`;

    // Send final chunk for first phase with tool_calls finish_reason
    const promptTokens = calculateTokens(lastUserMessage.content || "");
    const firstPhaseEndChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            content: "",
          },
          logprobs: null,
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: 19, // Based on real log
        total_tokens: promptTokens + 19,
        prompt_tokens_details: {
          cached_tokens: 768, // Based on real log
        },
        prompt_cache_hit_tokens: 768,
        prompt_cache_miss_tokens: 60,
      },
    };
    yield `data: ${JSON.stringify(firstPhaseEndChunk)}\n\n`;

    // Send end marker for first phase
    yield `data: [DONE]\n\n`;

    // 这里应该停止，等待外部系统调用工具并发起第二阶段请求
    // 在实际应用中，这里会是一个新的请求周期
    return;
  }

  if (model.type === "thinking") {
    // Thinking mode: output reasoning_content first, then content

    // Send first chunk - role and empty reasoning_content
    const firstChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            reasoning_content: testCase.reasoning_content || "",
          },
          finish_reason: null,
        },
      ],
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    // Output reasoning_content chunks
    if (testCase.reasoning_content && testCase.reasoning_chunks) {
      for (const chunk of testCase.reasoning_chunks) {
        const reasoningChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                reasoning_content: chunk,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
        reasoningTokens += calculateTokens(chunk);
      }
    }

    // Start outputting content, set reasoning_content to null
    const contentStartChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: null,
            content: "",
          },
          finish_reason: null,
        },
      ],
    };
    yield `data: ${JSON.stringify(contentStartChunk)}\n\n`;

    // Use predefined stream chunks if available
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunk of testCase.streamChunks) {
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: chunk,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunk);
      }
    } else {
      // Otherwise split the complete response into chunks
      const words = testCase.response.split(" ");
      for (let i = 0; i < words.length; i += 2) {
        const chunkText =
          words.slice(i, i + 2).join(" ") + (i + 2 < words.length ? " " : "");
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: chunkText,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunkText);
      }
    }
  } else if (model.type === "thinking-tag") {
    // thinking-tag mode: surround reasoning_content with <think> tags in content
    // Send first chunk - role and empty content
    const firstChunk: ChatCompletionStreamChunk = {
      id,
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: "",
          },
          finish_reason: null,
        },
      ],
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    if (testCase.reasoning_content) {
      // First output <think> start tag
      const thinkStartChunk: ChatCompletionStreamChunk = {
        id,
        object: "chat.completion.chunk",
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [
          {
            index: 0,
            delta: {
              content: "<think>\n",
            },
            finish_reason: null,
          },
        ],
      };
      yield `data: ${JSON.stringify(thinkStartChunk)}\n\n`;

      // Output reasoning_content chunks
      if (testCase.reasoning_chunks && testCase.reasoning_chunks.length > 0) {
        for (const chunk of testCase.reasoning_chunks) {
          const reasoningChunk: ChatCompletionStreamChunk = {
            id,
            object: "chat.completion.chunk",
            created: timestamp,
            model: request.model,
            system_fingerprint: systemFingerprint,
            choices: [
              {
                index: 0,
                delta: {
                  content: chunk,
                },
                finish_reason: null,
              },
            ],
          };
          yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
          reasoningTokens += calculateTokens(chunk);
        }
      } else {
        // Output complete reasoning_content
        const reasoningChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: testCase.reasoning_content,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(reasoningChunk)}\n\n`;
        reasoningTokens += calculateTokens(testCase.reasoning_content);
      }

      // Output </think> end tag and newline
      const thinkEndChunk: ChatCompletionStreamChunk = {
        id,
        object: "chat.completion.chunk",
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [
          {
            index: 0,
            delta: {
              content: "\n</think>\n\n",
            },
            finish_reason: null,
          },
        ],
      };
      yield `data: ${JSON.stringify(thinkEndChunk)}\n\n`;
    }

    // Output normal response content
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunk of testCase.streamChunks) {
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: chunk,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunk);
      }
    } else {
      // Otherwise split the complete response into chunks
      const words = testCase.response.split(" ");
      for (let i = 0; i < words.length; i += 2) {
        const chunkText =
          words.slice(i, i + 2).join(" ") + (i + 2 < words.length ? " " : "");
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: chunkText,
              },
              finish_reason: null,
            },
          ],
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
      object: "chat.completion.chunk",
      created: timestamp,
      model: request.model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: "",
          },
          finish_reason: null,
        },
      ],
    };
    yield `data: ${JSON.stringify(firstChunk)}\n\n`;

    // If there are predefined streaming chunks, use them
    if (testCase.streamChunks && testCase.streamChunks.length > 0) {
      for (const chunk of testCase.streamChunks) {
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: chunk,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunk);
      }
    } else {
      // Otherwise split the complete response into chunks
      const words = testCase.response.split(" ");
      for (let i = 0; i < words.length; i += 2) {
        const chunkText =
          words.slice(i, i + 2).join(" ") + (i + 2 < words.length ? " " : "");
        const streamChunk: ChatCompletionStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created: timestamp,
          model: request.model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {
                content: chunkText,
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
        completionTokens += calculateTokens(chunkText);
      }
    }
  }

  // Calculate token usage
  const promptTokens = calculateTokens(lastUserMessage.content || "");

  // Send last chunk - contains finish_reason and usage
  const lastChunk: ChatCompletionStreamChunk = {
    id,
    object: "chat.completion.chunk",
    created: timestamp,
    model: request.model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens + reasoningTokens,
      completion_tokens_details: {
        reasoning_tokens: reasoningTokens,
      },
    },
  };
  yield `data: ${JSON.stringify(lastChunk)}\n\n`;

  // Send end marker
  yield `data: [DONE]\n\n`;
}

/**
 * Create tool call response stream (second phase)
 * 这个函数处理tool call执行后的第二阶段流式响应
 */
export function* createToolCallResponseStream(
  request: ChatCompletionRequest
): Generator<string, void, unknown> {
  // Validate model
  const model = findModelById(request.model);
  if (!model || model.type !== "tool-calls") {
    const errorChunk = `data: ${JSON.stringify(
      formatErrorResponse(`Invalid model for tool call response`)
    )}\n\n`;
    yield errorChunk;
    return;
  }

  // Get last user message
  const lastUserMessage = request.messages
    .slice()
    .reverse()
    .find((msg) => msg.role === "user");

  if (!lastUserMessage) {
    const errorChunk = `data: ${JSON.stringify(
      formatErrorResponse("No user message found")
    )}\n\n`;
    yield errorChunk;
    return;
  }

  // Select test case
  const testCase = selectTestCase(model, lastUserMessage.content || "");

  const id = generateChatCompletionId();
  const timestamp = getCurrentTimestamp();
  const systemFingerprint = `fp_${Math.random()
    .toString(36)
    .substr(2, 10)}_prod0425fp8`;

  // Send first chunk - role and empty content for second phase
  const firstChunk: ChatCompletionStreamChunk = {
    id,
    object: "chat.completion.chunk",
    created: timestamp,
    model: request.model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: "",
        },
        logprobs: null,
        finish_reason: null,
      },
    ],
    usage: null,
  };
  yield `data: ${JSON.stringify(firstChunk)}\n\n`;

  let completionTokens = 0;

  // Use tool call response chunks if available
  if (
    testCase.toolCallResponseChunks &&
    testCase.toolCallResponseChunks.length > 0
  ) {
    for (const chunk of testCase.toolCallResponseChunks) {
      const streamChunk: ChatCompletionStreamChunk = {
        id,
        object: "chat.completion.chunk",
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [
          {
            index: 0,
            delta: {
              content: chunk,
            },
            logprobs: null,
            finish_reason: null,
          },
        ],
        usage: null,
      };
      yield `data: ${JSON.stringify(streamChunk)}\n\n`;
      completionTokens += calculateTokens(chunk);
    }
  } else if (testCase.toolCallResponse) {
    // Split the tool call response into chunks
    const words = testCase.toolCallResponse.split(" ");
    for (let i = 0; i < words.length; i++) {
      const chunkText = words[i] + (i < words.length - 1 ? " " : "");
      const streamChunk: ChatCompletionStreamChunk = {
        id,
        object: "chat.completion.chunk",
        created: timestamp,
        model: request.model,
        system_fingerprint: systemFingerprint,
        choices: [
          {
            index: 0,
            delta: {
              content: chunkText,
            },
            logprobs: null,
            finish_reason: null,
          },
        ],
        usage: null,
      };
      yield `data: ${JSON.stringify(streamChunk)}\n\n`;
      completionTokens += calculateTokens(chunkText);
    }
  }

  // Calculate token usage for second phase
  const promptTokens = calculateTokens(lastUserMessage.content || "") + 39; // Add some for tool call context

  // Send last chunk with usage information
  const lastChunk: ChatCompletionStreamChunk = {
    id,
    object: "chat.completion.chunk",
    created: timestamp,
    model: request.model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        delta: {
          content: "",
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: {
        cached_tokens: 768, // Based on real log
      },
      prompt_cache_hit_tokens: 768,
      prompt_cache_miss_tokens: 99,
    },
  };
  yield `data: ${JSON.stringify(lastChunk)}\n\n`;

  // Send end marker
  yield `data: [DONE]\n\n`;
}

/**
 * Generate image
 */
export function generateImage(
  request: ImageGenerationRequest
): ImageGenerationResponse {
  const n = request.n || 1;
  const timestamp = getCurrentTimestamp();
  const size = request.size || "1024x1024";

  // Choose different images based on model
  const model = request.model || "gpt-4o-image";
  let imageUrls = mockImageUrls;

  // If gpt-4o-image model is specified, use higher quality placeholder images
  if (model === "gpt-4o-image") {
    imageUrls = [
      `https://placehold.co/${size}/FF6B6B/FFFFFF?text=GPT-4O+Image+1`,
      `https://placehold.co/${size}/4ECDC4/FFFFFF?text=GPT-4O+Image+2`,
      `https://placehold.co/${size}/45B7D1/FFFFFF?text=GPT-4O+Image+3`,
      `https://placehold.co/${size}/96CEB4/FFFFFF?text=GPT-4O+Image+4`,
      `https://placehold.co/${size}/FFEAA7/000000?text=GPT-4O+Image+5`,
      `https://placehold.co/${size}/DDA0DD/000000?text=GPT-4O+Image+6`,
      `https://placehold.co/${size}/F0E68C/000000?text=GPT-4O+Image+7`,
      `https://placehold.co/${size}/FFA07A/000000?text=GPT-4O+Image+8`,
    ];
  }

  const data = Array.from({ length: n }, () => {
    const imageUrl = randomChoice(imageUrls);

    if (request.response_format === "b64_json") {
      // Simulate base64 encoded image (in actual applications this would be real base64)
      return {
        b64_json:
          "data:image/png;base64,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",
      };
    } else {
      return {
        url: imageUrl,
      };
    }
  });

  return {
    created: timestamp,
    data,
  };
}

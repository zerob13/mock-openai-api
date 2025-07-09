import { 
  GeminiGenerateContentRequest, 
  GeminiGenerateContentResponse, 
  GeminiModelsResponse, 
  GeminiStreamResponse,
  GeminiErrorResponse 
} from '../types/gemini';
import { geminiMockModels } from '../data/geminiMockData';
import { markdownTestCases } from '../data/testCases';

/**
 * Get Gemini model list
 */
export function getGeminiModels(): GeminiModelsResponse {
  const models = geminiMockModels.map(model => ({
    name: `models/${model.id}`,
    version: "001",
    displayName: model.name,
    description: model.description,
    inputTokenLimit: 30720,
    outputTokenLimit: 2048,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    temperature: 0.9,
    topP: 1.0,
    topK: 1
  }));

  return { models };
}

/**
 * Generate content (non-streaming)
 */
export function generateContent(request: GeminiGenerateContentRequest): GeminiGenerateContentResponse | GeminiErrorResponse {
  // Validate request
  if (!request.contents || request.contents.length === 0) {
    return {
      error: {
        code: 400,
        message: "Request must contain at least one content item",
        status: "INVALID_ARGUMENT"
      }
    };
  }

  // Get the latest user message
  const lastContent = request.contents[request.contents.length - 1];
  const userText = lastContent.parts.map(part => part.text || '').join(' ');

  // Use the first test case from markdown test cases
  const testCase = markdownTestCases[0];
  
  const promptTokenCount = Math.ceil(userText.length / 4);
  const candidatesTokenCount = Math.ceil(testCase.response.length / 4);

  return {
    candidates: [{
      content: {
        parts: [{
          text: testCase.response
        }],
        role: "model"
      },
      finishReason: "STOP",
      index: 0,
      safetyRatings: [
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          probability: "NEGLIGIBLE"
        }
      ]
    }],
    usageMetadata: {
      promptTokenCount,
      candidatesTokenCount,
      totalTokenCount: promptTokenCount + candidatesTokenCount
    }
  };
}

/**
 * Generate content (streaming)
 */
export function* streamGenerateContent(request: GeminiGenerateContentRequest): Generator<string, void, unknown> {
  // Validate request
  if (!request.contents || request.contents.length === 0) {
    const errorResponse = {
      error: {
        code: 400,
        message: "Request must contain at least one content item",
        status: "INVALID_ARGUMENT"
      }
    };
    yield `data: ${JSON.stringify(errorResponse)}\n\n`;
    return;
  }

  // Get the latest user message
  const lastContent = request.contents[request.contents.length - 1];
  const userText = lastContent.parts.map(part => part.text || '').join(' ');

  // Use the first test case from markdown test cases
  const testCase = markdownTestCases[0];
  
  const promptTokenCount = Math.ceil(userText.length / 4);
  
  // Stream the response in chunks
  const chunks = testCase.streamChunks || [testCase.response];
  let totalCandidatesTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTokens = Math.ceil(chunk.length / 4);
    totalCandidatesTokens += chunkTokens;

    const streamResponse: GeminiStreamResponse = {
      candidates: [{
        content: {
          parts: [{
            text: chunk
          }],
          role: "model"
        },
        finishReason: i === chunks.length - 1 ? "STOP" : "NONE",
        index: 0,
        safetyRatings: [
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            probability: "NEGLIGIBLE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            probability: "NEGLIGIBLE"
          },
          {
            category: "HARM_CATEGORY_HARASSMENT",
            probability: "NEGLIGIBLE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            probability: "NEGLIGIBLE"
          }
        ]
      }]
    };

    // Add usage metadata for the final chunk
    if (i === chunks.length - 1) {
      streamResponse.usageMetadata = {
        promptTokenCount,
        candidatesTokenCount: totalCandidatesTokens,
        totalTokenCount: promptTokenCount + totalCandidatesTokens
      };
    }

    yield `data: ${JSON.stringify(streamResponse)}\n\n`;
  }

  yield `data: [DONE]\n\n`;
}
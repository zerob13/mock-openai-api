import { describe, expect, it } from "vitest";
import {
  validateAnthropicCountTokensRequest,
  validateAnthropicMessageRequest,
} from "../../../src/core/validation/anthropicSchemas";
import {
  validateGeminiCountTokensRequest,
  validateGeminiGenerateContentRequest,
} from "../../../src/core/validation/geminiSchemas";
import {
  validateOpenAIChatCompletionRequest,
  validateOpenAIEmbeddingsRequest,
  validateOpenAIResponsesRequest,
} from "../../../src/core/validation/openaiSchemas";

describe("core provider validation schemas", () => {
  it("validates OpenAI chat, responses, and embeddings requests", () => {
    expect(
      validateOpenAIChatCompletionRequest({
        model: "gpt-4.1-mini",
        messages: [
          { role: "developer", content: "Be concise." },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image." },
              { type: "image_url", image_url: { url: "mock://image.png" } },
            ],
          },
        ],
        tools: [{ type: "function", function: { name: "get_order" } }],
        response_format: { type: "json_schema" },
      })
    ).toEqual({ ok: true });

    expect(
      validateOpenAIChatCompletionRequest({
        model: "gpt-4.1-mini",
        messages: [{ role: "bad", content: "Hello" }],
      })
    ).toMatchObject({ ok: false, issue: { message: "messages contains an invalid role" } });

    expect(
      validateOpenAIResponsesRequest({
        input: "Hello",
        text: { format: { type: "json_schema" } },
        tools: [{ type: "function", name: "get_order" }],
      })
    ).toEqual({ ok: true });
    expect(validateOpenAIResponsesRequest({ tools: [{ type: "function" }] })).toMatchObject({
      ok: false,
      issue: { message: "function tool requires name" },
    });

    expect(
      validateOpenAIEmbeddingsRequest({
        model: "text-embedding-3-small",
        input: ["Hello", "World"],
        dimensions: 4,
        encoding_format: "base64",
      })
    ).toEqual({ ok: true });
    expect(validateOpenAIEmbeddingsRequest({ model: "text-embedding-3-small", input: "Hello", dimensions: 0 })).toMatchObject({
      ok: false,
      issue: { message: "dimensions must be an integer between 1 and 2048" },
    });
  });

  it("validates Anthropic message and token-count requests", () => {
    expect(
      validateAnthropicMessageRequest({
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [
          { role: "user", content: "Look up order A100." },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "toolu_mock_0001", name: "get_order", input: { order_id: "A100" } }],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_mock_0001", content: "{}" }],
          },
        ],
        thinking: { type: "enabled", budget_tokens: 1024 },
      })
    ).toEqual({ ok: true });

    expect(
      validateAnthropicMessageRequest({
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [{ role: "user", content: [{ type: "image" }] }],
      })
    ).toMatchObject({ ok: false, issue: { message: "image block requires source" } });

    expect(
      validateAnthropicCountTokensRequest({
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "Hello" }],
        tools: [{ name: "get_order", input_schema: { type: "object" } }],
      })
    ).toEqual({ ok: true });
  });

  it("validates Gemini generateContent and countTokens requests", () => {
    expect(
      validateGeminiGenerateContentRequest({
        contents: [
          {
            role: "user",
            parts: [{ text: "Hello" }, { inlineData: { mimeType: "image/png", data: "AAA=" } }],
          },
        ],
        tools: [{ functionDeclarations: [{ name: "get_order" }] }],
        generationConfig: { responseMimeType: "application/json" },
      })
    ).toEqual({ ok: true });

    expect(
      validateGeminiGenerateContentRequest({
        contents: [{ role: "user", parts: [{ text: "Hello", fileData: { fileUri: "mock://file" } }] }],
      })
    ).toMatchObject({ ok: false, issue: { message: "part must contain exactly one supported field" } });

    expect(
      validateGeminiGenerateContentRequest({
        contents: [
          { role: "model", parts: [{ functionCall: { id: "fc_mock_0001", name: "get_order", args: {} } }] },
          {
            role: "user",
            parts: [{ functionResponse: { id: "fc_mock_other", name: "get_order", response: {} } }],
          },
        ],
      })
    ).toMatchObject({
      ok: false,
      issue: { message: "functionResponse id does not match a previous functionCall id" },
    });

    expect(
      validateGeminiCountTokensRequest({
        generateContentRequest: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      })
    ).toEqual({ ok: true });
  });
});

import { describe, expect, it } from "vitest";
import { anthropicEvent, anthropicMessageStop } from "../../../src/core/sse/anthropicSse";
import { geminiData, geminiDone, encodeGeminiSse } from "../../../src/core/sse/geminiSse";
import { encodeOpenAISse, openAIDone, openAIEvent } from "../../../src/core/sse/openaiSse";
import { splitSseFrames } from "../../../src/core/sse/streamWriter";

describe("provider SSE encoders", () => {
  it("formats OpenAI named events and terminal done markers", () => {
    expect(openAIEvent("response.created", { type: "response.created" })).toBe(
      'event: response.created\ndata: {"type":"response.created"}\n\n'
    );
    expect(openAIDone()).toBe("data: [DONE]\n\n");
    expect(encodeOpenAISse([{ data: { id: "chatcmpl_mock_0001" } }])).toContain("data: [DONE]");
  });

  it("formats Anthropic named events and message_stop terminal event", () => {
    expect(anthropicEvent("content_block_delta", { type: "content_block_delta" })).toBe(
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'
    );
    expect(anthropicMessageStop()).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });

  it("formats Gemini data chunks and terminal done markers", () => {
    expect(geminiData({ responseId: "gemini_mock_0001" })).toBe(
      'data: {"responseId":"gemini_mock_0001"}\n\n'
    );
    expect(geminiDone()).toBe("data: [DONE]\n\n");
    expect(encodeGeminiSse([{ candidates: [] }])).toBe('data: {"candidates":[]}\n\ndata: [DONE]\n\n');
  });

  it("splits encoded SSE payloads without dropping frame terminators", () => {
    expect(splitSseFrames('data: {"a":1}\n\ndata: [DONE]\n\n')).toEqual([
      'data: {"a":1}\n\n',
      "data: [DONE]\n\n",
    ]);
  });
});

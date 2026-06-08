import { describe, expect, it } from "vitest";
import { matchFixture } from "../../../src/core/fixtures/fixtureMatcher";
import { FixtureStore } from "../../../src/core/fixtures/fixtureStore";
import {
  buildAnthropicUsage,
  buildGeminiUsage,
  buildOpenAIChatUsage,
  buildOpenAIResponsesUsage,
} from "../../../src/core/usage/usageBuilder";

describe("usage builders and fixtures", () => {
  it("builds deterministic approximate usage for each provider", () => {
    expect(buildOpenAIResponsesUsage("hello", "world", 2)).toEqual({
      input_tokens: 2,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 6,
    });
    expect(buildOpenAIChatUsage("hello", "world")).toEqual({
      prompt_tokens: 2,
      completion_tokens: 2,
      total_tokens: 4,
    });
    expect(buildAnthropicUsage("hello", "world")).toEqual({ input_tokens: 2, output_tokens: 2 });
    expect(buildGeminiUsage("hello", "world")).toEqual({
      promptTokenCount: 2,
      candidatesTokenCount: 2,
      totalTokenCount: 4,
    });
  });

  it("matches exact fixtures before falling back to simple_text", () => {
    const store = new FixtureStore();
    store.register({
      provider: "openai",
      endpoint: "responses",
      scenario: "simple_text",
      data: { text: "fallback" },
    });
    store.register({
      provider: "openai",
      endpoint: "responses",
      scenario: "tool_call",
      data: { tool: "exact" },
    });

    expect(
      matchFixture<{ tool: string }>(store, {
        provider: "openai",
        endpoint: "responses",
        scenario: "tool_call",
      })?.data
    ).toEqual({ tool: "exact" });
    expect(
      matchFixture<{ text: string }>(store, {
        provider: "openai",
        endpoint: "responses",
        scenario: "refusal",
      })?.data
    ).toEqual({ text: "fallback" });
  });
});

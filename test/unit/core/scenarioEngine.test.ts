import { describe, expect, it } from "vitest";
import { selectScenario, ScenarioInput } from "../../../src/core/scenarioEngine";

function scenarioInput(input: Partial<ScenarioInput>): ScenarioInput {
  return {
    provider: "openai",
    endpoint: "/v1/responses",
    method: "POST",
    headers: {},
    query: {},
    body: {},
    ...input,
  };
}

describe("ScenarioEngine", () => {
  it("prioritizes forced mock errors over explicit scenarios and request shape", () => {
    const selection = selectScenario(
      scenarioInput({
        headers: {
          "x-mock-error": "429",
          "x-mock-scenario": "structured_json",
        },
        body: { stream: true },
      })
    );

    expect(selection).toMatchObject({
      scenario: "rate_limit",
      forcedError: 429,
    });
  });

  it("prioritizes explicit scenarios over inferred request shape", () => {
    const selection = selectScenario(
      scenarioInput({
        headers: { "x-mock-scenario": "refusal" },
        body: { stream: true, tools: [{ type: "function", name: "lookup" }] },
      })
    );

    expect(selection.scenario).toBe("refusal");
  });

  it("reads query controls for scenario, seed, latency, and stream chunk delay", () => {
    const selection = selectScenario(
      scenarioInput({
        query: {
          mock_scenario: "structured_json",
          mock_seed: "contract-1",
          mock_latency_ms: "25",
          mock_stream_chunk_ms: "3",
        },
      })
    );

    expect(selection).toMatchObject({
      scenario: "structured_json",
      seed: "contract-1",
      latencyMs: 25,
      streamChunkMs: 3,
    });
  });

  it("infers scenarios from request shape", () => {
    expect(selectScenario(scenarioInput({ body: { stream: true } })).scenario).toBe("stream_text");
    expect(
      selectScenario(
        scenarioInput({
          body: { input: [{ type: "function_call_output", call_id: "call_mock_0001", output: "{}" }] },
        })
      ).scenario
    ).toBe("tool_result");
    expect(
      selectScenario(
        scenarioInput({
          body: { tools: [{ type: "function", name: "get_order" }] },
        })
      ).scenario
    ).toBe("tool_call");
    expect(
      selectScenario(
        scenarioInput({
          body: { tools: [{ type: "function", name: "a" }, { type: "function", name: "b" }] },
        })
      ).scenario
    ).toBe("parallel_tools");
    expect(
      selectScenario(
        scenarioInput({
          body: { text: { format: { type: "json_schema" } } },
        })
      ).scenario
    ).toBe("structured_json");
    expect(
      selectScenario(
        scenarioInput({
          body: { input: [{ type: "input_image", image_url: "mock://image.png" }] },
        })
      ).scenario
    ).toBe("vision");
    expect(
      selectScenario(
        scenarioInput({
          body: { contents: [{ parts: [{ inlineData: { mimeType: "audio/wav", data: "AAA=" } }] }] },
        })
      ).scenario
    ).toBe("multimodal_audio");
    expect(
      selectScenario(
        scenarioInput({
          body: { contents: [{ parts: [{ inlineData: { mimeType: "video/mp4", data: "AAA=" } }] }] },
        })
      ).scenario
    ).toBe("multimodal_video");
    expect(
      selectScenario(
        scenarioInput({
          body: { contents: [{ parts: [{ fileData: { fileUri: "mock://files/file_mock_0001" } }] }] },
        })
      ).scenario
    ).toBe("file_reference");
  });

  it("infers scenarios from model name hints before falling back to simple text", () => {
    expect(selectScenario(scenarioInput({ model: "mock-thinking-model" })).scenario).toBe("thinking");
    expect(selectScenario(scenarioInput({ model: "mock-json-model" })).scenario).toBe("structured_json");
    expect(selectScenario(scenarioInput({ model: "mock-refusal-model" })).scenario).toBe("refusal");
    expect(selectScenario(scenarioInput({ model: "plain-model" })).scenario).toBe("simple_text");
  });
});

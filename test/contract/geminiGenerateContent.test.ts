import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { collectSse, parseSseEvents } from "./helpers";

const baseRequest = {
  contents: [
    {
      role: "user",
      parts: [{ text: "Hello" }],
    },
  ],
};

describe("Gemini GenerateContent API contract", () => {
  it("returns functionCall parts when function declarations are present", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        ...baseRequest,
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_order",
                parameters: { type: "OBJECT" },
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(response.body.candidates[0].content.parts).toEqual([
      {
        functionCall: {
          id: expect.stringMatching(/^fc_mock_/),
          name: "get_order",
          args: { order_id: "A100" },
        },
      },
    ]);
  });

  it("returns multiple functionCall parts for parallel functions", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .set("x-mock-scenario", "parallel_tools")
      .send({
        ...baseRequest,
        tools: [
          {
            functionDeclarations: [
              { name: "get_order", parameters: { type: "OBJECT" } },
              { name: "get_weather", parameters: { type: "OBJECT" } },
            ],
          },
        ],
      })
      .expect(200);

    expect(response.body.candidates[0].content.parts.map((part: { functionCall: { name: string } }) => part.functionCall.name)).toEqual([
      "get_order",
      "get_weather",
    ]);
  });

  it("returns final text for functionResponse follow-ups", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        contents: [
          {
            role: "user",
            parts: [{ text: "Get the delivery status for order A100." }],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "fc_mock_0001",
                  name: "get_order",
                  args: { order_id: "A100" },
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "fc_mock_0001",
                  name: "get_order",
                  response: { status: "out_for_delivery", eta: "today by 18:00" },
                },
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(response.body.candidates[0].content.parts[0].text).toContain("out_for_delivery");
  });

  it("rejects functionResponse IDs that do not match a previous functionCall ID", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        contents: [
          {
            role: "user",
            parts: [{ text: "Get the delivery status for order A100." }],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "fc_mock_0001",
                  name: "get_order",
                  args: { order_id: "A100" },
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "fc_mock_other",
                  name: "get_order",
                  response: { status: "out_for_delivery" },
                },
              },
            ],
          },
        ],
      })
      .expect(400);

    expect(response.body.error).toMatchObject({
      status: "INVALID_ARGUMENT",
      message: "functionResponse id does not match a previous functionCall id",
    });
  });

  it("returns structured JSON and enum-compatible text", async () => {
    const json = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        ...baseRequest,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT" },
        },
      })
      .expect(200);
    expect(JSON.parse(json.body.candidates[0].content.parts[0].text)).toEqual({
      name: "UltraWidget",
      price: 19.99,
      currency: "USD",
    });

    const enumResponse = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        ...baseRequest,
        generationConfig: {
          responseMimeType: "text/x.enum",
          responseSchema: { type: "STRING", enum: ["positive", "negative", "neutral"] },
        },
      })
      .expect(200);
    expect(enumResponse.body.candidates[0].content.parts[0].text).toBe("positive");
  });

  it("returns safety block metadata for safety scenarios", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .set("x-mock-scenario", "safety_block")
      .send(baseRequest)
      .expect(200);

    expect(response.body.promptFeedback).toMatchObject({ blockReason: "SAFETY" });
    expect(response.body.candidates[0].finishReason).toBe("SAFETY");
  });

  it("supports code execution and Google Search tool mocks", async () => {
    const codeExecution = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        ...baseRequest,
        tools: [{ codeExecution: {} }],
      })
      .expect(200);
    expect(codeExecution.body.candidates[0].content.parts).toEqual([
      { executableCode: { language: "PYTHON", code: 'print("mock code execution")' } },
      { codeExecutionResult: { outcome: "OUTCOME_OK", output: "mock code execution\n" } },
    ]);

    const search = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        ...baseRequest,
        tools: [{ googleSearch: {} }],
      })
      .expect(200);
    expect(search.body.candidates[0]).toMatchObject({
      groundingMetadata: {
        groundingChunks: [expect.objectContaining({ web: expect.any(Object) })],
      },
    });
  });

  it.each([
    [{ inlineData: { mimeType: "image/png", data: "AAA=" } }, "image input"],
    [{ inlineData: { mimeType: "audio/wav", data: "AAA=" } }, "audio input"],
    [{ inlineData: { mimeType: "video/mp4", data: "AAA=" } }, "video input"],
    [{ fileData: { mimeType: "application/pdf", fileUri: "mock://files/file_mock_0001" } }, "file reference"],
  ])("acknowledges %s", async (part, label) => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        contents: [
          {
            role: "user",
            parts: [part, { text: `Summarize this ${label}.` }],
          },
        ],
      })
      .expect(200);

    expect(response.body.candidates[0].content.parts[0].text).toContain("mock Gemini model");
  });

  it("streams function calls and text chunks as parseable SSE", async () => {
    const functionStream = await collectSse(
      request(app)
        .post("/v1beta/models/gemini-1.5-flash:streamGenerateContent")
        .send({
          ...baseRequest,
          tools: [
            {
              functionDeclarations: [{ name: "get_order", parameters: { type: "OBJECT" } }],
            },
          ],
        })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );
    const functionEvents = parseSseEvents(functionStream.body);
    expect(functionEvents[0].data).toMatchObject({
      candidates: [
        {
          content: {
            parts: [{ functionCall: expect.objectContaining({ name: "get_order" }) }],
          },
        },
      ],
    });
    expect(functionEvents.at(-1)?.data).toMatchObject({
      candidates: [
        {
          content: {
            parts: [{ functionCall: expect.objectContaining({ name: "get_order" }) }],
          },
        },
      ],
    });

    const legacyTextStream = await collectSse(
      request(app)
        .post("/gemini/v1/models/gemini-1.5-flash/streamGenerateContent")
        .send(baseRequest)
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );
    const textEvents = parseSseEvents(legacyTextStream.body);
    expect(textEvents.at(-1)?.data).toMatchObject({
      candidates: [
        expect.objectContaining({
          finishReason: "STOP",
        }),
      ],
    });
    expect(textEvents[0].data).toMatchObject({
      candidates: [
        {
          content: { parts: [expect.objectContaining({ text: expect.any(String) })] },
        },
      ],
    });
  });

  it("counts tokens for contents and generateContentRequest payloads", async () => {
    const contentsCount = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:countTokens")
      .send(baseRequest)
      .expect(200);
    expect(contentsCount.body.totalTokens).toBeGreaterThan(0);

    const nestedCount = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:countTokens")
      .send({ generateContentRequest: { ...baseRequest, systemInstruction: { parts: [{ text: "Be concise." }] } } })
      .expect(200);
    expect(nestedCount.body.totalTokens).toBeGreaterThan(contentsCount.body.totalTokens);
  });

  it("returns Gemini-style validation and injected errors", async () => {
    const validation = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({})
      .expect(400);
    expect(validation.body).toEqual({
      error: {
        code: 400,
        message: "Request must contain at least one content item",
        status: "INVALID_ARGUMENT",
      },
    });

    const rateLimit = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .set("x-mock-error", "429")
      .send(baseRequest)
      .expect(429);
    expect(rateLimit.body.error.status).toBe("RESOURCE_EXHAUSTED");

    const unavailable = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent?mock_error=529")
      .send(baseRequest)
      .expect(529);
    expect(unavailable.body.error.status).toBe("UNAVAILABLE");

    const invalidToolArgs = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .set("x-mock-scenario", "invalid_tool_args")
      .send(baseRequest)
      .expect(400);
    expect(invalidToolArgs.body.error).toMatchObject({
      status: "INVALID_ARGUMENT",
      message: "Invalid mock tool arguments.",
    });
  });

  it("rejects invalid Gemini parts with provider error shape", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        contents: [{ role: "user", parts: [{ text: "Hello", fileData: { fileUri: "mock://file" } }] }],
      })
      .expect(400);

    expect(response.body.error).toMatchObject({
      status: "INVALID_ARGUMENT",
      message: "part must contain exactly one supported field",
    });
  });
});

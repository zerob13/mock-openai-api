import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { collectSse, parseSseEvents } from "./helpers";

const openAiChatRequest = {
  model: "mock-gpt-thinking",
  messages: [{ role: "user", content: "Hello" }],
};

const anthropicMessageRequest = {
  model: "mock-claude-markdown",
  max_tokens: 256,
  messages: [{ role: "user", content: "Hello" }],
};

const geminiGenerateRequest = {
  contents: [
    {
      role: "user",
      parts: [{ text: "Hello" }],
    },
  ],
};

describe("legacy baseline contract", () => {
  it("returns health status without provider credentials", async () => {
    const response = await request(app).get("/health").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      message: "Mock OpenAI API server is running",
      version: expect.any(String),
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it("returns a current endpoint summary from the root endpoint", async () => {
    const response = await request(app).get("/").expect(200);

    expect(response.body.availableEndpoints).toEqual(
      expect.arrayContaining([
        "POST /v1/responses",
        "POST /v1/messages/count_tokens",
        "POST /upload/v1beta/files",
        "POST /v1beta/cachedContents",
      ])
    );
  });

  it.each(["/v1/models", "/models"])("returns OpenAI model list from %s", async (path) => {
    const response = await request(app).get(path).expect(200);

    expect(response.body.object).toBe("list");
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mock-gpt-thinking",
          object: "model",
          owned_by: "mock-openai",
          created: expect.any(Number),
        }),
      ])
    );
  });

  it("returns Anthropic and Gemini model shapes from /v1/models when provider is explicit", async () => {
    const anthropic = await request(app)
      .get("/v1/models")
      .set("anthropic-version", "2023-06-01")
      .expect(200);
    expect(anthropic.body).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ id: "mock-claude-markdown", type: "model" }),
      ]),
      has_more: false,
    });

    const gemini = await request(app).get("/v1/models?provider=gemini").expect(200);
    expect(gemini.body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "models/gemini-1.5-flash" }),
      ])
    );
  });

  it.each(["/v1/chat/completions", "/chat/completions"])(
    "creates an OpenAI chat completion from %s",
    async (path) => {
      const response = await request(app).post(path).send(openAiChatRequest).expect(200);

      expect(response.body).toMatchObject({
        id: expect.stringMatching(/^chatcmpl(?:-|_mock_)/),
        object: "chat.completion",
        created: expect.any(Number),
        model: openAiChatRequest.model,
        choices: [
          expect.objectContaining({
            index: 0,
            finish_reason: "stop",
            message: expect.objectContaining({
              role: "assistant",
              content: expect.any(String),
            }),
          }),
        ],
        usage: expect.objectContaining({
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
          total_tokens: expect.any(Number),
        }),
      });
    }
  );

  it("streams OpenAI chat completion chunks and terminates with DONE", async () => {
    const response = await collectSse(
      request(app)
        .post("/v1/chat/completions")
        .send({ ...openAiChatRequest, stream: true })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const events = parseSseEvents(response.body);
    expect(events.at(-1)?.data).toBe("[DONE]");
    expect(events[0].data).toMatchObject({
      object: "chat.completion.chunk",
      choices: [expect.objectContaining({ delta: expect.objectContaining({ role: "assistant" }) })],
    });
  });

  it.each(["/v1/images/generations", "/images/generations"])(
    "creates OpenAI image generation data from %s",
    async (path) => {
      const response = await request(app)
        .post(path)
        .send({
          model: "gpt-4o-image",
          prompt: "A cute orange cat",
          n: 2,
          size: "1024x1024",
        })
        .expect(200);

      expect(response.body.created).toEqual(expect.any(Number));
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toEqual(
        expect.objectContaining({
          url: expect.any(String),
        })
      );
    }
  );

  it("returns OpenAI validation errors with provider shape", async () => {
    const response = await request(app)
      .post("/v1/chat/completions")
      .send({ messages: [{ role: "user", content: "Hello" }] })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        message: "Missing required parameter: model",
        type: "invalid_request_error",
        code: "missing_parameter",
      },
    });
  });

  it("returns image validation errors with provider shape", async () => {
    const response = await request(app).post("/v1/images/generations").send({}).expect(400);

    expect(response.body.error).toMatchObject({
      message: "Missing required parameter: prompt",
      type: "invalid_request_error",
      code: "missing_parameter",
    });
  });

  it("returns Anthropic model list from the preserved alias", async () => {
    const response = await request(app).get("/anthropic/v1/models").expect(200);

    expect(response.body).toMatchObject({
      first_id: "mock-claude-markdown",
      last_id: "mock-claude-markdown",
      has_more: false,
    });
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mock-claude-markdown",
          type: "model",
          display_name: expect.any(String),
        }),
      ])
    );
  });

  it("creates Anthropic message responses from the preserved alias", async () => {
    const response = await request(app)
      .post("/anthropic/v1/messages")
      .send(anthropicMessageRequest)
      .expect(200);

    expect(response.body).toMatchObject({
      id: expect.stringMatching(/^msg_/),
      type: "message",
      role: "assistant",
      model: anthropicMessageRequest.model,
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [expect.objectContaining({ type: "text", text: expect.any(String) })],
      usage: expect.objectContaining({
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
      }),
    });
  });

  it("streams Anthropic message events from the preserved alias", async () => {
    const response = await collectSse(
      request(app)
        .post("/anthropic/v1/messages")
        .send({ ...anthropicMessageRequest, stream: true })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const events = parseSseEvents(response.body);
    expect(events.map((event) => event.event)).toContain("message_start");
    expect(events.map((event) => event.event)).toContain("content_block_delta");
    expect(events.at(-1)).toMatchObject({ event: "message_stop", data: { type: "message_stop" } });
  });

  it("returns Anthropic validation errors with provider shape", async () => {
    const response = await request(app)
      .post("/anthropic/v1/messages")
      .send({ model: "mock-claude-markdown" })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        message: "Missing required fields: model, messages, or max_tokens",
        type: "invalid_request_error",
      },
      type: "error",
    });
  });

  it.each(["/v1beta/models", "/gemini/v1/models"])(
    "returns Gemini model list from %s",
    async (path) => {
      const response = await request(app).get(path).expect(200);

      expect(response.body.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "models/gemini-1.5-flash",
            supportedGenerationMethods: expect.arrayContaining([
              "generateContent",
              "streamGenerateContent",
            ]),
          }),
        ])
      );
    }
  );

  it.each([
    "/v1beta/models/gemini-1.5-flash:generateContent",
    "/gemini/v1/models/gemini-1.5-flash/generateContent",
  ])("generates Gemini content from %s", async (path) => {
    const response = await request(app).post(path).send(geminiGenerateRequest).expect(200);

    expect(response.body).toMatchObject({
      candidates: [
        expect.objectContaining({
          content: expect.objectContaining({
            role: "model",
            parts: [expect.objectContaining({ text: expect.any(String) })],
          }),
          finishReason: "STOP",
          index: 0,
        }),
      ],
      usageMetadata: expect.objectContaining({
        promptTokenCount: expect.any(Number),
        candidatesTokenCount: expect.any(Number),
        totalTokenCount: expect.any(Number),
      }),
    });
  });

  it.each([
    "/v1beta/models/gemini-1.5-flash:streamGenerateContent",
    "/gemini/v1/models/gemini-1.5-flash/streamGenerateContent",
  ])("streams Gemini content from %s", async (path) => {
    const response = await collectSse(
      request(app)
        .post(path)
        .send(geminiGenerateRequest)
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const events = parseSseEvents(response.body);
    expect(events.at(-1)?.data).toMatchObject({
      candidates: [
        expect.objectContaining({
          finishReason: "STOP",
        }),
      ],
    });
    expect(events[0].data).toMatchObject({
      candidates: [
        expect.objectContaining({
          content: expect.objectContaining({
            parts: [expect.objectContaining({ text: expect.any(String) })],
          }),
        }),
      ],
    });
  });

  it("returns Gemini validation errors with provider shape", async () => {
    const response = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({})
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: 400,
        message: "Request must contain at least one content item",
        status: "INVALID_ARGUMENT",
      },
    });
  });
});

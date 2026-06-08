import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { collectSse, parseSseEvents } from "./helpers";

const baseRequest = {
  model: "gpt-4.1-mini",
  messages: [{ role: "user", content: "Hello" }],
};

describe("OpenAI Chat Completions modern contract", () => {
  it("accepts developer role and stores/retrieves/deletes chat completions", async () => {
    const created = await request(app)
      .post("/v1/chat/completions")
      .send({
        ...baseRequest,
        messages: [
          { role: "developer", content: "Answer tersely." },
          { role: "user", content: "Give a project status." },
        ],
        metadata: { suite: "contract" },
      })
      .expect(200);

    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^chatcmpl_mock_/),
      object: "chat.completion",
      model: "gpt-4.1-mini",
      choices: [
        expect.objectContaining({
          message: expect.objectContaining({ role: "assistant", content: expect.any(String) }),
          finish_reason: "stop",
        }),
      ],
      usage: {
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      },
      metadata: { suite: "contract" },
    });

    const retrieved = await request(app).get(`/v1/chat/completions/${created.body.id}`).expect(200);
    expect(retrieved.body.id).toBe(created.body.id);

    const messages = await request(app)
      .get(`/v1/chat/completions/${created.body.id}/messages`)
      .expect(200);
    expect(messages.body).toMatchObject({
      object: "list",
      has_more: false,
      data: expect.arrayContaining([
        expect.objectContaining({ role: "developer" }),
        expect.objectContaining({ role: "assistant" }),
      ]),
    });

    const updated = await request(app)
      .post(`/v1/chat/completions/${created.body.id}`)
      .send({ metadata: { suite: "updated" } })
      .expect(200);
    expect(updated.body.metadata).toEqual({ suite: "updated" });

    const deleted = await request(app).delete(`/v1/chat/completions/${created.body.id}`).expect(200);
    expect(deleted.body).toEqual({
      id: created.body.id,
      object: "chat.completion.deleted",
      deleted: true,
    });
    await request(app).get(`/v1/chat/completions/${created.body.id}`).expect(404);
  });

  it("handles content parts for image, audio, and file inputs", async () => {
    const cases = [
      [{ type: "text", text: "Describe this image" }, { type: "image_url", image_url: { url: "mock://image.png" } }],
      [{ type: "text", text: "Transcribe this audio" }, { type: "input_audio", input_audio: { data: "AAA=", format: "wav" } }],
      [{ type: "text", text: "Summarize this file" }, { type: "file", file: { file_id: "file_mock_0001" } }],
    ];

    for (const content of cases) {
      const response = await request(app)
        .post("/v1/chat/completions")
        .send({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content }],
        })
        .expect(200);

      expect(response.body.choices[0].message.content).toContain("mock");
    }
  });

  it("returns schema-compatible JSON when response_format requests JSON schema", async () => {
    const response = await request(app)
      .post("/v1/chat/completions")
      .send({
        ...baseRequest,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "product_extract",
            schema: { type: "object" },
          },
        },
      })
      .expect(200);

    expect(JSON.parse(response.body.choices[0].message.content)).toEqual({
      name: "UltraWidget",
      price: 19.99,
      currency: "USD",
    });
  });

  it("returns tool calls and parallel tool calls", async () => {
    const toolCall = await request(app)
      .post("/v1/chat/completions")
      .send({
        ...baseRequest,
        tools: [{ type: "function", function: { name: "get_order", parameters: { type: "object" } } }],
      })
      .expect(200);

    expect(toolCall.body.choices[0]).toMatchObject({
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: expect.stringMatching(/^call_mock_/),
            type: "function",
            function: { name: "get_order", arguments: JSON.stringify({ order_id: "A100" }) },
          },
        ],
      },
    });

    const parallel = await request(app)
      .post("/v1/chat/completions")
      .send({
        ...baseRequest,
        parallel_tool_calls: true,
        tools: [
          { type: "function", function: { name: "get_order" } },
          { type: "function", function: { name: "get_weather" } },
        ],
      })
      .expect(200);

    expect(parallel.body.choices[0].message.tool_calls.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
      "get_order",
      "get_weather",
    ]);
  });

  it("returns a final text response after tool result messages", async () => {
    const response = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "gpt-4.1-mini",
        messages: [
          { role: "user", content: "Look up order A100." },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_mock_0001",
                type: "function",
                function: { name: "get_order", arguments: '{"order_id":"A100"}' },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_mock_0001",
            content: '{"status":"out_for_delivery"}',
          },
        ],
      })
      .expect(200);

    expect(response.body.choices[0].finish_reason).toBe("stop");
    expect(response.body.choices[0].message.content).toContain("out_for_delivery");
  });

  it("streams text chunks with include_usage and streams tool call deltas", async () => {
    const textStream = await collectSse(
      request(app)
        .post("/v1/chat/completions")
        .send({ ...baseRequest, stream: true, stream_options: { include_usage: true } })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );
    const textEvents = parseSseEvents(textStream.body);
    expect(textEvents.at(-1)?.data).toBe("[DONE]");
    expect(textEvents.at(-2)?.data).toMatchObject({
      object: "chat.completion.chunk",
      choices: [],
      usage: {
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      },
    });

    const toolStream = await collectSse(
      request(app)
        .post("/v1/chat/completions")
        .send({
          ...baseRequest,
          stream: true,
          tools: [{ type: "function", function: { name: "get_order" } }],
        })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );
    const toolEvents = parseSseEvents(toolStream.body);
    expect(toolEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            choices: [
              expect.objectContaining({
                delta: expect.objectContaining({
                  tool_calls: [
                    expect.objectContaining({
                      function: expect.objectContaining({ name: "get_order" }),
                    }),
                  ],
                }),
              }),
            ],
          }),
        }),
      ])
    );
  });

  it("returns OpenAI-style validation and injected errors", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send({ messages: [{ role: "user", content: "Hello" }] })
      .expect(400)
      .expect({
        error: {
          message: "Missing required parameter: model",
          type: "invalid_request_error",
          code: "missing_parameter",
        },
      });

    const invalidRole = await request(app)
      .post("/v1/chat/completions")
      .send({ model: "gpt-4.1-mini", messages: [{ role: "bad", content: "Hello" }] })
      .expect(400);
    expect(invalidRole.body.error).toMatchObject({
      message: "messages contains an invalid role",
      type: "invalid_request_error",
    });

    const rateLimit = await request(app)
      .post("/v1/chat/completions")
      .set("x-mock-error", "429")
      .send(baseRequest)
      .expect(429);
    expect(rateLimit.body.error.type).toBe("rate_limit_error");

    const invalidToolArgs = await request(app)
      .post("/v1/chat/completions")
      .set("x-mock-scenario", "invalid_tool_args")
      .send(baseRequest)
      .expect(400);
    expect(invalidToolArgs.body.error).toMatchObject({
      type: "invalid_request_error",
      message: "Invalid mock tool arguments.",
    });
  });

  it("rejects invalid OpenAI chat content parts with provider error shape", async () => {
    const response = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: [{ type: "image_url" }] }],
      })
      .expect(400);

    expect(response.body.error).toMatchObject({
      message: "image_url content part requires image_url",
      type: "invalid_request_error",
    });
  });
});

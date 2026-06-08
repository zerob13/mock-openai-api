import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { collectSse, parseSseEvents } from "./helpers";

const baseRequest = {
  model: "claude-sonnet-4-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Hello" }],
};

describe("Anthropic Messages API contract", () => {
  it.each(["/v1/messages", "/anthropic/v1/messages"])(
    "creates simple text messages from %s",
    async (path) => {
      const response = await request(app).post(path).send(baseRequest).expect(200);

      expect(response.body).toMatchObject({
        id: expect.stringMatching(/^msg_mock_/),
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        stop_reason: "end_turn",
        stop_sequence: null,
        content: [expect.objectContaining({ type: "text", text: expect.any(String) })],
        usage: {
          input_tokens: expect.any(Number),
          output_tokens: expect.any(Number),
        },
      });
    }
  );

  it("returns tool_use blocks and stop_reason=tool_use when tools are present", async () => {
    const response = await request(app)
      .post("/v1/messages")
      .send({
        ...baseRequest,
        messages: [{ role: "user", content: "Look up order A100." }],
        tools: [
          {
            name: "get_order",
            input_schema: {
              type: "object",
              properties: { order_id: { type: "string" } },
            },
          },
        ],
      })
      .expect(200);

    expect(response.body.stop_reason).toBe("tool_use");
    expect(response.body.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_use",
          id: expect.stringMatching(/^toolu_mock_/),
          name: "get_order",
          input: { order_id: "A100" },
        }),
      ])
    );
  });

  it("returns multiple tool_use blocks for parallel tool scenarios", async () => {
    const response = await request(app)
      .post("/v1/messages")
      .set("x-mock-scenario", "parallel_tools")
      .send({
        ...baseRequest,
        tools: [
          { name: "get_order", input_schema: { type: "object" } },
          { name: "get_weather", input_schema: { type: "object" } },
        ],
      })
      .expect(200);

    expect(response.body.stop_reason).toBe("tool_use");
    expect(response.body.content).toHaveLength(2);
    expect(response.body.content.map((block: { name: string }) => block.name)).toEqual([
      "get_order",
      "get_weather",
    ]);
  });

  it("returns final text for tool_result follow-up messages", async () => {
    const response = await request(app)
      .post("/v1/messages")
      .send({
        ...baseRequest,
        messages: [
          { role: "user", content: "Look up order A100." },
          {
            role: "assistant",
            content: [
              { type: "text", text: "I'll check the requested information." },
              {
                type: "tool_use",
                id: "toolu_mock_0001",
                name: "get_order",
                input: { order_id: "A100" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_mock_0001",
                content: '{"status":"out_for_delivery","eta":"today by 18:00"}',
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(response.body.stop_reason).toBe("end_turn");
    expect(response.body.content[0].text).toContain("out_for_delivery");
  });

  it("supports extended thinking blocks and thinking stream deltas", async () => {
    const response = await request(app)
      .post("/v1/messages")
      .send({
        ...baseRequest,
        thinking: { type: "enabled", budget_tokens: 1024 },
      })
      .expect(200);

    expect(response.body.content[0]).toMatchObject({
      type: "thinking",
      thinking: expect.any(String),
      signature: expect.stringMatching(/^msg_mock_/),
    });

    const stream = await collectSse(
      request(app)
        .post("/v1/messages")
        .send({
          ...baseRequest,
          stream: true,
          thinking: { type: "enabled", budget_tokens: 1024 },
        })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );
    const events = parseSseEvents(stream.body);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "content_block_delta",
          data: expect.objectContaining({
            delta: expect.objectContaining({ type: "thinking_delta" }),
          }),
        }),
        expect.objectContaining({
          event: "content_block_delta",
          data: expect.objectContaining({
            delta: expect.objectContaining({ type: "signature_delta" }),
          }),
        }),
      ])
    );
  });

  it("supports refusal, max_tokens, pause_turn, and file reference scenarios", async () => {
    const refusal = await request(app)
      .post("/v1/messages")
      .set("x-mock-scenario", "refusal")
      .send(baseRequest)
      .expect(200);
    expect(refusal.body.stop_reason).toBe("refusal");

    const maxTokens = await request(app)
      .post("/v1/messages")
      .send({ ...baseRequest, max_tokens: 1 })
      .expect(200);
    expect(maxTokens.body.stop_reason).toBe("max_tokens");

    const pauseTurn = await request(app)
      .post("/v1/messages")
      .set("x-mock-scenario", "pause_turn")
      .send(baseRequest)
      .expect(200);
    expect(pauseTurn.body.stop_reason).toBe("pause_turn");

    const fileReference = await request(app)
      .post("/v1/messages")
      .send({
        ...baseRequest,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "file", file_id: "file_mock_0001" },
                title: "policy.pdf",
              },
              { type: "text", text: "Summarize this document." },
            ],
          },
        ],
      })
      .expect(200);
    expect(fileReference.body.content[0].text).toContain("file reference");
  });

  it("streams text events in Anthropic order with content_block_stop", async () => {
    const response = await collectSse(
      request(app)
        .post("/v1/messages")
        .send({ ...baseRequest, stream: true })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const events = parseSseEvents(response.body);
    expect(events.map((event) => event.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(events.at(-1)).toMatchObject({ event: "message_stop", data: { type: "message_stop" } });
  });

  it("streams tool input JSON deltas that parse into valid arguments", async () => {
    const response = await collectSse(
      request(app)
        .post("/v1/messages")
        .send({
          ...baseRequest,
          stream: true,
          tools: [{ name: "get_order", input_schema: { type: "object" } }],
        })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const events = parseSseEvents(response.body);
    const partialJson = events
      .map((event) => event.data?.delta)
      .filter((delta) => delta?.type === "input_json_delta")
      .map((delta) => delta.partial_json)
      .join("");

    expect(JSON.parse(partialJson)).toEqual({ order_id: "A100" });
  });

  it("counts message tokens deterministically", async () => {
    const response = await request(app)
      .post("/v1/messages/count_tokens")
      .send({
        model: "claude-sonnet-4-5",
        system: "You are concise.",
        messages: [{ role: "user", content: "Hello" }],
        tools: [{ name: "get_order", input_schema: { type: "object" } }],
      })
      .expect(200);

    expect(response.body.input_tokens).toEqual(expect.any(Number));
    expect(response.body.input_tokens).toBeGreaterThan(0);
  });

  it("returns Anthropic-style validation and injected errors", async () => {
    const validation = await request(app)
      .post("/v1/messages")
      .send({ model: "claude-sonnet-4-5", max_tokens: 256, messages: [{ role: "developer", content: "No" }] })
      .expect(400);
    expect(validation.body).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "messages contains an invalid role",
      },
    });

    const rateLimit = await request(app)
      .post("/v1/messages")
      .set("x-mock-error", "429")
      .send(baseRequest)
      .expect(429);
    expect(rateLimit.body.error.type).toBe("rate_limit_error");

    const overloaded = await request(app)
      .post("/v1/messages?mock_error=529")
      .send(baseRequest)
      .expect(529);
    expect(overloaded.body.error.type).toBe("overloaded_error");

    const invalidToolArgs = await request(app)
      .post("/v1/messages")
      .set("x-mock-scenario", "invalid_tool_args")
      .send(baseRequest)
      .expect(400);
    expect(invalidToolArgs.body).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Invalid mock tool arguments.",
      },
    });
  });

  it("rejects invalid Anthropic content blocks with provider error shape", async () => {
    const response = await request(app)
      .post("/v1/messages")
      .send({
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [{ role: "user", content: [{ type: "document" }] }],
      })
      .expect(400);

    expect(response.body).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "document block requires source",
      },
    });
  });
});

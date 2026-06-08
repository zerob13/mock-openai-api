import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { collectSse, parseSseEvents } from "./helpers";

function createResponse(body: Record<string, unknown>, scenario?: string) {
  const test = request(app).post("/v1/responses").send({
    model: "gpt-4.1-mini",
    input: "Write a one-line project status update.",
    ...body,
  });

  return scenario ? test.set("x-mock-scenario", scenario) : test;
}

describe("OpenAI Responses API contract", () => {
  it("creates, retrieves, lists input items, and deletes a stored simple response", async () => {
    const created = await createResponse({ store: true }).expect(200);

    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^resp_mock_/),
      object: "response",
      status: "completed",
      model: "gpt-4.1-mini",
      output: [
        expect.objectContaining({
          type: "message",
          status: "completed",
          role: "assistant",
          content: [expect.objectContaining({ type: "output_text", text: expect.any(String) })],
        }),
      ],
      usage: expect.objectContaining({
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      }),
    });

    const retrieved = await request(app).get(`/v1/responses/${created.body.id}`).expect(200);
    expect(retrieved.body.id).toBe(created.body.id);

    const inputItems = await request(app)
      .get(`/v1/responses/${created.body.id}/input_items`)
      .expect(200);
    expect(inputItems.body).toMatchObject({
      object: "list",
      has_more: false,
      data: [expect.objectContaining({ type: "message", role: "user" })],
    });

    const deleted = await request(app).delete(`/v1/responses/${created.body.id}`).expect(200);
    expect(deleted.body).toEqual({
      id: created.body.id,
      object: "response.deleted",
      deleted: true,
    });
    await request(app).get(`/v1/responses/${created.body.id}`).expect(404);
  });

  it("does not persist responses when store is false", async () => {
    const created = await createResponse({ store: false }).expect(200);

    await request(app).get(`/v1/responses/${created.body.id}`).expect(404);
  });

  it("cancels queued background responses and rejects cancelling completed responses", async () => {
    const background = await createResponse({ background: true }).set("x-mock-background", "true").expect(200);
    expect(background.body.status).toBe("queued");

    const cancelled = await request(app)
      .post(`/v1/responses/${background.body.id}/cancel`)
      .expect(200);
    expect(cancelled.body.status).toBe("cancelled");

    const completed = await createResponse({ store: true }).expect(200);
    const conflict = await request(app)
      .post(`/v1/responses/${completed.body.id}/cancel`)
      .expect(409);
    expect(conflict.body.error).toMatchObject({
      type: "conflict_error",
      code: "conflict",
    });
  });

  it("counts input tokens deterministically and compacts context", async () => {
    const counted = await request(app)
      .post("/v1/responses/input_tokens")
      .send({ input: "Hello token counter" })
      .expect(200);
    expect(counted.body).toEqual({
      object: "response.input_tokens",
      input_tokens: 5,
    });

    const compacted = await request(app)
      .post("/v1/responses/compact")
      .send({ model: "gpt-4.1-mini", input: "Long prior context" })
      .expect(200);
    expect(compacted.body).toMatchObject({
      object: "response",
      status: "completed",
      output: [
        expect.objectContaining({
          content: [
            expect.objectContaining({
              text: "The prior conversation was compacted into a deterministic mock summary.",
            }),
          ],
        }),
      ],
    });
  });

  it("returns deterministic function calls for tool and parallel tool scenarios", async () => {
    const toolCall = await createResponse(
      {
        tools: [
          {
            type: "function",
            name: "get_order",
            parameters: { type: "object" },
          },
        ],
      },
      "tool_call"
    ).expect(200);

    expect(toolCall.body.output).toEqual([
      expect.objectContaining({
        type: "function_call",
        call_id: expect.stringMatching(/^call_mock_/),
        name: "get_order",
        arguments: JSON.stringify({ order_id: "A100" }),
      }),
    ]);

    const parallelTools = await createResponse(
      {
        tools: [
          { type: "function", name: "get_order" },
          { type: "function", name: "get_weather" },
        ],
      },
      "parallel_tools"
    ).expect(200);
    expect(parallelTools.body.output).toHaveLength(2);
    expect(parallelTools.body.output.map((item: { name: string }) => item.name)).toEqual([
      "get_order",
      "get_weather",
    ]);
  });

  it("uses function call output as a deterministic tool result follow-up", async () => {
    const initial = await createResponse({ tools: [{ type: "function", name: "get_weather" }] }, "tool_call").expect(200);
    const callId = initial.body.output[0].call_id;

    const followUp = await request(app)
      .post("/v1/responses")
      .send({
        model: "gpt-4.1-mini",
        previous_response_id: initial.body.id,
        input: [
          {
            type: "function_call_output",
            call_id: callId,
            output: '{"temperature_c":27,"condition":"cloudy"}',
          },
        ],
      })
      .expect(200);

    expect(followUp.body.previous_response_id).toBe(initial.body.id);
    expect(followUp.body.output[0].content[0].text).toContain("temperature_c");
  });

  it("returns structured JSON, reasoning metadata, refusal, failed, and cancelled scenarios", async () => {
    const structured = await createResponse(
      {
        text: {
          format: {
            type: "json_schema",
            name: "product_extract",
            schema: { type: "object" },
          },
        },
      },
      "structured_json"
    ).expect(200);
    expect(JSON.parse(structured.body.output[0].content[0].text)).toEqual({
      name: "UltraWidget",
      price: 19.99,
      currency: "USD",
    });

    const reasoning = await createResponse({ reasoning: { effort: "medium" } }, "reasoning").expect(200);
    expect(reasoning.body.reasoning).toMatchObject({ effort: "medium" });
    expect(reasoning.body.usage.output_tokens_details.reasoning_tokens).toBeGreaterThan(0);

    const refusal = await createResponse({}, "refusal").expect(200);
    expect(refusal.body.output[0].content[0]).toEqual({
      type: "refusal",
      refusal: "I cannot comply with this mock request.",
    });

    const failed = await createResponse({}, "failed").expect(200);
    expect(failed.body).toMatchObject({
      status: "failed",
      error: { code: "mock_failed" },
    });

    const cancelled = await createResponse({}, "cancelled").expect(200);
    expect(cancelled.body.status).toBe("cancelled");
  });

  it("supports OpenAI-style error injection", async () => {
    const headerError = await createResponse({}).set("x-mock-error", "429").expect(429);
    expect(headerError.body.error).toMatchObject({
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
    });

    const queryError = await request(app)
      .post("/v1/responses?mock_error=529")
      .send({ model: "gpt-4.1-mini", input: "Hello" })
      .expect(529);
    expect(queryError.body.error).toMatchObject({
      type: "overloaded_error",
      code: "overloaded",
    });
  });

  it("streams Responses API events in provider-compatible order", async () => {
    const response = await collectSse(
      createResponse({ stream: true })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const events = parseSseEvents(response.body);
    expect(events.map((event) => event.event).filter(Boolean)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(events.at(-1)?.data).toBe("[DONE]");
  });
});

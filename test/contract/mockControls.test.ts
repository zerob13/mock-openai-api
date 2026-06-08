import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { collectSse, parseSseEvents } from "./helpers";

describe("mock control contracts", () => {
  it("applies endpoint latency from x-mock-latency-ms", async () => {
    const startedAt = performance.now();

    await request(app).get("/health").set("x-mock-latency-ms", "25").expect(200);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it("applies stream chunk delay from x-mock-stream-chunk-ms", async () => {
    const startedAt = performance.now();
    const stream = await collectSse(
      request(app)
        .post("/v1/chat/completions")
        .set("x-mock-stream-chunk-ms", "8")
        .send({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: "Stream this response." }],
          stream: true,
        })
        .expect("Content-Type", /text\/event-stream/)
        .expect(200)
    );

    const elapsedMs = performance.now() - startedAt;
    const events = parseSseEvents(stream.body);

    expect(events.length).toBeGreaterThan(2);
    expect(events.at(-1)?.data).toBe("[DONE]");
    expect(elapsedMs).toBeGreaterThanOrEqual(16);
  });
});

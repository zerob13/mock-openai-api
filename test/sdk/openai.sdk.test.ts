import OpenAI, { toFile } from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SdkServer, runSdkTests, startSdkServer, stopSdkServer } from "./helpers";

describe.skipIf(!runSdkTests)("OpenAI SDK smoke tests", () => {
  let sdkServer: SdkServer;
  let client: OpenAI;

  beforeAll(async () => {
    sdkServer = await startSdkServer();
    client = new OpenAI({
      apiKey: "sk-mock",
      baseURL: `${sdkServer.baseUrl}/v1`,
      maxRetries: 0,
    });
  });

  afterAll(async () => {
    await stopSdkServer(sdkServer?.server);
  });

  it("creates Responses API text, stream, and tool call responses", async () => {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: "Write a one-line project status update.",
    });
    expect(response.id).toMatch(/^resp_mock_/);

    const stream = await client.responses.create({
      model: "gpt-4.1-mini",
      input: "Stream a status update.",
      stream: true,
    });
    const streamTypes: string[] = [];
    for await (const event of stream) {
      streamTypes.push(event.type);
    }
    expect(streamTypes).toContain("response.completed");

    const toolCall = await client.responses.create({
      model: "gpt-4.1-mini",
      input: "Look up order A100.",
      tools: [
        {
          type: "function",
          name: "get_order",
          parameters: { type: "object", properties: { order_id: { type: "string" } } },
        },
      ],
    });
    expect(toolCall.output[0]).toMatchObject({ type: "function_call", name: "get_order" });
  });

  it("creates Chat Completions text and include_usage streams", async () => {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(completion.choices[0].message.content).toEqual(expect.any(String));

    const stream = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      stream_options: { include_usage: true },
    });
    let sawUsage = false;
    for await (const chunk of stream) {
      sawUsage = sawUsage || Boolean(chunk.usage);
    }
    expect(sawUsage).toBe(true);
  });

  it("creates embeddings and manages files", async () => {
    const embedding = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: "Hello",
      dimensions: 4,
    });
    expect(embedding.data[0].embedding).toHaveLength(4);

    const file = await client.files.create({
      file: await toFile(Buffer.from("mock file"), "sdk.txt"),
      purpose: "assistants",
    });
    expect(file.id).toMatch(/^file_mock_/);

    const list = await client.files.list();
    expect(list.data.some((item) => item.id === file.id)).toBe(true);

    const deleted = await client.files.delete(file.id);
    expect(deleted.deleted).toBe(true);
  });
});

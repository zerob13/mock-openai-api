import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SdkServer, runSdkTests, startSdkServer, stopSdkServer } from "./helpers";

describe.skipIf(!runSdkTests)("Anthropic SDK smoke tests", () => {
  let sdkServer: SdkServer;
  let client: Anthropic;

  beforeAll(async () => {
    sdkServer = await startSdkServer();
    client = new Anthropic({
      apiKey: "sk-ant-mock",
      baseURL: sdkServer.baseUrl,
      maxRetries: 0,
    });
  });

  afterAll(async () => {
    await stopSdkServer(sdkServer?.server);
  });

  it("creates Messages API text, stream, tool use, and tool result follow-up responses", async () => {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(message.content[0].type).toBe("text");

    const stream = client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: "Hello" }],
    });
    const finalMessage = await stream.finalMessage();
    expect(finalMessage.stop_reason).toBe("end_turn");

    const toolUse = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: "Look up order A100." }],
      tools: [{ name: "get_order", input_schema: { type: "object" } }],
    });
    const toolBlock = toolUse.content.find((block) => block.type === "tool_use");
    expect(toolBlock).toMatchObject({ type: "tool_use", name: "get_order" });

    const followUp = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 256,
      messages: [
        { role: "user", content: "Look up order A100." },
        { role: "assistant", content: toolUse.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolBlock?.type === "tool_use" ? toolBlock.id : "toolu_mock_0001",
              content: '{"status":"out_for_delivery"}',
            },
          ],
        },
      ],
    });
    expect(followUp.content[0]).toMatchObject({ type: "text" });
  });

  it("counts tokens and manages beta files when supported by the SDK", async () => {
    const tokenCount = await client.messages.countTokens({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(tokenCount.input_tokens).toBeGreaterThan(0);

    const betaFiles = client.beta?.files;
    if (!betaFiles) {
      return;
    }

    const uploaded = await betaFiles.upload({
      file: await toFile(Buffer.from("mock policy"), "policy.txt"),
    });
    expect(uploaded.id).toMatch(/^file_mock_/);

    const listed = await betaFiles.list();
    expect(listed.data.some((file) => file.id === uploaded.id)).toBe(true);

    const deleted = await betaFiles.delete(uploaded.id);
    expect(deleted.id).toBe(uploaded.id);
  });
});

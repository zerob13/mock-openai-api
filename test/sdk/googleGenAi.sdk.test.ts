import { GoogleGenAI } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SdkServer, runSdkTests, startSdkServer, stopSdkServer } from "./helpers";

describe.skipIf(!runSdkTests)("Google GenAI SDK smoke tests", () => {
  let sdkServer: SdkServer;
  let client: GoogleGenAI;

  beforeAll(async () => {
    sdkServer = await startSdkServer();
    client = new GoogleGenAI({
      apiKey: "gemini-mock",
      httpOptions: {
        baseUrl: sdkServer.baseUrl,
        apiVersion: "v1beta",
      },
    });
  });

  afterAll(async () => {
    await stopSdkServer(sdkServer?.server);
  });

  it("generates text, streams text, calls functions, and returns structured output", async () => {
    const generated = await client.models.generateContent({
      model: "gemini-1.5-flash",
      contents: "Hello",
    });
    expect(generated.text).toEqual(expect.any(String));

    const stream = await client.models.generateContentStream({
      model: "gemini-1.5-flash",
      contents: "Hello",
    });
    const streamTexts: string[] = [];
    for await (const chunk of stream) {
      if (chunk.text) {
        streamTexts.push(chunk.text);
      }
    }
    expect(streamTexts.join("")).toContain("Gemini mock");

    const functionCall = await client.models.generateContent({
      model: "gemini-1.5-flash",
      contents: "Look up order A100.",
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_order",
                parameters: { type: "OBJECT", properties: { order_id: { type: "STRING" } } },
              },
            ],
          },
        ],
      },
    });
    expect(functionCall.functionCalls?.[0]).toMatchObject({ name: "get_order" });

    const structured = await client.models.generateContent({
      model: "gemini-1.5-flash",
      contents: "Extract product name and price from: UltraWidget costs $19.99.",
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT" },
      },
    });
    expect(JSON.parse(structured.text || "{}")).toEqual({
      name: "UltraWidget",
      price: 19.99,
      currency: "USD",
    });
  });

  it("counts tokens and manages files and caches", async () => {
    const count = await client.models.countTokens({
      model: "gemini-1.5-flash",
      contents: "Hello",
    });
    expect(count.totalTokens).toBeGreaterThan(0);

    const file = await client.files.upload({
      file: new Blob(["mock invoice"], { type: "text/plain" }),
      config: {
        mimeType: "text/plain",
        displayName: "invoice.txt",
      },
    });
    expect(file.name).toMatch(/^files\/file_mock_/);

    const listedFiles = await client.files.list();
    const fileNames: string[] = [];
    for await (const item of listedFiles) {
      if (item.name) {
        fileNames.push(item.name);
      }
    }
    expect(fileNames).toContain(file.name);

    if (file.name) {
      await client.files.delete({ name: file.name });
    }

    const cached = await client.caches.create({
      model: "gemini-1.5-flash",
      config: {
        contents: [{ role: "user", parts: [{ text: "Persistent context." }] }],
        systemInstruction: { parts: [{ text: "Answer concisely." }] },
      },
    });
    expect(cached.name).toMatch(/^cachedContents\/cached_mock_/);

    const listed = await client.caches.list();
    const cachedNames: string[] = [];
    for await (const item of listed) {
      if (item.name) {
        cachedNames.push(item.name);
      }
    }
    expect(cachedNames).toContain(cached.name);

    if (cached.name) {
      await client.caches.delete({ name: cached.name });
    }
  });
});

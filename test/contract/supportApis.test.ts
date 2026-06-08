import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";

const injectedErrorStatuses = [400, 401, 403, 404, 409, 429, 500, 529] as const;

describe("support API contracts", () => {
  it("creates OpenAI embeddings for strings and arrays with requested dimensions", async () => {
    const single = await request(app)
      .post("/v1/embeddings")
      .send({ model: "text-embedding-3-small", input: "Hello", dimensions: 3 })
      .expect(200);
    expect(single.body).toMatchObject({
      object: "list",
      model: "text-embedding-3-small",
      data: [{ object: "embedding", index: 0 }],
      usage: {
        prompt_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      },
    });
    expect(single.body.data[0].embedding).toHaveLength(3);

    const multiple = await request(app)
      .post("/v1/embeddings")
      .send({ model: "text-embedding-3-small", input: ["Hello", "World"], dimensions: 2 })
      .expect(200);
    expect(multiple.body.data).toHaveLength(2);
    expect(multiple.body.data[1]).toMatchObject({ object: "embedding", index: 1 });
  });

  it("supports OpenAI image edits and variations with multipart uploads", async () => {
    const edit = await request(app)
      .post("/v1/images/edits")
      .field("n", "2")
      .field("response_format", "b64_json")
      .attach("image", Buffer.from("mock image"), "image.png")
      .expect(200);
    expect(edit.body.data).toHaveLength(2);
    expect(edit.body.data[0]).toMatchObject({
      b64_json: expect.any(String),
      revised_prompt: "A deterministic mock image edit.",
    });

    const variation = await request(app)
      .post("/v1/images/variations")
      .attach("image", Buffer.from("mock image"), "image.png")
      .expect(200);
    expect(variation.body.data[0]).toMatchObject({
      url: expect.any(String),
      revised_prompt: "A deterministic mock image variation.",
    });
  });

  it("creates, lists, retrieves, and deletes OpenAI file objects", async () => {
    const created = await request(app)
      .post("/v1/files")
      .field("purpose", "assistants")
      .attach("file", Buffer.from("mock file"), "notes.txt")
      .expect(200);

    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^file_mock_/),
      object: "file",
      filename: "notes.txt",
      purpose: "assistants",
      bytes: expect.any(Number),
    });

    const listed = await request(app).get("/v1/files").expect(200);
    expect(listed.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id })]));

    const retrieved = await request(app).get(`/v1/files/${created.body.id}`).expect(200);
    expect(retrieved.body.id).toBe(created.body.id);

    const deleted = await request(app).delete(`/v1/files/${created.body.id}`).expect(200);
    expect(deleted.body).toEqual({ id: created.body.id, object: "file", deleted: true });
    await request(app).get(`/v1/files/${created.body.id}`).expect(404);
  });

  it("creates, lists, retrieves, and deletes Anthropic file objects via provider headers", async () => {
    const created = await request(app)
      .post("/v1/files")
      .set("anthropic-version", "2023-06-01")
      .attach("file", Buffer.from("mock policy"), "policy.pdf")
      .expect(200);

    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^file_mock_/),
      type: "file",
      filename: "policy.pdf",
      mime_type: expect.any(String),
      size_bytes: expect.any(Number),
    });

    const listed = await request(app)
      .get("/v1/files")
      .set("anthropic-version", "2023-06-01")
      .expect(200);
    expect(listed.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id })]));

    const retrieved = await request(app)
      .get(`/v1/files/${created.body.id}`)
      .set("anthropic-version", "2023-06-01")
      .expect(200);
    expect(retrieved.body.id).toBe(created.body.id);

    const deleted = await request(app)
      .delete(`/v1/files/${created.body.id}`)
      .set("anthropic-version", "2023-06-01")
      .expect(200);
    expect(deleted.body).toEqual({ id: created.body.id, type: "file_deleted", deleted: true });
    await request(app).get(`/v1/files/${created.body.id}`).set("anthropic-version", "2023-06-01").expect(404);
  });

  it("creates, lists, retrieves, and deletes Gemini files", async () => {
    const uploaded = await request(app)
      .post("/upload/v1beta/files")
      .attach("file", Buffer.from("mock invoice"), "invoice.pdf")
      .expect(200);

    expect(uploaded.body).toMatchObject({
      name: expect.stringMatching(/^files\/file_mock_/),
      displayName: "invoice.pdf",
      uri: expect.stringMatching(/^mock:\/\/files\/file_mock_/),
      state: "ACTIVE",
    });

    const listed = await request(app).get("/v1beta/files").expect(200);
    expect(listed.body.files).toEqual(expect.arrayContaining([expect.objectContaining({ name: uploaded.body.name })]));

    const encodedName = encodeURIComponent(uploaded.body.name);
    const retrieved = await request(app).get(`/v1beta/files/${encodedName}`).expect(200);
    expect(retrieved.body.name).toBe(uploaded.body.name);

    await request(app).delete(`/v1beta/files/${encodedName}`).expect(200);
    await request(app).get(`/v1beta/files/${encodedName}`).expect(404);
  });

  it("creates, lists, retrieves, deletes, and references Gemini cached contents", async () => {
    const created = await request(app)
      .post("/v1beta/cachedContents")
      .send({
        model: "models/gemini-1.5-flash",
        contents: [{ role: "user", parts: [{ text: "Persistent context." }] }],
        systemInstruction: { parts: [{ text: "Answer concisely." }] },
      })
      .expect(200);

    expect(created.body).toMatchObject({
      name: expect.stringMatching(/^cachedContents\/cached_mock_/),
      model: "models/gemini-1.5-flash",
      usageMetadata: { totalTokenCount: expect.any(Number) },
    });

    const listed = await request(app).get("/v1beta/cachedContents").expect(200);
    expect(listed.body.cachedContents).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: created.body.name })])
    );

    const encodedName = encodeURIComponent(created.body.name);
    const retrieved = await request(app).get(`/v1beta/cachedContents/${encodedName}`).expect(200);
    expect(retrieved.body.name).toBe(created.body.name);

    const generated = await request(app)
      .post("/v1beta/models/gemini-1.5-flash:generateContent")
      .send({
        cachedContent: created.body.name,
        contents: [{ role: "user", parts: [{ text: "Continue using cached context." }] }],
      })
      .expect(200);
    expect(generated.body.usageMetadata.totalTokenCount).toBeGreaterThan(0);

    await request(app).delete(`/v1beta/cachedContents/${encodedName}`).expect(200);
    await request(app).get(`/v1beta/cachedContents/${encodedName}`).expect(404);
  });

  it.each(injectedErrorStatuses)("injects provider-shaped %i errors on support file APIs", async (status) => {
    const openai = await request(app)
      .get("/v1/files")
      .set("x-mock-error", String(status))
      .expect(status);
    expect(openai.body.error).toMatchObject({
      message: expect.any(String),
      type: expect.any(String),
      code: expect.any(String),
    });

    const anthropic = await request(app)
      .get("/v1/files")
      .set("anthropic-version", "2023-06-01")
      .set("x-mock-error", String(status))
      .expect(status);
    expect(anthropic.body).toMatchObject({
      type: "error",
      error: {
        type: expect.any(String),
        message: expect.any(String),
      },
    });

    const gemini = await request(app)
      .get("/v1beta/files")
      .set("x-mock-error", String(status))
      .expect(status);
    expect(gemini.body.error).toMatchObject({
      code: status,
      message: expect.any(String),
      status: expect.any(String),
    });
  });

  it("injects query-string errors on Gemini cached content APIs", async () => {
    const response = await request(app)
      .get("/v1beta/cachedContents?mock_error=529")
      .expect(529);

    expect(response.body.error).toMatchObject({
      code: 529,
      status: "UNAVAILABLE",
    });
  });
});

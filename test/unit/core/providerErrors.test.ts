import { describe, expect, it } from "vitest";
import { getInjectedProviderError } from "../../../src/core/errors/errorInjector";
import { buildProviderError, InjectableErrorStatus } from "../../../src/core/errors/providerErrors";
import { ProviderName } from "../../../src/core/scenarioEngine";

const statuses: InjectableErrorStatus[] = [400, 401, 403, 404, 409, 429, 500, 529];

describe("Provider error builders", () => {
  it.each(statuses)("builds OpenAI-compatible %i errors", (status) => {
    const error = buildProviderError("openai", status, "mock failure", "model");

    expect(error.status).toBe(status);
    expect(error.body).toMatchObject({
      error: {
        message: "mock failure",
        param: "model",
        type: expect.any(String),
        code: expect.any(String),
      },
    });
  });

  it.each(statuses)("builds Anthropic-compatible %i errors", (status) => {
    const error = buildProviderError("anthropic", status, "mock failure");

    expect(error).toMatchObject({
      status,
      body: {
        type: "error",
        error: {
          type: expect.any(String),
          message: "mock failure",
        },
      },
    });
  });

  it.each(statuses)("builds Gemini-compatible %i errors", (status) => {
    const error = buildProviderError("gemini", status, "mock failure");

    expect(error).toMatchObject({
      status,
      body: {
        error: {
          code: status,
          message: "mock failure",
          status: expect.any(String),
        },
      },
    });
  });

  it.each<ProviderName>(["openai", "anthropic", "gemini"])(
    "injects provider errors from headers and query for %s",
    (provider) => {
      expect(
        getInjectedProviderError({
          provider,
          headers: { "x-mock-error": "429" },
          query: {},
        })?.status
      ).toBe(429);
      expect(
        getInjectedProviderError({
          provider,
          headers: {},
          query: { mock_error: "529" },
        })?.status
      ).toBe(529);
    }
  );
});

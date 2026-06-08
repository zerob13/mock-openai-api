import { describe, expect, it } from "vitest";
import { IdFactory } from "../../../src/core/state/idFactory";

describe("IdFactory", () => {
  it("creates stable IDs for the same seed and counter path", () => {
    const first = new IdFactory("contract seed");
    const second = new IdFactory("contract seed");

    expect(first.next("response", "responses.create")).toBe("resp_mock_contract_seed_0001");
    expect(first.next("response", "responses.create")).toBe("resp_mock_contract_seed_0002");
    expect(second.next("response", "responses.create")).toBe("resp_mock_contract_seed_0001");
  });

  it("keeps independent counters per kind and path", () => {
    const factory = new IdFactory("alpha");

    expect(factory.next("response", "a")).toBe("resp_mock_alpha_0001");
    expect(factory.next("response", "b")).toBe("resp_mock_alpha_0001");
    expect(factory.next("message", "a")).toBe("msg_mock_alpha_0001");
  });

  it("uses process-local counters when seed is omitted", () => {
    const first = new IdFactory();
    const second = new IdFactory();

    const firstId = first.next("file", "uploads");
    const secondId = second.next("file", "uploads");

    expect(firstId).toMatch(/^file_mock_\d{4}$/);
    expect(secondId).toMatch(/^file_mock_\d{4}$/);
    expect(firstId).not.toBe(secondId);
  });
});

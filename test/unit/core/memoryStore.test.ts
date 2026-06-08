import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../../../src/core/state/memoryStore";

describe("MemoryStateStore", () => {
  it("creates, retrieves, updates, lists, deletes, and clears records", () => {
    const store = new MemoryStateStore();

    store.create("responses", { id: "resp_mock_0001", provider: "openai", status: "completed" });
    store.create("responses", { id: "resp_mock_0002", provider: "openai", status: "failed" });

    expect(store.get("responses", "resp_mock_0001")).toMatchObject({ status: "completed" });
    expect(store.update("responses", "resp_mock_0001", { status: "cancelled" })).toMatchObject({
      id: "resp_mock_0001",
      status: "cancelled",
    });
    expect(store.list("responses", { provider: "openai" })).toHaveLength(2);
    expect(store.list("responses", (record) => record.status === "failed")).toEqual([
      expect.objectContaining({ id: "resp_mock_0002" }),
    ]);
    expect(store.delete("responses", "resp_mock_0002")).toBe(true);
    expect(store.get("responses", "resp_mock_0002")).toBeUndefined();

    store.clear("responses");
    expect(store.list("responses")).toEqual([]);
  });
});

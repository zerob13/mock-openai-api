import { vi } from "vitest";

vi.spyOn(console, "log").mockImplementation(() => {});

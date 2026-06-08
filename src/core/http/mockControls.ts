import { NextFunction, Request, RequestHandler, Response } from "express";

const MAX_DELAY_MS = 30_000;

export function mockLatencyMiddleware(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const latencyMs = readMockControlNumber(req, "x-mock-latency-ms", "mock_latency_ms");

    if (latencyMs > 0) {
      await delay(latencyMs);
    }

    next();
  };
}

export function readMockStreamChunkDelay(req: Request): number {
  return readMockControlNumber(req, "x-mock-stream-chunk-ms", "mock_stream_chunk_ms");
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, clampDelay(ms));
  });
}

function readMockControlNumber(req: Request, headerName: string, queryName: string): number {
  const value =
    req.header(headerName) ||
    readQueryValue(req.query[queryName]) ||
    readBodyValue(req.body, queryName);
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? clampDelay(parsed) : 0;
}

function readQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function readBodyValue(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[key];
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function clampDelay(ms: number): number {
  return Math.max(0, Math.min(Math.floor(ms), MAX_DELAY_MS));
}

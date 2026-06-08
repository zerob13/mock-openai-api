export type IdKind =
  | "response"
  | "chatCompletion"
  | "message"
  | "toolUse"
  | "call"
  | "functionCall"
  | "file"
  | "cachedContent"
  | "gemini";

export const ID_PREFIXES: Record<IdKind, string> = {
  response: "resp_mock",
  chatCompletion: "chatcmpl_mock",
  message: "msg_mock",
  toolUse: "toolu_mock",
  call: "call_mock",
  functionCall: "fc_mock",
  file: "file_mock",
  cachedContent: "cached_mock",
  gemini: "gemini_mock",
};

const processCounters = new Map<string, number>();

export class IdFactory {
  private readonly counters = new Map<string, number>();

  constructor(private readonly seed?: string) {}

  next(kind: IdKind, path: string = kind): string {
    const prefix = ID_PREFIXES[kind];
    const key = `${kind}:${path}`;
    const counter = this.nextCounter(key);
    const seedPart = this.seed ? `${sanitizeSeed(this.seed)}_` : "";

    return `${prefix}_${seedPart}${counter.toString().padStart(4, "0")}`;
  }

  reset(): void {
    this.counters.clear();
  }

  private nextCounter(key: string): number {
    if (this.seed) {
      const nextValue = (this.counters.get(key) || 0) + 1;
      this.counters.set(key, nextValue);
      return nextValue;
    }

    const processKey = `process:${key}`;
    const nextValue = (processCounters.get(processKey) || 0) + 1;
    processCounters.set(processKey, nextValue);
    return nextValue;
  }
}

function sanitizeSeed(seed: string): string {
  const sanitized = seed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.slice(0, 24) || "seed";
}

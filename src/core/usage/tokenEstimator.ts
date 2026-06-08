export function estimateTokens(input: unknown): number {
  const text = collectText(input).join(" ").trim();

  if (!text) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

export function collectText(input: unknown): string[] {
  if (typeof input === "string") {
    return [input];
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return [String(input)];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => collectText(item));
  }

  if (isRecord(input)) {
    return Object.values(input).flatMap((value) => collectText(value));
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

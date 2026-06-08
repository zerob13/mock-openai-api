export const GEMINI_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function geminiData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function geminiDone(): string {
  return "data: [DONE]\n\n";
}

export function encodeGeminiSse(messages: unknown[], includeDone = true): string {
  const encoded = messages.map((message) => geminiData(message)).join("");

  return includeDone ? `${encoded}${geminiDone()}` : encoded;
}

export const OPENAI_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type OpenAISseMessage = {
  event?: string;
  data: unknown;
};

export function openAIEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function openAIData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function openAIDone(): string {
  return "data: [DONE]\n\n";
}

export function encodeOpenAISse(messages: OpenAISseMessage[], includeDone = true): string {
  const encoded = messages
    .map((message) => (message.event ? openAIEvent(message.event, message.data) : openAIData(message.data)))
    .join("");

  return includeDone ? `${encoded}${openAIDone()}` : encoded;
}

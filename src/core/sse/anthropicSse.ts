export const ANTHROPIC_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function anthropicEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function anthropicMessageStop(): string {
  return anthropicEvent("message_stop", { type: "message_stop" });
}

export function encodeAnthropicSse(messages: Array<{ event: string; data: unknown }>): string {
  return messages.map((message) => anthropicEvent(message.event, message.data)).join("");
}

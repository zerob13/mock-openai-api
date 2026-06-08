import request from "supertest";

export type SseEvent = {
  event?: string;
  data: unknown;
};

export function parseSseEvents(payload: string): SseEvent[] {
  return payload
    .split(/\n\n/)
    .map((event) => event.trim())
    .filter(Boolean)
    .map((event) => {
      const lines = event.split(/\n/);
      const eventName = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
      const data = lines
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n");

      return {
        event: eventName,
        data: data === "[DONE]" ? "[DONE]" : JSON.parse(data),
      };
    });
}

export function collectSse(response: request.Test): request.Test {
  return response
    .buffer(true)
    .parse((res, callback) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => callback(null, body));
    });
}

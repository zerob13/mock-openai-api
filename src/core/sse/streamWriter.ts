import { Response } from "express";
import { delay } from "../http/mockControls";

export async function sendEncodedSse(
  res: Response,
  headers: Record<string, string>,
  encodedSse: string,
  chunkDelayMs = 0
): Promise<void> {
  Object.entries(headers).forEach(([header, value]) => {
    res.setHeader(header, value);
  });

  res.flushHeaders?.();

  if (chunkDelayMs <= 0) {
    res.write(encodedSse);
    res.end();
    return;
  }

  const frames = splitSseFrames(encodedSse);
  for (const [index, frame] of frames.entries()) {
    res.write(frame);
    if (index < frames.length - 1) {
      await delay(chunkDelayMs);
    }
  }

  res.end();
}

export function splitSseFrames(encodedSse: string): string[] {
  const frames = encodedSse.match(/[\s\S]*?\n\n/g) || [];
  const consumedLength = frames.reduce((length, frame) => length + frame.length, 0);
  const remainder = encodedSse.slice(consumedLength);

  return remainder ? [...frames, remainder] : frames;
}

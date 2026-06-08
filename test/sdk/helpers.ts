import { Server } from "node:http";
import app from "../../src/app";

export const runSdkTests = process.env.RUN_SDK_TESTS === "1";

export type SdkServer = {
  server: Server;
  baseUrl: string;
};

export async function startSdkServer(): Promise<SdkServer> {
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve SDK smoke test server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

export async function stopSdkServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

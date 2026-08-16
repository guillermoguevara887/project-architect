import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, test } from "node:test";
import handler from "../src/vercel.js";

const proxy = createServer((request, response) => {
  void handler(request, response).catch((error: unknown) => {
    response.statusCode = 500;
    response.end(String(error));
  });
});

await new Promise<void>((resolve) => {
  proxy.listen(0, "127.0.0.1", resolve);
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    proxy.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test("the Vercel handler serves Fastify routes without opening a port", async () => {
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "memoos-api",
  });
});

test("the Vercel handler completes the API root response", async () => {
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "memoos-api",
  });
});

test("Vercel uses the explicit API function instead of Fastify auto-detection", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as {
    framework?: string | null;
    installCommand?: string;
    builds?: Array<{ src: string; use: string }>;
    routes?: Array<{ src: string; dest: string }>;
  };

  assert.equal(config.framework, null);
  assert.equal(
    config.installCommand,
    "corepack pnpm install --frozen-lockfile",
  );
  assert.deepEqual(config.builds, [
    { src: "api/index.ts", use: "@vercel/node" },
  ]);
  assert.deepEqual(config.routes, [
    { src: "/(.*)", dest: "/api/index.ts" },
  ]);
});

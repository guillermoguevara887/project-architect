import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("all current R2 PUT call sites are guarded by a user row barrier", () => {
  const putCallers = sourceFiles(source).flatMap((path) => {
    const calls = [...readFileSync(path, "utf8").matchAll(/\b([\w$.]+)\.put\s*\(/gu)]
      .map((match) => match[1])
      .filter((receiver) => receiver !== "server"); // Fastify's HTTP PUT route.
    return calls.map((receiver) => ({ path, receiver }));
  });
  assert.deepEqual(putCallers.sort((a, b) => a.path.localeCompare(b.path)), [
    { path: join(source, "languages", "audio-repository.ts"), receiver: "input" },
    { path: join(source, "languages", "audio.ts"), receiver: "dependencies.storage" },
    { path: join(source, "languages", "documents", "repository.ts"), receiver: "input" },
    { path: join(source, "languages", "documents", "service.ts"), receiver: "this.storage" },
  ]);
  const audio = readFileSync(join(source, "languages", "audio.ts"), "utf8");
  const documents = readFileSync(join(source, "languages", "documents", "service.ts"), "utf8");
  const audioRepository = readFileSync(join(source, "languages", "audio-repository.ts"), "utf8");
  const documentRepository = readFileSync(join(source, "languages", "documents", "repository.ts"), "utf8");
  assert.match(audio, /completeUnderUserBarrier\([\s\S]*?put: \(\) => dependencies\.storage\.put/u);
  assert.match(documents, /markStorageReadyUnderUserBarrier\([\s\S]*?put: \(\) => this\.storage\.put/u);
  assert.match(audioRepository, /completeUnderUserBarrier\(input\)[\s\S]*?FOR KEY SHARE[\s\S]*?await input\.put\(\)/u);
  assert.match(documentRepository, /markStorageReadyUnderUserBarrier\(input\)[\s\S]*?FOR KEY SHARE[\s\S]*?await input\.put\(\)/u);
  const adapters = sourceFiles(source).flatMap((path) => {
    const count = [...readFileSync(path, "utf8").matchAll(/new PutObjectCommand\s*\(/gu)].length;
    return Array.from({ length: count }, () => path);
  });
  assert.deepEqual(adapters.sort(), [
    join(source, "languages", "audio-storage.ts"),
    join(source, "languages", "documents", "storage.ts"),
  ].sort());
});

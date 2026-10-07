import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GUI-28 admin UI exposes five levels, existing units and only the next upload slot", async () => {
  const screen = await readFile(new URL("../../web/src/components/admin-material-screen.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../../web/src/components/admin-screen.tsx", import.meta.url), "utf8");
  assert.match(admin, /href="\/admin\/material">Material curricular/u);
  assert.match(screen, /MATERIAL_LEVELS = \["A1", "A2", "B1", "B2", "C1"\]/u);
  assert.match(screen, /level\.units\.map/u);
  assert.match(screen, /level\.nextUnitOrder/u);
  assert.match(screen, /unit\.storageStatus === "ready" && unit\.processingStatus !== "ready"/u);
  assert.match(screen, /unit\.storageStatus === "failed"/u);
  assert.doesNotMatch(screen, /unit\.storageStatus === "ready"[^\n]*Subir documento/u);
  assert.match(screen, /response\.status === 401/u);
  assert.match(screen, /response\.status === 403/u);
});

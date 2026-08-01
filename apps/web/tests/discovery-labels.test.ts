import assert from "node:assert/strict";
import test from "node:test";
import {
  discoveryStatusLabels,
  getDiscoveryActionLabel,
} from "../src/components/discovery-status.js";
import { projectTypeLabels } from "../src/components/project-type-label.js";

test("exposes Spanish labels for project and discovery states", () => {
  assert.equal(projectTypeLabels.research, "Investigación");
  assert.equal(discoveryStatusLabels.ready_for_review, "Listo para revisión");
  assert.equal(getDiscoveryActionLabel("not_started"), "Iniciar descubrimiento");
  assert.equal(getDiscoveryActionLabel("completed"), "Ver contexto");
});

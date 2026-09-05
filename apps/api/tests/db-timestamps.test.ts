import assert from "node:assert/strict";
import test from "node:test";
import { dbTimestamp } from "../src/db/timestamps.js";

test("dbTimestamp converts a PostgreSQL timestamp string to Date", () => {
  const result = dbTimestamp("2026-09-05 00:43:56.837552");

  assert.ok(result instanceof Date);
  assert.equal(Number.isNaN(result.getTime()), false);
});

test("dbTimestamp preserves an existing valid Date", () => {
  const value = new Date("2026-09-05T00:43:56.837Z");

  assert.strictEqual(dbTimestamp(value), value);
});

test("dbTimestamp preserves the instant in a timestamp with time zone", () => {
  const result = dbTimestamp("2026-09-05 00:43:56.837552+00");

  assert.equal(result.toISOString(), "2026-09-05T00:43:56.837Z");
});

test("dbTimestamp rejects invalid and null runtime values", () => {
  assert.throws(() => dbTimestamp("not-a-timestamp"), {
    name: "TypeError",
    message: "Invalid database timestamp.",
  });
  assert.throws(() => dbTimestamp(new Date(Number.NaN)), {
    name: "TypeError",
    message: "Invalid database timestamp.",
  });
  assert.throws(() => dbTimestamp(null as never), {
    name: "TypeError",
    message: "Invalid database timestamp.",
  });
});

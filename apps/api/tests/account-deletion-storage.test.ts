import assert from "node:assert/strict";
import test from "node:test";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import {
  R2AccountObjectStorage,
  deleteExactObjectKeys,
  MAX_R2_DELETE_BATCH,
} from "../src/account-deletion/storage.js";

test("exact-key deletion is empty-safe, sorted, deduplicated, and batched", async () => {
  const batches: string[][] = [];
  const send = async (command: DeleteObjectsCommand) => {
    batches.push(command.input.Delete?.Objects?.map((item) => item.Key ?? "") ?? []);
    assert.equal(command.input.Bucket, "test-bucket");
    return {};
  };
  await deleteExactObjectKeys([], "test-bucket", send);
  assert.equal(batches.length, 0);
  await deleteExactObjectKeys(["one"], "test-bucket", send);
  assert.deepEqual(batches, [["one"]]);
  batches.length = 0;
  await deleteExactObjectKeys(["b", "a", "b"], "test-bucket", send);
  assert.deepEqual(batches, [["a", "b"]]);
  batches.length = 0;
  const keys = Array.from({ length: MAX_R2_DELETE_BATCH + 7 }, (_, index) =>
    `key-${String(index).padStart(4, "0")}`,
  );
  await deleteExactObjectKeys([...keys, keys[0]!], "test-bucket", send);
  assert.deepEqual(batches.map((batch) => batch.length), [MAX_R2_DELETE_BATCH, 7]);
  assert.deepEqual(batches.flat(), keys);
});

test("missing objects succeed, but partial or total R2 failures do not", async () => {
  await deleteExactObjectKeys(["missing"], "bucket", async () => ({
    Errors: [{ Key: "missing", Code: "NoSuchKey" }],
  }));
  await assert.rejects(
    deleteExactObjectKeys(["a", "b"], "bucket", async () => ({
      Errors: [{ Key: "b", Code: "AccessDenied" }],
    })),
    /failed to delete 1 object/,
  );
  await assert.rejects(
    deleteExactObjectKeys(["a"], "bucket", async () => { throw new Error("network down"); }),
    /network down/,
  );
});

test("R2 deletion fails closed when configuration is missing", async () => {
  const keys = ["R2_BUCKET_NAME", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_REGION"] as const;
  const original = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    await assert.rejects(new R2AccountObjectStorage().deleteKeys(["exact-key"]), /not configured/);
    await new R2AccountObjectStorage().deleteKeys([]);
  } finally {
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
});

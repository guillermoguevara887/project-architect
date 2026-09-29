import {
  accountDeletionRepository,
  type AccountDeletionRepository,
  type AccountDeletionTransactionResult,
} from "./repository.js";
import { accountObjectStorage, type AccountObjectStorage } from "./storage.js";

export type AccountDeletionResult = AccountDeletionTransactionResult
  | "storage_failed"
  | "database_failed"
  | "database_failed_after_storage_delete"
  | "retryable_database_failure";

class StorageDeleteFailure extends Error {
  constructor(readonly cause: unknown) { super("Account object deletion failed."); }
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  return typeof candidate.code === "string" ? candidate.code : postgresCode(candidate.cause);
}

/**
 * R2 is outside PostgreSQL's transaction. If SQL rolls back after R2 succeeds,
 * metadata remains and a retry deletes the same exact keys idempotently.
 * A connection failure during COMMIT can leave SQL outcome ambiguous: retry
 * continues if it rolled back, or returns already_deleted if it committed.
 * A dead R2 client can still materialize a late PUT after deletion (LOW risk).
 */
export async function deleteUserAccount(
  userId: string,
  dependencies: {
    repository?: AccountDeletionRepository;
    storage?: AccountObjectStorage;
  } = {},
): Promise<AccountDeletionResult> {
  const repository = dependencies.repository ?? accountDeletionRepository;
  const storage = dependencies.storage ?? accountObjectStorage;
  try {
    const guard = await repository.precheck(userId);
    if (guard !== "eligible") return guard;

    const revoked = await repository.revokeSessions(userId);
    if (revoked !== "eligible") return revoked;
  } catch (error) {
    return ["40P01", "55P03"].includes(postgresCode(error) ?? "")
      ? "retryable_database_failure"
      : "database_failed";
  }

  let storageDeletionCompleted = false;
  try {
    return await repository.deleteUnderLock(userId, async (keys) => {
      try {
        await storage.deleteKeys(keys);
        storageDeletionCompleted = keys.length > 0;
      } catch (error) {
        throw new StorageDeleteFailure(error);
      }
    });
  } catch (error) {
    if (error instanceof StorageDeleteFailure) {
      return ["40P01", "55P03"].includes(postgresCode(error.cause) ?? "")
        ? "retryable_database_failure"
        : "storage_failed";
    }
    if (storageDeletionCompleted) return "database_failed_after_storage_delete";
    if (["40P01", "55P03"].includes(postgresCode(error) ?? "")) {
      return "retryable_database_failure";
    }
    return "database_failed";
  }
}

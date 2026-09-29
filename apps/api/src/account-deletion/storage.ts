import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";

export interface AccountObjectStorage {
  deleteKeys(keys: readonly string[]): Promise<void>;
}

export const MAX_R2_DELETE_BATCH = 1_000;
export const R2_DELETE_TIMEOUT_MS = 30_000;

type DeleteResponse = { Errors?: Array<{ Key?: string; Code?: string; Message?: string }> };

export async function deleteExactObjectKeys(
  keys: readonly string[],
  bucket: string,
  send: (command: DeleteObjectsCommand) => Promise<DeleteResponse>,
) {
  const distinct = [...new Set(keys)].sort();
  for (let start = 0; start < distinct.length; start += MAX_R2_DELETE_BATCH) {
    const batch = distinct.slice(start, start + MAX_R2_DELETE_BATCH);
    const response = await send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
    const failures = response.Errors?.filter((error) => error.Code !== "NoSuchKey") ?? [];
    if (failures.length > 0) {
      throw new Error(`R2 failed to delete ${failures.length} object(s).`);
    }
  }
}

function requiredConfiguration() {
  const configuration = {
    bucket: process.env.R2_BUCKET_NAME,
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    region: process.env.R2_REGION,
  };
  if (Object.values(configuration).some((value) => !value)) {
    throw new Error("R2 account deletion storage is not configured.");
  }
  return configuration as Record<keyof typeof configuration, string>;
}

export class R2AccountObjectStorage implements AccountObjectStorage {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  async deleteKeys(keys: readonly string[]) {
    if (keys.length === 0) return;
    if (!this.client || !this.bucket) {
      const config = requiredConfiguration();
      this.bucket = config.bucket;
      this.client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
    }
    await deleteExactObjectKeys(keys, this.bucket, (command) =>
      this.client!.send(command, { abortSignal: AbortSignal.timeout(R2_DELETE_TIMEOUT_MS) }),
    );
  }
}

export const accountObjectStorage = new R2AccountObjectStorage();

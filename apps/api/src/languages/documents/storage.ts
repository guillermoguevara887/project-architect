import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type PutCurriculumDocumentInput = {
  key: string;
  contentType: string;
  body: Uint8Array;
};

export interface CurriculumDocumentStorage {
  put(input: PutCurriculumDocumentInput): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export function curriculumDocumentStorageKey(input: {
  userId: string;
  documentId: string;
  documentVersion: string;
  contentSha256: string;
}) {
  const identity = createHash("sha256")
    .update(input.userId)
    .update("\0")
    .update(input.documentId)
    .update("\0")
    .update(input.documentVersion)
    .digest("hex");

  return `language-curriculum/${identity}/${input.contentSha256}`;
}

function requiredR2Configuration() {
  const configuration = {
    bucket: process.env.R2_BUCKET_NAME,
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    region: process.env.R2_REGION,
  };

  if (Object.values(configuration).some((value) => !value)) {
    throw new Error("R2 curriculum document storage is not configured.");
  }

  return configuration as Record<keyof typeof configuration, string>;
}

export class R2CurriculumDocumentStorage implements CurriculumDocumentStorage {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  private configuredClient() {
    if (!this.client || !this.bucket) {
      const configuration = requiredR2Configuration();
      this.bucket = configuration.bucket;
      this.client = new S3Client({
        region: configuration.region,
        endpoint: configuration.endpoint,
        credentials: {
          accessKeyId: configuration.accessKeyId,
          secretAccessKey: configuration.secretAccessKey,
        },
      });
    }

    return { client: this.client, bucket: this.bucket };
  }

  async put(input: PutCurriculumDocumentInput) {
    const { client, bucket } = this.configuredClient();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async get(key: string) {
    const { client, bucket } = this.configuredClient();
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error("Curriculum document object has no body.");
    }

    return response.Body.transformToByteArray();
  }
}

export const curriculumDocumentStorage = new R2CurriculumDocumentStorage();

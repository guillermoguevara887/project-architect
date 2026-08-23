import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type PutLanguageAudioInput = {
  key: string;
  contentType: string;
  body: Uint8Array;
};

export interface LanguageAudioStorage {
  put(input: PutLanguageAudioInput): Promise<void>;
  get(key: string): Promise<Uint8Array>;
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
    throw new Error("R2 audio storage is not configured.");
  }

  return configuration as Record<keyof typeof configuration, string>;
}

export class R2LanguageAudioStorage implements LanguageAudioStorage {
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

  async put(input: PutLanguageAudioInput) {
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
      throw new Error("Language audio object has no body.");
    }

    return response.Body.transformToByteArray();
  }
}

export const languageAudioStorage = new R2LanguageAudioStorage();

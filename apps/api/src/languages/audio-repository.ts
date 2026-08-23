import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { languageAudioAssets } from "../db/schema.js";

export const LANGUAGE_AUDIO_GENERATION_TIMEOUT_MS = 5 * 60 * 1_000;

export type LanguageAudioAsset = typeof languageAudioAssets.$inferSelect;

export type ClaimLanguageAudioInput = Pick<
  LanguageAudioAsset,
  | "userId"
  | "language"
  | "normalizedText"
  | "originalText"
  | "provider"
  | "model"
  | "voice"
  | "audioFormat"
  | "storageKey"
>;

export type ClaimLanguageAudioResult =
  | {
      kind: "claimed";
      asset: LanguageAudioAsset;
      generationStartedAt: Date;
    }
  | { kind: "ready"; asset: LanguageAudioAsset }
  | { kind: "processing" };

export interface LanguageAudioStore {
  claim(input: ClaimLanguageAudioInput): Promise<ClaimLanguageAudioResult>;
  complete(input: {
    assetId: string;
    generationStartedAt: Date;
  }): Promise<LanguageAudioAsset | null>;
  fail(input: {
    assetId: string;
    generationStartedAt: Date;
  }): Promise<LanguageAudioAsset | null>;
}

export function isLanguageAudioGenerationActive(
  generationStartedAt: Date | null,
  now = Date.now(),
) {
  return Boolean(
    generationStartedAt &&
      now - generationStartedAt.getTime() < LANGUAGE_AUDIO_GENERATION_TIMEOUT_MS,
  );
}

function cacheIdentity(input: ClaimLanguageAudioInput) {
  return and(
    eq(languageAudioAssets.userId, input.userId),
    eq(languageAudioAssets.language, input.language),
    eq(languageAudioAssets.normalizedText, input.normalizedText),
    eq(languageAudioAssets.provider, input.provider),
    eq(languageAudioAssets.model, input.model),
    eq(languageAudioAssets.voice, input.voice),
    eq(languageAudioAssets.audioFormat, input.audioFormat),
  );
}

export const languageAudioStore: LanguageAudioStore = {
  async claim(input) {
    return getDb().transaction(async (transaction) => {
      const generationStartedAt = new Date();
      const [created] = await transaction
        .insert(languageAudioAssets)
        .values({
          ...input,
          status: "generating",
          generationStartedAt,
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        return {
          kind: "claimed" as const,
          asset: created,
          generationStartedAt,
        };
      }

      const [existing] = await transaction
        .select()
        .from(languageAudioAssets)
        .where(cacheIdentity(input))
        .limit(1)
        .for("update");

      if (!existing) {
        throw new Error("Language audio cache conflict could not be resolved.");
      }

      if (existing.status === "ready") {
        return { kind: "ready" as const, asset: existing };
      }

      if (
        existing.status === "generating" &&
        isLanguageAudioGenerationActive(existing.generationStartedAt)
      ) {
        return { kind: "processing" as const };
      }

      const [claimed] = await transaction
        .update(languageAudioAssets)
        .set({
          originalText: input.originalText,
          storageKey: input.storageKey,
          status: "generating",
          generationStartedAt,
          updatedAt: generationStartedAt,
        })
        .where(eq(languageAudioAssets.id, existing.id))
        .returning();

      if (!claimed) {
        throw new Error("Language audio cache could not be claimed.");
      }

      return {
        kind: "claimed" as const,
        asset: claimed,
        generationStartedAt,
      };
    });
  },

  async complete(input) {
    const completedAt = new Date();
    const [asset] = await getDb()
      .update(languageAudioAssets)
      .set({
        status: "ready",
        generationStartedAt: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(languageAudioAssets.id, input.assetId),
          eq(languageAudioAssets.status, "generating"),
          eq(
            languageAudioAssets.generationStartedAt,
            input.generationStartedAt,
          ),
        ),
      )
      .returning();

    return asset ?? null;
  },

  async fail(input) {
    const [asset] = await getDb()
      .update(languageAudioAssets)
      .set({
        status: "failed",
        generationStartedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(languageAudioAssets.id, input.assetId),
          eq(languageAudioAssets.status, "generating"),
          eq(
            languageAudioAssets.generationStartedAt,
            input.generationStartedAt,
          ),
        ),
      )
      .returning();

    return asset ?? null;
  },
};

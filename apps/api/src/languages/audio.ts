import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { StructuredLanguageLesson } from "./contracts.js";
import type {
  LanguageAudioAsset,
  LanguageAudioStore,
} from "./audio-repository.js";
import type { LanguageAudioStorage } from "./audio-storage.js";

export const LANGUAGE_AUDIO_CONFIG = {
  provider: "openai",
  model: "gpt-4o-mini-tts",
  voice: "coral",
  audioFormat: "mp3",
  contentType: "audio/mpeg",
} as const;

export const languageLessonAudioRequestSchema = z
  .object({
    version: z.enum(["original", "simplified"]),
    section: z.enum(["vocabulary", "phrases"]),
    index: z.number().int().min(0),
  })
  .strict();

export type LanguageLessonAudioRequest = z.infer<
  typeof languageLessonAudioRequestSchema
>;

export type GenerateLanguageAudioInput = {
  text: string;
  language: string;
};

export interface LanguageAudioProvider {
  generate(input: GenerateLanguageAudioInput): Promise<Uint8Array>;
}

export function normalizeLanguageAudioText(text: string) {
  return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function resolveLanguageLessonAudioText(
  content: StructuredLanguageLesson,
  target: Pick<LanguageLessonAudioRequest, "section" | "index">,
) {
  if (target.section === "vocabulary") {
    return content.vocabulary[target.index]?.term ?? null;
  }

  return content.phrases[target.index]?.text ?? null;
}

export function languageAudioStorageKey(input: {
  userId: string;
  language: string;
  normalizedText: string;
}) {
  const identity = JSON.stringify([
    input.userId,
    input.language,
    input.normalizedText,
    LANGUAGE_AUDIO_CONFIG.provider,
    LANGUAGE_AUDIO_CONFIG.model,
    LANGUAGE_AUDIO_CONFIG.voice,
    LANGUAGE_AUDIO_CONFIG.audioFormat,
  ]);
  const hash = createHash("sha256").update(identity).digest("hex");
  return `language-audio/${hash}.${LANGUAGE_AUDIO_CONFIG.audioFormat}`;
}

type CreateSpeech = (input: {
  model: typeof LANGUAGE_AUDIO_CONFIG.model;
  voice: typeof LANGUAGE_AUDIO_CONFIG.voice;
  input: string;
  instructions: string;
  response_format: typeof LANGUAGE_AUDIO_CONFIG.audioFormat;
}) => Promise<ArrayBuffer>;

async function createOpenAISpeech(
  input: Parameters<CreateSpeech>[0],
): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await new OpenAI({ apiKey }).audio.speech.create(input);
  return response.arrayBuffer();
}

export class OpenAILanguageAudioProvider implements LanguageAudioProvider {
  constructor(private readonly createSpeech: CreateSpeech = createOpenAISpeech) {}

  async generate(input: GenerateLanguageAudioInput) {
    const audio = await this.createSpeech({
      model: LANGUAGE_AUDIO_CONFIG.model,
      voice: LANGUAGE_AUDIO_CONFIG.voice,
      input: input.text,
      instructions: `Pronuncia con claridad y naturalidad en ${input.language}.`,
      response_format: LANGUAGE_AUDIO_CONFIG.audioFormat,
    });

    return new Uint8Array(audio);
  }
}

export type LanguageAudioResult =
  | { kind: "ready"; audio: Uint8Array; asset: LanguageAudioAsset }
  | { kind: "processing" };

export async function getOrCreateLanguageAudio(
  input: {
    userId: string;
    language: string;
    originalText: string;
  },
  dependencies: {
    store: LanguageAudioStore;
    provider: LanguageAudioProvider;
    storage: LanguageAudioStorage;
  },
): Promise<LanguageAudioResult> {
  const normalizedText = normalizeLanguageAudioText(input.originalText);

  if (!normalizedText) {
    throw new Error("Language audio text is empty.");
  }

  const storageKey = languageAudioStorageKey({
    userId: input.userId,
    language: input.language,
    normalizedText,
  });
  const claim = await dependencies.store.claim({
    userId: input.userId,
    language: input.language,
    normalizedText,
    originalText: input.originalText,
    provider: LANGUAGE_AUDIO_CONFIG.provider,
    model: LANGUAGE_AUDIO_CONFIG.model,
    voice: LANGUAGE_AUDIO_CONFIG.voice,
    audioFormat: LANGUAGE_AUDIO_CONFIG.audioFormat,
    storageKey,
  });

  if (claim.kind === "processing") {
    return claim;
  }

  if (claim.kind === "ready") {
    return {
      kind: "ready",
      asset: claim.asset,
      audio: await dependencies.storage.get(claim.asset.storageKey),
    };
  }

  try {
    const audio = await dependencies.provider.generate({
      text: input.originalText,
      language: input.language,
    });
    await dependencies.storage.put({
      key: claim.asset.storageKey,
      contentType: LANGUAGE_AUDIO_CONFIG.contentType,
      body: audio,
    });
    const asset = await dependencies.store.complete({
      assetId: claim.asset.id,
      generationStartedAt: claim.generationStartedAt,
    });

    if (!asset) {
      throw new Error("Language audio claim changed before completion.");
    }

    return { kind: "ready", asset, audio };
  } catch (error) {
    await dependencies.store.fail({
      assetId: claim.asset.id,
      generationStartedAt: claim.generationStartedAt,
    });
    throw error;
  }
}

export const languageAudioProvider = new OpenAILanguageAudioProvider();

import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { StructuredLanguageLesson } from "./contracts.js";
import type {
  LanguageAudioAsset,
  LanguageAudioStore,
} from "./audio-repository.js";
import type { LanguageAudioStorage } from "./audio-storage.js";

export type LanguageAudioConfiguration = {
  provider: "openai" | "elevenlabs";
  model: string;
  voice: string;
  audioFormat: string;
  fileExtension: string;
  contentType: string;
  languageCode?: LanguageStoryAudioLanguage;
};

export const OPENAI_LANGUAGE_AUDIO_CONFIG = {
  provider: "openai",
  model: "gpt-4o-mini-tts",
  voice: "coral",
  audioFormat: "mp3",
  fileExtension: "mp3",
  contentType: "audio/mpeg",
} as const;

// Keep the original export for callers that use the existing OpenAI defaults.
export const LANGUAGE_AUDIO_CONFIG = OPENAI_LANGUAGE_AUDIO_CONFIG;

const ELEVENLABS_AUDIO_FORMAT = "mp3_44100_128";

export const languageStoryVoiceSchema = z.enum(["male", "female"]);
export type LanguageStoryVoice = z.infer<typeof languageStoryVoiceSchema>;

export type LanguageStoryAudioLanguage =
  | "de"
  | "en"
  | "fr"
  | "pl"
  | "ja"
  | "it"
  | "pt"
  | "tr"
  | "vi"
  | "no";

type LanguageStoryAudioDefinition = {
  aliases: readonly string[];
  model: "eleven_multilingual_v2" | "eleven_flash_v2_5";
  languageCode?: LanguageStoryAudioLanguage;
  voiceEnvironment: Record<LanguageStoryVoice, string>;
};

const LANGUAGE_STORY_AUDIO_DEFINITIONS: Record<
  LanguageStoryAudioLanguage,
  LanguageStoryAudioDefinition
> = {
  de: {
    aliases: ["german", "deutsch", "aleman"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_DE_MALE",
      female: "ELEVENLABS_VOICE_ID_DE_FEMALE",
    },
  },
  en: {
    aliases: ["english", "ingles"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_EN_MALE",
      female: "ELEVENLABS_VOICE_ID_EN_FEMALE",
    },
  },
  fr: {
    aliases: ["french", "francais", "frances"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_FR_MALE",
      female: "ELEVENLABS_VOICE_ID_FR_FEMALE",
    },
  },
  pl: {
    aliases: ["polish", "polski", "polaco"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_PL_MALE",
      female: "ELEVENLABS_VOICE_ID_PL_FEMALE",
    },
  },
  ja: {
    aliases: ["japanese", "japones", "日本語"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_JA_MALE",
      female: "ELEVENLABS_VOICE_ID_JA_FEMALE",
    },
  },
  it: {
    aliases: ["italian", "italiano"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_IT_MALE",
      female: "ELEVENLABS_VOICE_ID_IT_FEMALE",
    },
  },
  pt: {
    aliases: ["portuguese", "portugues"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_PT_MALE",
      female: "ELEVENLABS_VOICE_ID_PT_FEMALE",
    },
  },
  tr: {
    aliases: ["turkish", "turkce", "turco"],
    model: "eleven_multilingual_v2",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_TR_MALE",
      female: "ELEVENLABS_VOICE_ID_TR_FEMALE",
    },
  },
  vi: {
    aliases: ["vietnamese", "tieng viet", "vietnamita"],
    model: "eleven_flash_v2_5",
    languageCode: "vi",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_VI_MALE",
      female: "ELEVENLABS_VOICE_ID_VI_FEMALE",
    },
  },
  no: {
    aliases: ["norwegian", "norsk", "noruego"],
    model: "eleven_flash_v2_5",
    languageCode: "no",
    voiceEnvironment: {
      male: "ELEVENLABS_VOICE_ID_NO_MALE",
      female: "ELEVENLABS_VOICE_ID_NO_FEMALE",
    },
  },
};

function normalizeLanguageStoryAudioAlias(language: string) {
  return language
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("und");
}

export function resolveLanguageStoryAudioLanguage(
  language: string,
): LanguageStoryAudioLanguage | null {
  const normalizedLanguage = normalizeLanguageStoryAudioAlias(language);

  for (const [code, definition] of Object.entries(
    LANGUAGE_STORY_AUDIO_DEFINITIONS,
  ) as Array<[LanguageStoryAudioLanguage, LanguageStoryAudioDefinition]>) {
    if (definition.aliases.includes(normalizedLanguage)) {
      return code;
    }
  }

  return null;
}

export function resolveLanguageStoryAudioConfiguration(
  language: string,
  voice: LanguageStoryVoice,
  readEnvironment: (name: string) => string | undefined = (name) =>
    process.env[name],
): LanguageAudioConfiguration | null {
  const languageCode = resolveLanguageStoryAudioLanguage(language);

  if (!languageCode) return null;

  const definition = LANGUAGE_STORY_AUDIO_DEFINITIONS[languageCode];
  const voiceId = readEnvironment(definition.voiceEnvironment[voice])?.trim();

  if (!voiceId) return null;

  return {
    provider: "elevenlabs",
    model: definition.model,
    voice: voiceId,
    audioFormat: ELEVENLABS_AUDIO_FORMAT,
    fileExtension: "mp3",
    contentType: "audio/mpeg",
    ...(definition.languageCode
      ? { languageCode: definition.languageCode }
      : {}),
  };
}

const languageLessonAudioVersionSchema = z.enum(["original", "simplified"]);
const languageLessonAudioIndexSchema = z.number().int().min(0);

export const languageLessonAudioRequestSchema = z
  .discriminatedUnion("section", [
    z
      .object({
        version: languageLessonAudioVersionSchema,
        section: z.literal("vocabulary"),
        index: languageLessonAudioIndexSchema,
      })
      .strict(),
    z
      .object({
        version: languageLessonAudioVersionSchema,
        section: z.literal("phrases"),
        index: languageLessonAudioIndexSchema,
      })
      .strict(),
    z
      .object({
        version: languageLessonAudioVersionSchema,
        section: z.literal("automaticThoughts"),
        index: languageLessonAudioIndexSchema,
      })
      .strict(),
    z
      .object({
        version: languageLessonAudioVersionSchema,
        section: z.literal("miniStory"),
        index: languageLessonAudioIndexSchema,
        voice: languageStoryVoiceSchema,
      })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (input.section === "miniStory" && input.index !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["index"],
        message: "Mini story audio only supports index 0.",
      });
    }
  });

export type LanguageLessonAudioRequest = z.infer<
  typeof languageLessonAudioRequestSchema
>;

export type GenerateLanguageAudioInput = {
  text: string;
  language: string;
  configuration: LanguageAudioConfiguration;
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

  if (target.section === "miniStory") {
    return target.index === 0 ? content.miniStory.text : null;
  }

  if (target.section === "automaticThoughts") {
    return content.automaticThoughts[target.index]?.text ?? null;
  }

  return content.phrases[target.index]?.text ?? null;
}

export function languageAudioStorageKey(input: {
  userId: string;
  language: string;
  normalizedText: string;
  configuration?: LanguageAudioConfiguration;
}) {
  const configuration = input.configuration ?? OPENAI_LANGUAGE_AUDIO_CONFIG;
  const identity = JSON.stringify([
    input.userId,
    input.language,
    input.normalizedText,
    configuration.provider,
    configuration.model,
    configuration.voice,
    configuration.audioFormat,
  ]);
  const hash = createHash("sha256").update(identity).digest("hex");
  return `language-audio/${hash}.${configuration.fileExtension}`;
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
      model: OPENAI_LANGUAGE_AUDIO_CONFIG.model,
      voice: OPENAI_LANGUAGE_AUDIO_CONFIG.voice,
      input: input.text,
      instructions: `Pronuncia con claridad y naturalidad en ${input.language}.`,
      response_format: OPENAI_LANGUAGE_AUDIO_CONFIG.audioFormat,
    });

    return new Uint8Array(audio);
  }
}

type ElevenLabsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "arrayBuffer">>;

export class ElevenLabsLanguageAudioProvider implements LanguageAudioProvider {
  constructor(
    private readonly fetchImplementation: ElevenLabsFetch = fetch,
    private readonly apiKey: () => string | undefined = () =>
      process.env.ELEVENLABS_API_KEY,
  ) {}

  async generate(input: GenerateLanguageAudioInput) {
    const apiKey = this.apiKey();

    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured.");
    }

    const { configuration } = input;
    const response = await this.fetchImplementation(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(configuration.voice)}?output_format=${encodeURIComponent(configuration.audioFormat)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: configuration.contentType,
        },
        body: JSON.stringify({
          text: input.text,
          model_id: configuration.model,
          ...(configuration.languageCode
            ? { language_code: configuration.languageCode }
            : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS failed with status ${response.status}.`);
    }

    return new Uint8Array(await response.arrayBuffer());
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
    configuration?: LanguageAudioConfiguration;
  },
  dependencies: {
    store: LanguageAudioStore;
    provider: LanguageAudioProvider;
    storage: LanguageAudioStorage;
  },
): Promise<LanguageAudioResult> {
  const normalizedText = normalizeLanguageAudioText(input.originalText);
  const configuration = input.configuration ?? OPENAI_LANGUAGE_AUDIO_CONFIG;

  if (!normalizedText) {
    throw new Error("Language audio text is empty.");
  }

  const storageKey = languageAudioStorageKey({
    userId: input.userId,
    language: input.language,
    normalizedText,
    configuration,
  });
  const claim = await dependencies.store.claim({
    userId: input.userId,
    language: input.language,
    normalizedText,
    originalText: input.originalText,
    provider: configuration.provider,
    model: configuration.model,
    voice: configuration.voice,
    audioFormat: configuration.audioFormat,
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
      configuration,
    });
    await dependencies.storage.put({
      key: claim.asset.storageKey,
      contentType: configuration.contentType,
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
export const elevenLabsLanguageAudioProvider =
  new ElevenLabsLanguageAudioProvider();

import { z } from "zod";

export const LANGUAGE_LESSON_SOURCE_MAX_LENGTH = 100_000;

export const languageProjectIdSchema = z.string().uuid();
export const languageLessonIdSchema = z.string().uuid();

export const languageLessonStatusSchema = z.enum([
  "draft",
  "processing",
  "ready",
  "failed",
]);

export type LanguageLessonStatus = z.infer<typeof languageLessonStatusSchema>;

export const languageLessonSourceSchema = z.enum([
  "assimil",
  "language_framework",
  "free",
]);

export type LanguageLessonSource = z.infer<typeof languageLessonSourceSchema>;

const requiredText = z.string().trim().min(1);

const languageLessonKanjiSchema = z
  .array(
    z
      .object({
        word: requiredText,
        reading: requiredText,
        meaning: requiredText,
        components: z
          .array(
            z
              .object({
                character: requiredText,
                readingInWord: requiredText.nullable(),
                meaning: requiredText,
              })
              .strict(),
          )
          .min(1)
          .max(4),
      })
      .strict(),
  )
  .max(4);

const structuredLanguageLessonShape = {
    vocabulary: z
      .array(
        z
          .object({
            term: requiredText,
            meaning: requiredText,
            example: requiredText.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    phrases: z
      .array(
        z
          .object({
            text: requiredText,
            translation: requiredText,
            note: requiredText.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    patterns: z
      .array(
        z
          .object({
            name: requiredText,
            explanation: requiredText,
            examples: z.array(requiredText).min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    miniStory: z
      .object({
        text: requiredText,
      })
      .strict(),
    automaticThoughts: z
      .array(
        z
          .object({
            text: requiredText,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    dialogue: z
      .array(
        z
          .object({
            speaker: requiredText,
            text: requiredText,
          })
          .strict(),
      )
      .min(1)
      .max(16),
    nextLevelBridge: z
      .array(
        z
          .object({
            base: requiredText,
            advanced: requiredText,
            note: requiredText,
          })
          .strict(),
      )
      .min(1)
      .max(5),
    review: z
      .object({
        keyVocabulary: z.array(requiredText).min(1).max(5),
        keyPatterns: z.array(requiredText).min(1).max(5),
      })
      .strict(),
};

export const structuredLanguageLessonSchema = z
  .object({
    ...structuredLanguageLessonShape,
    kanji: languageLessonKanjiSchema.optional(),
  })
  .strict();

export const generatedStructuredLanguageLessonSchema = z
  .object({
    ...structuredLanguageLessonShape,
    kanji: languageLessonKanjiSchema,
  })
  .strict();

export type StructuredLanguageLesson = z.infer<
  typeof structuredLanguageLessonSchema
>;

export type GeneratedStructuredLanguageLesson = z.infer<
  typeof generatedStructuredLanguageLessonSchema
>;

export const createLanguageProjectSchema = z
  .object({
    language: z.string().trim().min(1).max(100),
    level: z.string().trim().min(1).max(100),
  })
  .strict();

export const createLanguageLessonSchema = z
  .object({
    lessonSource: languageLessonSourceSchema.default("free"),
  })
  .strict();

export const updateLanguageLessonSchema = z
  .object({
    sourceContent: z.string().max(LANGUAGE_LESSON_SOURCE_MAX_LENGTH),
  })
  .strict();

export const processLanguageLessonSchema = z
  .object({
    sourceContent: z
      .string()
      .max(LANGUAGE_LESSON_SOURCE_MAX_LENGTH)
      .refine((value) => value.trim().length > 0),
  })
  .strict();

export const simplifyLanguageLessonSchema = z
  .object({
    regenerate: z.boolean().default(false),
  })
  .strict();

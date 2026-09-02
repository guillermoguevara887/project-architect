import { z } from "zod";

export const LANGUAGE_LESSON_SOURCE_MAX_LENGTH = 100_000;
export const LANGUAGE_FREE_LESSON_TITLE_MAX_LENGTH = 160;
export const LANGUAGE_FREE_LESSON_TITLE_MIN_SOURCE_LENGTH = 20;

export const languageProjectIdSchema = z.string().uuid();
export const languageLessonIdSchema = z.string().uuid();

export const languageLessonStatusSchema = z.enum([
  "draft",
  "processing",
  "ready",
  "failed",
]);

export type LanguageLessonStatus = z.infer<typeof languageLessonStatusSchema>;

export const languageLessonLearningStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);

export type LanguageLessonLearningStatus = z.infer<
  typeof languageLessonLearningStatusSchema
>;

export const languageLessonDifficultySchema = z.enum([
  "easy",
  "normal",
  "hard",
]);

export type LanguageLessonDifficulty = z.infer<
  typeof languageLessonDifficultySchema
>;

export const languageLessonSourceSchema = z.enum([
  "assimil",
  "language_framework",
  "free",
]);

export type LanguageLessonSource = z.infer<typeof languageLessonSourceSchema>;

export type LanguageLessonSplitPart = "A" | "B";

const requiredText = z.string().trim().min(1);

const freeLanguageLessonAnalysisItemSchema = z
  .object({
    phrase: requiredText.max(500),
    pattern: requiredText.max(200),
    explanation: requiredText.max(500),
  })
  .strict();

export const freeLanguageLessonAnalysisSchema = z
  .object({
    items: z.array(freeLanguageLessonAnalysisItemSchema).min(1).max(5),
  })
  .strict();

export type FreeLanguageLessonAnalysis = z.infer<
  typeof freeLanguageLessonAnalysisSchema
>;

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

const assimilComprehensionItemSchema = z
  .object({
    line: requiredText,
    translation: requiredText,
    note: requiredText.nullable(),
  })
  .strict();

const assimilNoteSchema = z
  .object({
    title: requiredText,
    explanation: requiredText,
  })
  .strict();

const assimilPatternSchema = z
  .object({
    pattern: requiredText,
    explanation: requiredText,
    examples: z.array(requiredText).min(1).max(3),
  })
  .strict();

const assimilKeyPhraseSchema = z
  .object({
    text: requiredText,
    meaning: requiredText,
  })
  .strict();

const assimilPracticeItemSchema = z
  .object({
    prompt: requiredText,
    answer: requiredText,
  })
  .strict();

const assimilDialogueItemSchema = z
  .object({
    speaker: requiredText,
    text: z.string().refine((value) => value.trim().length > 0),
  })
  .strict();

const assimilLanguageLessonContentShape = {
  kind: z.literal("assimil_v1"),
  comprehension: z.array(assimilComprehensionItemSchema).min(1).max(30),
  notes: z.array(assimilNoteSchema).min(3).max(5),
  patterns: z.array(assimilPatternSchema).min(1).max(3),
  keyPhrases: z.array(assimilKeyPhraseSchema).min(3).max(5),
  practice: z
    .object({
      instructions: requiredText,
      items: z.array(assimilPracticeItemSchema).min(2).max(5),
    })
    .strict(),
  review: z
    .object({
      points: z.array(requiredText).min(2).max(5),
    })
    .strict()
    .nullable(),
};

export const assimilLanguageLessonContentSchema = z
  .object({
    ...assimilLanguageLessonContentShape,
    dialogue: z.array(assimilDialogueItemSchema).max(16).optional(),
  })
  .strict();

export const generatedAssimilLanguageLessonContentSchema = z
  .object({
    ...assimilLanguageLessonContentShape,
    dialogue: z.array(assimilDialogueItemSchema).max(16),
  })
  .strict();

export type AssimilLanguageLessonContent = z.infer<
  typeof assimilLanguageLessonContentSchema
>;

export type GeneratedAssimilLanguageLessonContent = z.infer<
  typeof generatedAssimilLanguageLessonContentSchema
>;

export type PersistedLanguageLessonContent =
  | StructuredLanguageLesson
  | AssimilLanguageLessonContent;

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
    sourceLessonNumber: z.number().int().min(1).max(9_999).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.lessonSource === "assimil" &&
      value.sourceLessonNumber === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceLessonNumber"],
        message: "Assimil lessons require a source lesson number.",
      });
    }

    if (
      value.lessonSource !== "assimil" &&
      value.sourceLessonNumber !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceLessonNumber"],
        message: "Only Assimil lessons accept a source lesson number.",
      });
    }
  });

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

export const prepareFreeLanguageLessonSchema = z
  .object({
    title: z.string().trim().min(1).max(LANGUAGE_FREE_LESSON_TITLE_MAX_LENGTH),
    sourceContent: z
      .string()
      .max(LANGUAGE_LESSON_SOURCE_MAX_LENGTH)
      .refine((value) => value.trim().length > 0),
  })
  .strict();

export const generateFreeLanguageLessonTitleSchema = z
  .object({
    sourceContent: z
      .string()
      .max(LANGUAGE_LESSON_SOURCE_MAX_LENGTH)
      .refine(
        (value) =>
          value.trim().length >= LANGUAGE_FREE_LESSON_TITLE_MIN_SOURCE_LENGTH,
      ),
  })
  .strict();

export const generatedFreeLanguageLessonTitleSchema = z
  .object({
    title: z.string().trim().min(1).max(LANGUAGE_FREE_LESSON_TITLE_MAX_LENGTH),
  })
  .strict();

export const simplifyLanguageLessonSchema = z
  .object({
    regenerate: z.boolean().default(false),
  })
  .strict();

export const updateLanguageLessonProgressSchema = z
  .object({
    learningStatus: languageLessonLearningStatusSchema.optional(),
    difficulty: languageLessonDifficultySchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.learningStatus !== undefined || value.difficulty !== undefined,
  );

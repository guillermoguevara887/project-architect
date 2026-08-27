import { z } from "zod";

export const EXERCISE_TITLE_MAX_LENGTH = 200;
export const EXERCISE_PROMPT_MAX_LENGTH = 100_000;
export const EXERCISE_METADATA_MAX_LENGTH = 300;
export const EXERCISE_WORKSPACE_MAX_LENGTH = 4_000;
export const EXERCISE_GUIDE_MAX_GENERATIONS = 2;

export const exerciseStatusSchema = z.enum([
  "pending",
  "working",
  "solved",
]);

export type ExerciseStatus = z.infer<typeof exerciseStatusSchema>;

export const exerciseWorkspaceTypeSchema = z.enum([
  "colab",
  "local",
  "url",
]);

export type ExerciseWorkspaceType = z.infer<
  typeof exerciseWorkspaceTypeSchema
>;

function optionalMetadata() {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(EXERCISE_METADATA_MAX_LENGTH).nullable().optional(),
  );
}

export const exerciseIdSchema = z.string().uuid();

export const createExerciseSchema = z
  .object({
    title: z.string().trim().min(1).max(EXERCISE_TITLE_MAX_LENGTH),
    prompt: z.string().trim().min(1).max(EXERCISE_PROMPT_MAX_LENGTH),
    sourceName: optionalMetadata(),
    chapter: optionalMetadata(),
    exerciseNumber: optionalMetadata(),
  })
  .strict();

export const updateExerciseSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(EXERCISE_TITLE_MAX_LENGTH)
      .optional(),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(EXERCISE_PROMPT_MAX_LENGTH)
      .optional(),
    sourceName: optionalMetadata(),
    chapter: optionalMetadata(),
    exerciseNumber: optionalMetadata(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const updateExerciseStatusSchema = z
  .object({ status: exerciseStatusSchema })
  .strict();

function httpUrl(message: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(EXERCISE_WORKSPACE_MAX_LENGTH)
    .refine((value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, message);
}

const colabUrlSchema = httpUrl("La URL de Colab no es válida.").refine(
  (value) => new URL(value).hostname === "colab.research.google.com",
  "La URL debe pertenecer a Google Colab.",
);

export const updateExerciseWorkspaceSchema = z.discriminatedUnion(
  "workspaceType",
  [
    z
      .object({
        workspaceType: z.literal("colab"),
        workspaceValue: colabUrlSchema,
      })
      .strict(),
    z
      .object({
        workspaceType: z.literal("local"),
        workspaceValue: z
          .string()
          .trim()
          .min(1)
          .max(EXERCISE_WORKSPACE_MAX_LENGTH),
      })
      .strict(),
    z
      .object({
        workspaceType: z.literal("url"),
        workspaceValue: httpUrl("El enlace no es válido."),
      })
      .strict(),
    z
      .object({
        workspaceType: z.null(),
        workspaceValue: z.null(),
      })
      .strict(),
  ],
);

const rawMarkdownPattern = /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s)|\*\*|__/m;

function guidePlainText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !rawMarkdownPattern.test(value), {
      message: "Guide fields must contain plain text, not Markdown.",
    });
}

export const exerciseGuideSectionTypeSchema = z.enum([
  "explanation",
  "concepts",
  "bullets",
]);

export type ExerciseGuideSectionType = z.infer<
  typeof exerciseGuideSectionTypeSchema
>;

export const exerciseGuideItemSchema = z
  .object({
    label: guidePlainText(100).nullable(),
    text: guidePlainText(500),
  })
  .strict();

export const exerciseGuideSectionSchema = z
  .object({
    type: exerciseGuideSectionTypeSchema,
    title: guidePlainText(120),
    intro: guidePlainText(700).nullable(),
    items: z.array(exerciseGuideItemSchema).max(5),
  })
  .strict()
  .superRefine((section, context) => {
    if (section.type === "explanation") {
      if (!section.intro || section.items.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Explanation sections require intro and no items.",
        });
      }

      return;
    }

    if (section.items.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Concept and bullet sections require items.",
      });
    }

    if (section.type === "bullets" && section.items.length > 4) {
      context.addIssue({
        code: "custom",
        message: "Bullet sections support at most four items.",
      });
    }

    if (
      section.type === "concepts" &&
      section.items.some((item) => item.label === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Concept items require labels.",
      });
    }
  });

export const generatedExerciseGuideSchema = z
  .object({
    sections: z.array(exerciseGuideSectionSchema).min(2).max(5),
  })
  .strict()
  .superRefine((guide, context) => {
    const words = guide.sections
      .flatMap((section) => [
        section.title,
        section.intro ?? "",
        ...section.items.flatMap((item) => [item.label ?? "", item.text]),
      ])
      .join(" ")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);

    if (words.length > 400) {
      context.addIssue({
        code: "custom",
        message: "Exercise guides must contain at most 400 words.",
      });
    }
  });

export type StructuredExerciseGuide = z.infer<
  typeof generatedExerciseGuideSchema
>;

export const generatedExerciseStepsSchema = z
  .object({
    steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(20),
  })
  .strict();

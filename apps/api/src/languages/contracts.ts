import { z } from "zod";

export const languageProjectIdSchema = z.string().uuid();
export const languageLessonIdSchema = z.string().uuid();

export const createLanguageProjectSchema = z
  .object({
    language: z.string().trim().min(1).max(100),
    level: z.string().trim().min(1).max(100),
  })
  .strict();

export const updateLanguageLessonSchema = z
  .object({
    sourceContent: z.string().max(1_000_000),
  })
  .strict();

import { z } from "zod";
import {
  DiscoveryStatusSchema,
  ProjectDiscoverySummarySchema,
} from "./discovery-shared.js";
import { ProjectSchema } from "./project.js";

export {
  DiscoveryStatusSchema,
  ProjectDiscoverySummarySchema,
} from "./discovery-shared.js";

export const DiscoveryQuestionTypeSchema = z.enum([
  "short_text",
  "long_text",
  "number",
  "date",
  "single_select",
  "multi_select",
  "yes_no",
]);

export const DiscoveryAnswerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const DiscoveryAnswerSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: DiscoveryAnswerValueSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DiscoveryQuestionSchema = z.object({
  id: z.string().uuid(),
  discoverySessionId: z.string().uuid(),
  questionKey: z.string(),
  questionText: z.string(),
  category: z.string(),
  sectionKey: z.string(),
  sectionTitle: z.string(),
  questionType: DiscoveryQuestionTypeSchema,
  options: z.array(z.string()).nullable(),
  position: z.number().int().nonnegative(),
  sectionPosition: z.number().int().nonnegative(),
  isRequired: z.boolean(),
  createdAt: z.string().datetime(),
  answer: DiscoveryAnswerSchema.nullable(),
});

export const DiscoverySectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  position: z.number().int().nonnegative(),
  questions: z.array(DiscoveryQuestionSchema),
});

export const DiscoverySessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: DiscoveryStatusSchema,
  currentStep: z.number().int().nonnegative(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DiscoveryProgressSchema = z.object({
  totalQuestions: z.number().int().nonnegative(),
  answeredQuestions: z.number().int().nonnegative(),
  requiredQuestions: z.number().int().nonnegative(),
  answeredRequiredQuestions: z.number().int().nonnegative(),
  percentage: z.number().int().min(0).max(100),
  requiredPercentage: z.number().int().min(0).max(100),
  missingRequiredQuestionIds: z.array(z.string().uuid()),
});

export const ProjectWithDiscoverySchema = ProjectSchema.extend({
  discovery: ProjectDiscoverySummarySchema,
});

export const ProjectDetailResponseSchema = z.object({
  project: ProjectWithDiscoverySchema,
});

export const DiscoveryDetailSchema = z.object({
  project: ProjectSchema,
  session: DiscoverySessionSchema,
  sections: z.array(DiscoverySectionSchema),
  progress: DiscoveryProgressSchema,
});

export const DiscoveryDetailResponseSchema = z.object({
  discovery: DiscoveryDetailSchema,
});

export const DiscoveryProgressResponseSchema = z.object({
  progress: DiscoveryProgressSchema,
});

export const SaveDiscoveryAnswerRequestSchema = z.object({
  answer: DiscoveryAnswerValueSchema.nullable(),
});

export const SaveDiscoveryAnswerResponseSchema = z.object({
  answer: DiscoveryAnswerSchema.nullable(),
  progress: DiscoveryProgressSchema,
});

export const UpdateDiscoverySessionRequestSchema = z.object({
  currentStep: z.number().int().nonnegative(),
});

export const DiscoverySessionResponseSchema = z.object({
  session: DiscoverySessionSchema,
  progress: DiscoveryProgressSchema,
});

export const ProjectIdParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const DiscoveryAnswerParamsSchema = ProjectIdParamsSchema.extend({
  questionId: z.string().uuid(),
});

export type { DiscoveryStatus } from "./discovery-shared.js";
export type DiscoveryQuestionType = z.infer<
  typeof DiscoveryQuestionTypeSchema
>;
export type DiscoveryAnswerValue = z.infer<
  typeof DiscoveryAnswerValueSchema
>;
export type DiscoveryAnswer = z.infer<typeof DiscoveryAnswerSchema>;
export type DiscoveryQuestion = z.infer<typeof DiscoveryQuestionSchema>;
export type DiscoverySection = z.infer<typeof DiscoverySectionSchema>;
export type DiscoverySession = z.infer<typeof DiscoverySessionSchema>;
export type DiscoveryProgress = z.infer<typeof DiscoveryProgressSchema>;
export type { ProjectDiscoverySummary } from "./discovery-shared.js";
export type ProjectWithDiscovery = z.infer<
  typeof ProjectWithDiscoverySchema
>;
export type ProjectDetailResponse = z.infer<
  typeof ProjectDetailResponseSchema
>;
export type DiscoveryDetail = z.infer<typeof DiscoveryDetailSchema>;
export type DiscoveryDetailResponse = z.infer<
  typeof DiscoveryDetailResponseSchema
>;
export type DiscoveryProgressResponse = z.infer<
  typeof DiscoveryProgressResponseSchema
>;
export type SaveDiscoveryAnswerRequest = z.infer<
  typeof SaveDiscoveryAnswerRequestSchema
>;
export type SaveDiscoveryAnswerResponse = z.infer<
  typeof SaveDiscoveryAnswerResponseSchema
>;
export type UpdateDiscoverySessionRequest = z.infer<
  typeof UpdateDiscoverySessionRequestSchema
>;
export type DiscoverySessionResponse = z.infer<
  typeof DiscoverySessionResponseSchema
>;
export type ProjectIdParams = z.infer<typeof ProjectIdParamsSchema>;
export type DiscoveryAnswerParams = z.infer<
  typeof DiscoveryAnswerParamsSchema
>;

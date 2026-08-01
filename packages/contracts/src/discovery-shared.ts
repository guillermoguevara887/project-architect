import { z } from "zod";

export const DiscoveryStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "ready_for_review",
  "completed",
]);

export const ProjectDiscoverySummarySchema = z.object({
  status: DiscoveryStatusSchema,
  percentage: z.number().int().min(0).max(100),
  currentStep: z.number().int().nonnegative(),
});

export type DiscoveryStatus = z.infer<typeof DiscoveryStatusSchema>;
export type ProjectDiscoverySummary = z.infer<
  typeof ProjectDiscoverySummarySchema
>;

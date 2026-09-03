import { z } from "zod";

export const requiredTextSchema = z.string().trim().min(1);

export const domainIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Invalid domain id");

export type DomainId = z.infer<typeof domainIdSchema>;

export const semanticVersionSchema = z
  .string()
  .trim()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
    "Invalid semantic version",
  );

export type SemanticVersion = z.infer<typeof semanticVersionSchema>;

export const versionedRefSchema = z
  .object({
    id: domainIdSchema,
    version: semanticVersionSchema,
  })
  .strict();

export type VersionedRef = z.infer<typeof versionedRefSchema>;

export const supportLevelSchema = z.enum([
  "highly_guided",
  "guided",
  "scaffolded",
  "independent",
]);

export type SupportLevel = z.infer<typeof supportLevelSchema>;

export const criticalitySchema = z.enum(["supporting", "core", "critical"]);
export type Criticality = z.infer<typeof criticalitySchema>;

export const modalitySchema = z.enum([
  "listening",
  "speaking",
  "reading",
  "writing",
  "interaction",
  "mediation",
]);

export type Modality = z.infer<typeof modalitySchema>;

export const confidenceSchema = z.enum(["high", "medium", "low", "contested"]);
export type Confidence = z.infer<typeof confidenceSchema>;

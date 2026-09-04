import { z } from "zod";

export const validationIssueSeveritySchema = z.enum(["error", "warning", "info"]);
export type ValidationIssueSeverity = z.infer<
  typeof validationIssueSeveritySchema
>;

export const validationIssueSchema = z
  .object({
    code: z.string().trim().min(1),
    severity: validationIssueSeveritySchema,
    path: z.string(),
    message: z.string().trim().min(1),
    relatedRefs: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(validationIssueSchema),
  })
  .strict();

export type ValidationResult = z.infer<typeof validationResultSchema>;

export function validationResult(issues: ValidationIssue[]): ValidationResult {
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

export function validationIssue(
  code: string,
  path: string,
  message: string,
  options: {
    severity?: ValidationIssueSeverity;
    relatedRefs?: string[];
  } = {},
): ValidationIssue {
  return {
    code,
    severity: options.severity ?? "error",
    path,
    message,
    relatedRefs: options.relatedRefs ?? [],
  };
}

export function zodIssuesToValidationIssues(
  error: z.ZodError,
): ValidationIssue[] {
  return error.issues.map((issue) =>
    validationIssue(
      "STRUCTURAL_VALIDATION_ERROR",
      issue.path.join("."),
      issue.message,
    ),
  );
}

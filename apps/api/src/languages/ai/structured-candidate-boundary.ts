import { z } from "zod";
import {
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";

export type CandidateValidationAttempt = {
  attempt: number;
  outcome: "accepted" | "invalid_candidate";
  issues: ValidationIssue[];
};

export type ValidatedCandidate<T> = {
  value: T;
  attempts: number;
  validationHistory: CandidateValidationAttempt[];
};

export type CandidateGenerationContext = {
  attempt: number;
  previousIssues: ValidationIssue[];
};

export type CandidateGenerator = (
  context: CandidateGenerationContext,
) => Promise<unknown>;

export type CandidateSemanticValidator<T> = (candidate: T) => ValidationResult;

export type StructuredCandidateBoundaryOptions<T> = {
  schema: z.ZodType<T>;
  generate: CandidateGenerator;
  semanticValidator?: CandidateSemanticValidator<T>;
  maxAttempts?: number;
};

export type StructuredCandidateBoundaryErrorCode =
  | "not_configured"
  | "provider_error"
  | "refusal"
  | "empty_response"
  | "incomplete_response"
  | "retry_exhausted";

export class StructuredCandidateBoundaryError extends Error {
  constructor(
    readonly code: StructuredCandidateBoundaryErrorCode,
    readonly validationHistory: CandidateValidationAttempt[] = [],
  ) {
    super(`Structured AI boundary failed: ${code}`);
    this.name = "StructuredCandidateBoundaryError";
  }
}

function validateCandidate<T>(
  candidate: unknown,
  schema: z.ZodType<T>,
  semanticValidator?: CandidateSemanticValidator<T>,
): { parsed?: T; result: ValidationResult } {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      result: validationResult(zodIssuesToValidationIssues(parsed.error)),
    };
  }

  if (!semanticValidator) {
    return {
      parsed: parsed.data,
      result: validationResult([]),
    };
  }

  const semanticResult = semanticValidator(parsed.data);
  return {
    parsed: parsed.data,
    result: semanticResult,
  };
}

export async function runStructuredCandidateBoundary<T>(
  options: StructuredCandidateBoundaryOptions<T>,
): Promise<ValidatedCandidate<T>> {
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new RangeError("maxAttempts must be an integer between 1 and 3");
  }

  const validationHistory: CandidateValidationAttempt[] = [];
  let previousIssues: ValidationIssue[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = await options.generate({ attempt, previousIssues });
    const { parsed, result } = validateCandidate(
      candidate,
      options.schema,
      options.semanticValidator,
    );

    if (result.valid && parsed !== undefined) {
      validationHistory.push({
        attempt,
        outcome: "accepted",
        issues: [],
      });
      return {
        value: parsed,
        attempts: attempt,
        validationHistory,
      };
    }

    previousIssues = result.issues;
    validationHistory.push({
      attempt,
      outcome: "invalid_candidate",
      issues: result.issues,
    });
  }

  throw new StructuredCandidateBoundaryError(
    "retry_exhausted",
    validationHistory,
  );
}

export function compactValidationFeedback(issues: ValidationIssue[]) {
  return issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 20)
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`);
}

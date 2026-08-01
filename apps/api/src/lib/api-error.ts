import { ApiErrorResponseSchema } from "@project-architect/contracts";

export function apiError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return ApiErrorResponseSchema.parse({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

import { ApiErrorResponseSchema } from "@project-architect/contracts";

export async function getApiErrorMessage(
  response: Response,
  fallback: string,
) {
  try {
    const payload: unknown = await response.json();
    const parsed = ApiErrorResponseSchema.safeParse(payload);

    if (parsed.success) {
      return parsed.data.error.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

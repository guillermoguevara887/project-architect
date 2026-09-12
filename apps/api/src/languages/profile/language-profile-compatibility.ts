import { z } from "zod";
import { languageProfileSchema, type LanguageProfile } from "./language-profile.js";
import {
  LANGUAGE_PROFILE_V2_SCHEMA_VERSION,
  languageProfileV2Schema,
  type LanguageProfileV2,
} from "./language-profile-v2.js";

// Explicit names for new callers; historical imports and parsers remain unchanged.
export const languageProfileV1Schema = languageProfileSchema;
export type LanguageProfileV1 = LanguageProfile;

export type ParsedLanguageProfile =
  | { contract: "v1"; profile: LanguageProfileV1 }
  | { contract: "v2"; profile: LanguageProfileV2 };

/** No conversion or evidence promotion. Legacy payloads have no schemaVersion. */
export function parseLanguageProfileByVersion(input: unknown): ParsedLanguageProfile {
  const boundary = z.object({ schemaVersion: z.literal(LANGUAGE_PROFILE_V2_SCHEMA_VERSION).optional() }).passthrough().parse(input);
  if (Object.prototype.hasOwnProperty.call(boundary, "schemaVersion")) {
    return { contract: "v2", profile: languageProfileV2Schema.parse(input) };
  }
  return { contract: "v1", profile: languageProfileV1Schema.parse(input) };
}

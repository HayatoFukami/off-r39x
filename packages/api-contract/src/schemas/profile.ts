import { z } from "zod";
import { isoUtcTimestampSchema, lowerCaseUuidSchema } from "./common.ts";

export const principalNavigationSchema = z.strictObject({
  profile_ref: lowerCaseUuidSchema,
  capabilities: z.array(z.string()),
  has_staff_role: z.boolean(),
  has_administrator_role: z.boolean(),
});
export type PrincipalNavigation = z.infer<typeof principalNavigationSchema>;

/** API-AUTH-002 response (and the API-AUTH-004 response, which has the same shape). */
export const currentProfileSchema = z.strictObject({
  profile_ref: lowerCaseUuidSchema,
  display_name: z.string().nullable(),
  updated_at: isoUtcTimestampSchema,
});
export type CurrentProfile = z.infer<typeof currentProfileSchema>;

/** API-AUTH-003 body: `{}` only (SPEC-110 §25). Every field, including `auth_subject`, is refused. */
export const provisionCurrentProfileRequestSchema = z.strictObject({});
export type ProvisionCurrentProfileRequest = z.infer<typeof provisionCurrentProfileRequestSchema>;

/** API-AUTH-004 body. Length and Cc rules belong to the domain (SPEC-030 §9.2). */
export const updateCurrentProfileRequestSchema = z.strictObject({
  display_name: z.string().nullable(),
});
export type UpdateCurrentProfileRequest = z.infer<typeof updateCurrentProfileRequestSchema>;

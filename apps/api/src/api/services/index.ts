// SPEC-110 §14 / SPEC-190 §15: entry point for the business processing that route handlers call
// inside the API process (application services).
// It must not import hono, routes/, middleware/ or respond.ts (DEV-DEP-001). Business decisions belong to
// packages/domain and use-case contracts to packages/application.
export { type ConstraintTable, resolveConstraintViolation } from "./constraint-violation.ts";
export type { RejectionCode, ServiceResult, TemporaryCode } from "./result.ts";
export {
  type CurrentProfileStore,
  type ProfileRecord,
  type ReadCurrentProfileResult,
  readCurrentProfile,
  type UpdateCurrentProfileResult,
  updateCurrentProfile,
} from "./self-profile.ts";

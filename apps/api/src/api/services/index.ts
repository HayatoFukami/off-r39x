// SPEC-110 §14 / SPEC-190 §15: entry point for the business processing that route handlers call
// inside the API process (application services).
// It must not import hono, routes/ or middleware/ (DEV-DEP-001). Business decisions belong to
// packages/domain and use-case contracts to packages/application.
export {
  type CurrentProfileStore,
  type ProfileRecord,
  type ReadCurrentProfileResult,
  readCurrentProfile,
  type UpdateCurrentProfileResult,
  updateCurrentProfile,
} from "./self-profile.ts";

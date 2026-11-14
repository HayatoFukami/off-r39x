// SPEC-160 §19 / §24.1: the Actor Type and the Business Profile Public Reference of a log record.
// Before the Principal is resolved (or when it cannot be) the actor is GUEST with no reference; once
// it is resolved, the record carries the resolved Actor Type and the permitted Public Reference.
import type { LogEvent } from "@off-r39x/observability";
import type { Context } from "hono";
import type { ApiEnvironment } from "./failure.ts";

export function actorContext(c: Context<ApiEnvironment>): {
  actor_type: NonNullable<LogEvent["actor_type"]>;
  actor_ref?: string;
} {
  const principal = c.get("principal");
  return principal
    ? {
        actor_type: principal.roles.includes("ADMINISTRATOR")
          ? "ADMINISTRATOR"
          : principal.roles.includes("STAFF")
            ? "STAFF"
            : "AUTHENTICATED_USER",
        actor_ref: principal.profileRef,
      }
    : { actor_type: "GUEST" };
}

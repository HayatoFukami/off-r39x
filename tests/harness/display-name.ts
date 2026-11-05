import type { Profile } from "../../apps/web/src/api-client/types.ts";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";

// Test-only helpers for the Display name rule (SPEC-050 18.2, SPEC-030 9.2, API-AUTH-004). Never imported
// from production code.

export const profileCopy = (): typeof copy.mypage.profile => copy.mypage.profile;

/** A Profile whose display name may be unset (API-AUTH-002: display_name is null when unset). */
export const profileOf = (email: string, displayName: string | null): Profile => ({
  email,
  displayName,
});

/** `count` code points of an emoji (2 UTF-16 code units each). */
export const emojis = (count: number): string => "😀".repeat(count);

/** `count` code points built from base + combining mark pairs (count must be even). */
export const combining = (count: number): string => "が".repeat(count / 2);

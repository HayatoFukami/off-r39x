import { describe, expect, it } from "vitest";
import type { Profile, ProfileUpdate } from "../../../../apps/web/src/api-client/types.ts";
import {
  buildProfileModel,
  interpretProfileSave,
} from "../../../../apps/web/src/features/mypage/profile-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { createBackend, dbFingerprint, okData } from "../../../harness/mock-backend.ts";
import { EMAIL } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.8 (SPEC-050 18.2, 25, UCR-100-001, DEV-WEB-009).

describe("TC-PG-MYP-002-621 the Profile model never falls back to another Profile (SPEC-050 18.2 Failure)", () => {
  it("maps ok to ready with the email and the display name of the viewer", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const data = okData(await backend.api.self.getProfile());
    expect(buildProfileModel({ kind: "ok", data })).toEqual({
      kind: "ready",
      email: EMAIL.demo,
      displayName: "デモ太郎",
    });
  });

  it("maps loading to loading and every failed read, including not_found, to unavailable (no denied, no fallback)", () => {
    expect(buildProfileModel({ kind: "loading" })).toEqual({ kind: "loading" });
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildProfileModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("does not change its input", () => {
    const data: Profile = { email: "x@example.com", displayName: "名前" };
    const snapshot = JSON.stringify(data);
    buildProfileModel({ kind: "ok", data });
    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

describe("TC-PG-MYP-002-622 the save result becomes a distinct step per outcome (SPEC-050 18.2, 25)", () => {
  it("saved carries the value the server confirmed", () => {
    const result: ProfileUpdate = {
      kind: "saved",
      profile: { email: EMAIL.demo, displayName: "サーバー確定名" },
    };
    expect(interpretProfileSave(result)).toEqual({ kind: "saved", displayName: "サーバー確定名" });
  });

  it("validation_failed is the required-name message; unavailable is the failure message; the two never coincide", () => {
    const invalid = interpretProfileSave({ kind: "validation_failed", field: "displayName" });
    const failed = interpretProfileSave({ kind: "unavailable" });
    expect(invalid).toEqual({ kind: "invalid", message: copy.mypage.profile.error.required });
    expect(failed).toEqual({ kind: "failed", message: copy.mypage.profile.error.unavailable });
    expect(invalid).not.toEqual(failed);
    expect(copy.mypage.profile.error.required).not.toBe(copy.mypage.profile.error.unavailable);
  });

  it("works against the mock port: a blank name is rejected without a DB change, a real name is saved for this user only", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const before = dbFingerprint(backend);
    expect(
      interpretProfileSave(await backend.api.self.updateProfile({ displayName: "   " })),
    ).toEqual({
      kind: "invalid",
      message: copy.mypage.profile.error.required,
    });
    expect(dbFingerprint(backend)).toBe(before);
    expect(
      interpretProfileSave(await backend.api.self.updateProfile({ displayName: "新しい名前" })),
    ).toEqual({
      kind: "saved",
      displayName: "新しい名前",
    });
    expect(okData(await backend.api.self.getProfile()).displayName).toBe("新しい名前");
    await backend.signOut();
    await backend.signInAs(EMAIL.other);
    expect(okData(await backend.api.self.getProfile()).displayName).toBe("他の人");
  });
});

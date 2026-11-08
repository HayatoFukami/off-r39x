import { describe, expect, it } from "vitest";
import type { Profile, ProfileUpdate } from "../../../../apps/web/src/api-client/types.ts";
import {
  buildProfileModel,
  checkDisplayNameInput,
  interpretProfileSave,
  resolveInputAfterSave,
} from "../../../../apps/web/src/features/mypage/profile-model.ts";
import { combining, emojis, profileCopy, profileOf } from "../../../harness/display-name.ts";
import { createBackend, dbFingerprint, okData } from "../../../harness/mock-backend.ts";
import { EMAIL } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.8 (SPEC-050 18.2, 25, SPEC-030 9.2, API-AUTH-004, DEV-WEB-009).

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

  it("keeps an unset display name as null (never a string, never the email)", () => {
    const data = profileOf(EMAIL.demo, null);
    expect(buildProfileModel({ kind: "ok", data })).toEqual({
      kind: "ready",
      email: EMAIL.demo,
      displayName: null,
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

describe("TC-PG-MYP-002-622 the save result becomes a distinct step per outcome (SPEC-050 18.2, 25, SPEC-030 9.2, API-AUTH-004)", () => {
  it("saved carries the value the server confirmed", () => {
    const result: ProfileUpdate = {
      kind: "saved",
      profile: { email: EMAIL.demo, displayName: "サーバー確定名" },
    };
    expect(interpretProfileSave(result)).toEqual({ kind: "saved", displayName: "サーバー確定名" });
  });

  it("saved carries null when the server cleared the name (unset)", () => {
    const result: ProfileUpdate = { kind: "saved", profile: profileOf(EMAIL.demo, null) };
    expect(interpretProfileSave(result)).toEqual({ kind: "saved", displayName: null });
  });

  it("validation_failed is the generic invalid message; unavailable is the failure message; the two never coincide", () => {
    const invalid = interpretProfileSave({ kind: "validation_failed", field: "displayName" });
    const failed = interpretProfileSave({ kind: "unavailable" });
    expect(invalid).toEqual({ kind: "invalid", message: profileCopy().error.invalid });
    expect(failed).toEqual({ kind: "failed", message: profileCopy().error.unavailable });
    expect(invalid).not.toEqual(failed);
    expect(profileCopy().error.invalid).not.toBe(profileCopy().error.unavailable);
  });

  it("works against the mock port: an 81-code-point name is rejected without a DB change, a blank clears to null, a real name is saved for this user only", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const before = dbFingerprint(backend);
    expect(
      interpretProfileSave(await backend.api.self.updateProfile({ displayName: emojis(81) })),
    ).toEqual({
      kind: "invalid",
      message: profileCopy().error.invalid,
    });
    expect(dbFingerprint(backend)).toBe(before);
    expect(
      interpretProfileSave(await backend.api.self.updateProfile({ displayName: "   " })),
    ).toEqual({
      kind: "saved",
      displayName: null,
    });
    expect(okData(await backend.api.self.getProfile()).displayName).toBeNull();
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

describe("TC-PG-MYP-002-623 the input after a save keeps what the user typed meanwhile (SPEC-050 18.2, DEV-WEB-009)", () => {
  it("takes the server value when the input still equals the submitted value", () => {
    expect(
      resolveInputAfterSave({
        current: "新しい名前",
        submitted: "新しい名前",
        saved: "新しい名前",
      }),
    ).toBe("新しい名前");
  });

  it("takes the server-normalized value when the input is unchanged since the submit", () => {
    expect(resolveInputAfterSave({ current: " A ", submitted: " A ", saved: "A" })).toBe("A");
  });

  it("keeps the current input when it was edited after the submit (the newer edit is never overwritten)", () => {
    expect(
      resolveInputAfterSave({
        current: "新しい名前2",
        submitted: "新しい名前",
        saved: "新しい名前",
      }),
    ).toBe("新しい名前2");
    expect(resolveInputAfterSave({ current: " A b", submitted: " A ", saved: "A" })).toBe(" A b");
  });

  it("takes an empty input when the server cleared the name (saved null) and the input is unchanged", () => {
    expect(resolveInputAfterSave({ current: "", submitted: "", saved: null })).toBe("");
    expect(resolveInputAfterSave({ current: "　 ", submitted: "　 ", saved: null })).toBe("");
  });

  it("keeps what was typed after the submit even when the server cleared the name", () => {
    expect(resolveInputAfterSave({ current: "打ち直し", submitted: " ", saved: null })).toBe(
      "打ち直し",
    );
  });

  it("keeps an emptied input as empty", () => {
    expect(
      resolveInputAfterSave({ current: "", submitted: "新しい名前", saved: "新しい名前" }),
    ).toBe("");
  });
});

describe("TC-PG-MYP-002-624 the UI pre-check of the display name is UX only: 80 code points and no Cc (SPEC-050 18.2, SPEC-030 9.2)", () => {
  it.each([
    ["an empty input", ""],
    ["spaces only", "   "],
    ["ideographic spaces and a tab only", "　\t　"],
    ["an ordinary name", "山田 太郎"],
    ["80 ASCII characters", "a".repeat(80)],
    ["80 emoji (160 UTF-16 code units)", emojis(80)],
    ["80 code points with combining marks", combining(80)],
    ["80 code points surrounded by spaces", `  ${"a".repeat(80)}  `],
  ])("accepts %s (ok)", (_label, value) => {
    expect(checkDisplayNameInput(value)).toEqual({ kind: "ok" });
  });

  it.each([
    ["81 ASCII characters", "a".repeat(81)],
    ["81 emoji", emojis(81)],
    ["81 code points with combining marks", `${combining(80)}か`],
  ])("rejects %s with the too-long message", (_label, value) => {
    expect(checkDisplayNameInput(value)).toEqual({
      kind: "invalid",
      message: profileCopy().error.tooLong,
    });
  });

  it.each([
    ["a tab inside", "名\t前"],
    ["a NUL inside", "名\u0000前"],
    ["a NUL at the start", "\u0000名前"],
    ["DEL at the end", "名前\u007F"],
    ["NEL (U+0085) at the end", "名前\u0085"],
    ["a line feed inside", "名\n前"],
  ])("rejects %s with the control-character message", (_label, value) => {
    expect(checkDisplayNameInput(value)).toEqual({
      kind: "invalid",
      message: profileCopy().error.controlCharacter,
    });
  });

  it("reports the control character when the value is also too long (fixed order)", () => {
    expect(checkDisplayNameInput(`${"a".repeat(90)}\u0000`)).toEqual({
      kind: "invalid",
      message: profileCopy().error.controlCharacter,
    });
  });

  it("the two messages are distinct from each other and from the server-side invalid message", () => {
    const { tooLong, controlCharacter, invalid } = profileCopy().error;
    expect(new Set([tooLong, controlCharacter, invalid]).size).toBe(3);
  });

  it("does not change its input and never trims it (the value goes to the port as typed)", () => {
    const value = "  名前  ";
    checkDisplayNameInput(value);
    expect(value).toBe("  名前  ");
  });
});

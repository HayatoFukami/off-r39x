import { describe, expect, it } from "vitest";
import {
  type FieldError,
  fieldErrorMessage,
  normalizeEmail,
  validateLoginForm,
  validateRegisterForm,
  validateResetCompleteForm,
  validateResetRequestForm,
} from "../../../../apps/web/src/features/auth/form-validation.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";

// U13 (tests/contracts/s6-auth.md section 4). SPEC-140 SEC-AUTH-016 / 017, SPEC-050 15.1 / 15.3 / 15.4 / 15.5, 25.
// Synthetic values only.

const EMAIL = "demo@example.com";
const pw = (n: number): string => "a".repeat(n);
const errorsOf = (r: ReturnType<typeof validateLoginForm>): readonly FieldError[] =>
  r.ok ? [] : r.errors;

describe("TC-PG-AUTH-001-201 registration password length 12..128 without trimming (SEC-AUTH-016 / 017, U13)", () => {
  const register = (password: string, passwordConfirm = password) =>
    validateRegisterForm({ email: EMAIL, password, passwordConfirm });

  it.each([
    [11, { ok: false, errors: [{ field: "password", code: "too_short" }] }],
    [12, { ok: true }],
    [13, { ok: true }],
    [127, { ok: true }],
    [128, { ok: true }],
    [129, { ok: false, errors: [{ field: "password", code: "too_long" }] }],
  ])("%d characters -> %j", (length, expected) => {
    expect(register(pw(length))).toEqual(expected);
  });

  it("an empty password is required, not too_short", () => {
    expect(register("")).toEqual({ ok: false, errors: [{ field: "password", code: "required" }] });
  });

  it("does not trim: surrounding whitespace counts toward the length", () => {
    expect(register(`  ${pw(8)}  `)).toEqual({ ok: true }); // 12 incl. spaces; 8 if trimmed
    expect(register(`  ${pw(7)}  `)).toEqual({
      ok: false,
      errors: [{ field: "password", code: "too_short" }],
    }); // 11 incl. spaces
    expect(register(" ".repeat(12))).toEqual({ ok: true });
    expect(register(`${pw(126)}  `)).toEqual({ ok: true }); // 128
    expect(register(`${pw(127)}  `)).toEqual({
      ok: false,
      errors: [{ field: "password", code: "too_long" }],
    }); // 129 incl. spaces
  });

  it("counts Unicode code points and adds no composition rule", () => {
    expect(register("あ".repeat(12))).toEqual({ ok: true });
    expect(register("\u{1F600}".repeat(12))).toEqual({ ok: true });
    expect(register("\u{1F600}".repeat(11)).ok).toBe(false);
    expect(register("\u{1F600}".repeat(129)).ok).toBe(false);
    for (const single of ["aaaaaaaaaaaa", "111111111111", "ABCDEFGHIJKL", "............"]) {
      expect(register(single)).toEqual({ ok: true });
    }
  });
});

describe("TC-PG-AUTH-005-201 reset-completion uses the same password rule (SEC-AUTH-016, U13)", () => {
  it.each([
    [11, false],
    [12, true],
    [128, true],
    [129, false],
  ])("%d characters -> ok=%s", (length, ok) => {
    expect(
      validateResetCompleteForm({ password: pw(length), passwordConfirm: pw(length) }).ok,
    ).toBe(ok);
  });

  it("reports required / too_short / too_long on the password field only", () => {
    expect(validateResetCompleteForm({ password: "", passwordConfirm: "" })).toEqual({
      ok: false,
      errors: [{ field: "password", code: "required" }],
    });
    expect(validateResetCompleteForm({ password: pw(3), passwordConfirm: pw(3) })).toEqual({
      ok: false,
      errors: [{ field: "password", code: "too_short" }],
    });
    expect(validateResetCompleteForm({ password: pw(200), passwordConfirm: pw(200) })).toEqual({
      ok: false,
      errors: [{ field: "password", code: "too_long" }],
    });
  });

  it("requires the confirmation to match exactly (no trim, case-sensitive)", () => {
    expect(validateResetCompleteForm({ password: pw(12), passwordConfirm: `${pw(12)} ` })).toEqual({
      ok: false,
      errors: [{ field: "passwordConfirm", code: "mismatch" }],
    });
    expect(
      validateResetCompleteForm({ password: pw(12), passwordConfirm: "A".repeat(12) }),
    ).toEqual({
      ok: false,
      errors: [{ field: "passwordConfirm", code: "mismatch" }],
    });
    expect(validateResetCompleteForm({ password: pw(12), passwordConfirm: "" })).toEqual({
      ok: false,
      errors: [{ field: "passwordConfirm", code: "mismatch" }],
    });
  });
});

describe("TC-PG-AUTH-001-202 registration email and confirmation (SPEC-050 15.1, U13)", () => {
  it("validates the email after trimming only its surrounding whitespace", () => {
    expect(normalizeEmail("  demo@example.com \n")).toBe("demo@example.com");
    expect(
      validateRegisterForm({ email: ` ${EMAIL} `, password: pw(12), passwordConfirm: pw(12) }),
    ).toEqual({ ok: true });
  });

  it.each([
    ["", "required"],
    ["   ", "required"],
    ["plain", "invalid_format"],
    ["@example.com", "invalid_format"],
    ["demo@", "invalid_format"],
    ["de mo@example.com", "invalid_format"],
    ["a@@example.com", "invalid_format"],
  ])("email %j -> %s", (email, code) => {
    expect(validateRegisterForm({ email, password: pw(12), passwordConfirm: pw(12) })).toEqual({
      ok: false,
      errors: [{ field: "email", code }],
    });
  });

  it("reports a confirmation mismatch, and nothing for the confirmation when both are empty", () => {
    expect(
      validateRegisterForm({ email: EMAIL, password: pw(12), passwordConfirm: pw(13) }),
    ).toEqual({ ok: false, errors: [{ field: "passwordConfirm", code: "mismatch" }] });
    expect(validateRegisterForm({ email: EMAIL, password: "", passwordConfirm: "" })).toEqual({
      ok: false,
      errors: [{ field: "password", code: "required" }],
    });
  });

  it("lists errors in field order, one per field", () => {
    const r = validateRegisterForm({ email: "", password: pw(3), passwordConfirm: pw(4) });
    expect(r).toEqual({
      ok: false,
      errors: [
        { field: "email", code: "required" },
        { field: "password", code: "too_short" },
        { field: "passwordConfirm", code: "mismatch" },
      ],
    });
  });
});

describe("TC-PG-AUTH-003-201 login does not enforce the length rule (SEC-AUTH-016: new passwords only, U13)", () => {
  it("accepts any non-empty password, including very short and very long ones", () => {
    for (const password of ["x", pw(3), pw(11), pw(129), pw(1000), " ", "\t"]) {
      expect(validateLoginForm({ email: EMAIL, password }), JSON.stringify(password)).toEqual({
        ok: true,
      });
    }
  });

  it("requires both fields and reports them in order", () => {
    expect(validateLoginForm({ email: "", password: "" })).toEqual({
      ok: false,
      errors: [
        { field: "email", code: "required" },
        { field: "password", code: "required" },
      ],
    });
    expect(errorsOf(validateLoginForm({ email: "nope", password: "x" }))).toEqual([
      { field: "email", code: "invalid_format" },
    ]);
  });
});

describe("TC-PG-AUTH-004-201 reset request validates the email only (SPEC-050 15.4, U13)", () => {
  it("accepts a well-formed email and rejects empty / malformed ones", () => {
    expect(validateResetRequestForm({ email: EMAIL })).toEqual({ ok: true });
    expect(validateResetRequestForm({ email: "" })).toEqual({
      ok: false,
      errors: [{ field: "email", code: "required" }],
    });
    expect(validateResetRequestForm({ email: "nope" })).toEqual({
      ok: false,
      errors: [{ field: "email", code: "invalid_format" }],
    });
  });
});

describe("TC-PG-AUTH-001-203 fieldErrorMessage maps each error to its own copy (SPEC-050 25, U13)", () => {
  it("returns the contracted copy strings", () => {
    const cases: ReadonlyArray<readonly [FieldError, string]> = [
      [{ field: "email", code: "required" }, copy.auth.field.email.required],
      [{ field: "email", code: "invalid_format" }, copy.auth.field.email.invalidFormat],
      [{ field: "password", code: "required" }, copy.auth.field.password.required],
      [{ field: "password", code: "too_short" }, copy.auth.field.password.tooShort],
      [{ field: "password", code: "too_long" }, copy.auth.field.password.tooLong],
      [{ field: "passwordConfirm", code: "mismatch" }, copy.auth.field.passwordConfirm.mismatch],
    ];
    for (const [error, expected] of cases) {
      expect(fieldErrorMessage(error)).toBe(expected);
    }
    expect(new Set(cases.map(([, text]) => text)).size).toBe(cases.length);
  });

  it("rejects a combination that cannot occur", () => {
    expect(() => fieldErrorMessage({ field: "email", code: "mismatch" })).toThrow(RangeError);
    expect(() => fieldErrorMessage({ field: "passwordConfirm", code: "required" })).toThrow(
      RangeError,
    );
  });
});

describe("TC-PG-AUTH-001-204 validators do not mutate or echo their input (SEC-AUTH-018, U13)", () => {
  it("never puts the password into an error", () => {
    const secret = "Sentinel-Pass-Phrase-9876";
    const result = validateRegisterForm({
      email: "",
      password: secret,
      passwordConfirm: `${secret}x`,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

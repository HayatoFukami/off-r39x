import { validatePassword } from "../../auth/password-policy";
import { copy } from "../../presentation/copy/ja";

// Client-side form checks run before the AuthPort is called. A password is never trimmed or
// normalized (SEC-AUTH-016) and no composition rule is added (SEC-AUTH-017).

export type FieldName = "email" | "password" | "passwordConfirm";
export type FieldErrorCode = "required" | "invalid_format" | "too_short" | "too_long" | "mismatch";
export type FieldError = { readonly field: FieldName; readonly code: FieldErrorCode };
export type FormValidation = { ok: true } | { ok: false; errors: readonly FieldError[] };

const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+$/;

export const normalizeEmail = (raw: string): string => raw.trim();

function emailError(raw: string): FieldError | null {
  const email = normalizeEmail(raw);
  if (email === "") return { field: "email", code: "required" };
  if (!EMAIL_FORMAT.test(email)) return { field: "email", code: "invalid_format" };
  return null;
}

/** Login does not check the length of an existing password. */
function existingPasswordError(password: string): FieldError | null {
  return password === "" ? { field: "password", code: "required" } : null;
}

function newPasswordError(password: string): FieldError | null {
  if (password === "") return { field: "password", code: "required" };
  const result = validatePassword(password);
  return result.ok ? null : { field: "password", code: result.reason };
}

function confirmError(password: string, passwordConfirm: string): FieldError | null {
  if (password === "" && passwordConfirm === "") return null;
  return passwordConfirm === password ? null : { field: "passwordConfirm", code: "mismatch" };
}

function result(errors: readonly (FieldError | null)[]): FormValidation {
  const found = errors.filter((error): error is FieldError => error !== null);
  return found.length === 0 ? { ok: true } : { ok: false, errors: found };
}

export function validateLoginForm(i: { email: string; password: string }): FormValidation {
  return result([emailError(i.email), existingPasswordError(i.password)]);
}

export function validateRegisterForm(i: {
  email: string;
  password: string;
  passwordConfirm: string;
}): FormValidation {
  return result([
    emailError(i.email),
    newPasswordError(i.password),
    confirmError(i.password, i.passwordConfirm),
  ]);
}

export function validateResetRequestForm(i: { email: string }): FormValidation {
  return result([emailError(i.email)]);
}

export function validateResetCompleteForm(i: {
  password: string;
  passwordConfirm: string;
}): FormValidation {
  return result([newPasswordError(i.password), confirmError(i.password, i.passwordConfirm)]);
}

export function fieldErrorMessage(error: FieldError): string {
  const { field, code } = error;
  if (field === "email" && code === "required") return copy.auth.field.email.required;
  if (field === "email" && code === "invalid_format") return copy.auth.field.email.invalidFormat;
  if (field === "password" && code === "required") return copy.auth.field.password.required;
  if (field === "password" && code === "too_short") return copy.auth.field.password.tooShort;
  if (field === "password" && code === "too_long") return copy.auth.field.password.tooLong;
  if (field === "passwordConfirm" && code === "mismatch") {
    return copy.auth.field.passwordConfirm.mismatch;
  }
  throw new RangeError(`Unsupported field error: ${field}/${code}`);
}

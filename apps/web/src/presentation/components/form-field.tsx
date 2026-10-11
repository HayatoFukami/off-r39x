import type { ChangeEvent } from "react";
import { Input } from "./ui/input";

/**
 * A labelled text input. An error is shown as text and tied to the input with aria-invalid and
 * aria-describedby (SPEC-050 25); the hint stays tied to it too.
 */
export function FormField({
  id,
  label,
  type,
  autoComplete,
  value,
  onChange,
  hint,
  error,
}: {
  id: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== null;
  const describedBy = [hint !== undefined ? hintId : null, hasError ? errorId : null]
    .filter((part): part is string => part !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint !== undefined ? (
        <p id={hintId} className="text-sm text-foreground/80">
          {hint}
        </p>
      ) : null}
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        className="w-full"
      />
      {hasError ? (
        <p id={errorId} className="text-sm text-tone-failure-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

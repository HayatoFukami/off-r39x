"use client";

import { useId } from "react";
import { AUTH_METHODS, type AuthMethod, authMethodLabel } from "./auth-methods";

/**
 * The method choice of PG-AUTH-001 / 003 as a native radio group. Choosing a method only changes the
 * value: it moves no focus and starts no navigation (SPEC-050 15.0).
 */
export function MethodSelector({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  value: AuthMethod;
  onChange: (method: AuthMethod) => void;
  disabled?: boolean;
}) {
  const baseId = useId();
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      {AUTH_METHODS.map((method) => {
        const id = `${baseId}-${method}`;
        return (
          <div key={method} className="flex items-center gap-2">
            <input
              id={id}
              type="radio"
              name={baseId}
              checked={value === method}
              onChange={() => onChange(method)}
            />
            <label htmlFor={id} className="text-sm">
              {authMethodLabel(method)}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

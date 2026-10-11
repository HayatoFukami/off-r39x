import type { Ref } from "react";
import { copy } from "../copy/ja";

export type ErrorSummaryItem = { readonly fieldId: string; readonly message: string };

/**
 * Summary of form errors with a link to each field (SPEC-050 25). It is the only alert of a form
 * with input errors; the container moves focus to it after a failed submit.
 */
export function ErrorSummary({
  items,
  summaryRef,
}: {
  items: readonly ErrorSummaryItem[];
  summaryRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg outline-none"
    >
      <p className="font-bold">{copy.auth.form.errorSummaryTitle}</p>
      <ul className="list-disc pl-5">
        {items.map((item) => (
          <li key={`${item.fieldId}-${item.message}`}>
            <a
              href={`#${item.fieldId}`}
              className="underline underline-offset-4"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(item.fieldId)?.focus();
              }}
            >
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

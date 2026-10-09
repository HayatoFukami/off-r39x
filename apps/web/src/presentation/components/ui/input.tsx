import type { ComponentProps } from "react";
import { cn } from "./cn";

// Visual values come from the @theme tokens in app/globals.css (SPEC-050 24.3).
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "min-h-9 w-24 rounded-base border border-border bg-background px-2 py-1 text-foreground disabled:opacity-50 aria-[invalid=true]:border-tone-failure-fg",
        className,
      )}
      {...props}
    />
  );
}

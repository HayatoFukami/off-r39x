import type { ReactNode } from "react";
import { copy } from "../copy/ja";
import { Button } from "./ui/button";

// Loading, empty and unavailable look different and read differently (SPEC-050 9, 21).
// Loading never shows a business result; unavailable names the failed subject and only re-reads.

export type PageStateProps =
  | { state: "loading" }
  | { state: "empty"; message?: ReactNode }
  | { state: "unavailable"; message: string; retryLabel?: string; onRetry: () => void };

export function PageState(props: PageStateProps) {
  switch (props.state) {
    case "loading":
      return (
        <p role="status" className="text-sm text-foreground/80">
          {copy.pageState.loading}
        </p>
      );
    case "empty":
      return <p className="text-sm text-foreground/80">{props.message ?? copy.pageState.empty}</p>;
    case "unavailable":
      return (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
        >
          <p>{props.message}</p>
          <Button type="button" variant="outline" onClick={props.onRetry}>
            {props.retryLabel ?? copy.pageState.retry}
          </Button>
        </div>
      );
    default: {
      const unreachable: never = props;
      return unreachable;
    }
  }
}

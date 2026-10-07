"use client";

import Link from "next/link";
import { HOME_HREF } from "../src/config/site";
import { Button } from "../src/presentation/components/ui/button";
import { copy } from "../src/presentation/copy/ja";

// SEC-WEB-012: the error object is never rendered or logged; only fixed wording is shown.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{copy.errorPage.title}</h1>
      <p>{copy.errorPage.description}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => reset()}>
          {copy.errorPage.retry}
        </Button>
        <Link href={HOME_HREF} className="text-brand underline underline-offset-4">
          {copy.errorPage.homeLink}
        </Link>
      </div>
    </div>
  );
}

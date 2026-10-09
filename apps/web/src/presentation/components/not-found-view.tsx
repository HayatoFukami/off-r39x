import Link from "next/link";
import { HOME_HREF } from "../../config/site";
import { copy } from "../copy/ja";

// Same view as app/not-found.tsx (PG-XFN-002): shows nothing about the requested resource (SPEC-050 19.1).

export function NotFoundView() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{copy.notFound.title}</h1>
      <p>{copy.notFound.description}</p>
      <p>
        <Link href={HOME_HREF} className="text-brand underline underline-offset-4">
          {copy.notFound.homeLink}
        </Link>
      </p>
    </div>
  );
}

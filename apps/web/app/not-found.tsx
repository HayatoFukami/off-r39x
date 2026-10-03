import Link from "next/link";
import { HOME_HREF } from "../src/config/site";
import { copy } from "../src/presentation/copy/ja";

// PG-XFN-002: shows nothing about the requested path or the framework (SPEC-050 19.1).
export default function NotFound() {
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

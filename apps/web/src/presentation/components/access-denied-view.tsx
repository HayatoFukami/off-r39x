import Link from "next/link";
import { copy } from "../copy/ja";

// PG-XFN-003 part (SPEC-050 19.2). It shows nothing about the target: not its content, its existence,
// its owner or its state. A retry cannot grant access, so there is no retry control.

const linkClass = "text-brand underline underline-offset-4";

export function AccessDeniedView({ listHref, listLabel }: { listHref: string; listLabel: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{copy.accessDenied.title}</h1>
      <p>{copy.accessDenied.description}</p>
      <p className="flex flex-wrap gap-4">
        <Link href="/mypage" prefetch={false} className={linkClass}>
          {copy.accessDenied.mypageLink}
        </Link>
        <Link href={listHref} prefetch={false} className={linkClass}>
          {listLabel}
        </Link>
      </p>
    </div>
  );
}

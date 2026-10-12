"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { currentNavKey, MYPAGE_NAV_KEYS, MYPAGE_PATHS } from "../../config/mypage-routes";
import { Button } from "../../presentation/components/ui/button";
import { cn } from "../../presentation/components/ui/cn";
import { copy } from "../../presentation/copy/ja";

// Mypage local navigation (SPEC-050 17.2, 24.1, 25). A landmark with six links and no list markup.
// Desktop shows it permanently; Mobile hides it behind a disclosure that reports its state.

export function MypageNav() {
  const pathname = usePathname();
  const navId = useId();
  const [open, setOpen] = useState(false);
  const current = currentNavKey(pathname);

  // The menu closes after a link was followed (the layout stays mounted across Mypage pages).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of the pathname is the trigger.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="mb-4 flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-fit md:hidden"
        aria-expanded={open}
        aria-controls={navId}
        onClick={() => setOpen((value) => !value)}
      >
        {copy.mypage.nav.toggle}
      </Button>
      <nav
        id={navId}
        aria-label={copy.mypage.nav.label}
        className={cn(
          "flex-col gap-1 md:flex md:flex-row md:flex-wrap md:gap-4",
          open ? "flex" : "hidden",
        )}
      >
        {MYPAGE_NAV_KEYS.map((key) => (
          <Link
            key={key}
            href={MYPAGE_PATHS[key]}
            prefetch={false}
            aria-current={current === key ? "page" : undefined}
            className={cn(
              "rounded-base px-2 py-1 text-brand underline-offset-4 hover:underline",
              current === key ? "font-bold underline" : "",
            )}
          >
            {copy.mypage.nav.items[key]}
          </Link>
        ))}
      </nav>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { GUEST_ACCOUNT_LINKS, PRIMARY_NAV } from "../../config/site";
import { Button } from "../components/ui/button";
import { copy } from "../copy/ja";
import { PrimaryNav } from "./primary-nav";

type Props = { currentPath: string; showRegister: boolean };

const REGISTER = GUEST_ACCOUNT_LINKS.find((link) => link.key === "register");

/**
 * Disclosure menu of the primary navigation Links (SPEC-050 8.5, 25), on every viewport. Not a Dialog: no focus
 * trap. CTA, Cart and Login / Mypage stay outside it, in the Header. The panel is positioned against the sticky
 * Header so it never leaves the viewport horizontally.
 */
export function HeaderMenu({ currentPath, showRegister }: Props) {
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(currentPath);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A route change closes the menu (the layout is not remounted on navigation).
  if (lastPath !== currentPath) {
    setLastPath(currentPath);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {copy.layout.menu.button}
      </Button>
      {open ? (
        <PrimaryNav
          id={menuId}
          className="absolute top-full left-3 z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-base border border-border bg-background p-2 shadow-lg"
          items={PRIMARY_NAV.filter((item) => item.collapsible)}
          label={copy.layout.nav.primaryLabel}
          currentPath={currentPath}
          orientation="column"
          onNavigate={() => setOpen(false)}
          extraItems={
            showRegister && REGISTER !== undefined ? (
              <li className="min-[768px]:hidden">
                <Link
                  prefetch={false}
                  href={REGISTER.href}
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-9 items-center rounded-base px-2 text-sm hover:bg-muted"
                >
                  {copy.layout.account.register}
                </Link>
              </li>
            ) : null
          }
        />
      ) : null}
    </div>
  );
}

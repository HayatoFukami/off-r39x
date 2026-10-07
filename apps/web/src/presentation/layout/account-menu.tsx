"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ACCOUNT_MENU_ITEMS } from "../../config/site";
import { Button } from "../components/ui/button";
import { copy } from "../copy/ja";

/** Disclosure menu of the Mypage destinations plus Logout (a button, not a Link). */
export function AccountMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
    <div ref={rootRef} className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {copy.layout.account.menuButton}
      </Button>
      {open ? (
        <nav
          id={menuId}
          aria-label={copy.layout.account.menuLabel}
          className="absolute right-0 z-50 mt-1 w-56 rounded-base border border-border bg-background p-2 shadow-lg"
        >
          <ul className="flex flex-col gap-1">
            {ACCOUNT_MENU_ITEMS.map((item) => (
              <li key={item.key}>
                <Link
                  prefetch={false}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-9 items-center rounded-base px-2 text-sm hover:bg-muted"
                >
                  {copy.layout.account[item.key]}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
                className="flex min-h-9 w-full items-center rounded-base px-2 text-left text-sm hover:bg-muted"
              >
                {copy.layout.account.logout}
              </button>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

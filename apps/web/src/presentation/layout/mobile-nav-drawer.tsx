"use client";

import Link from "next/link";
import { useState } from "react";
import { GUEST_ACCOUNT_LINKS, PRIMARY_NAV } from "../../config/site";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { copy } from "../copy/ja";
import { PrimaryNav } from "./primary-nav";

type Props = { currentPath: string; showRegister: boolean };

const REGISTER = GUEST_ACCOUNT_LINKS.find((link) => link.key === "register");

/** Navigation drawer below md. CTA, Cart and Login / Mypage stay outside it, in the Header. */
export function MobileNavDrawer({ currentPath, showRegister }: Props) {
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(currentPath);
  // A route change closes the drawer (the layout is not remounted on navigation).
  if (lastPath !== currentPath) {
    setLastPath(currentPath);
    setOpen(false);
  }
  const close = (): void => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="md:hidden" />}
        type="button"
      >
        {copy.layout.drawer.open}
      </DialogTrigger>
      <DialogContent side="left">
        <div className="flex items-center justify-between gap-2">
          <DialogTitle>{copy.layout.drawer.title}</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="sm" />} type="button">
            {copy.layout.drawer.close}
          </DialogClose>
        </div>
        <PrimaryNav
          items={PRIMARY_NAV.filter((item) => item.collapsible)}
          label={copy.layout.nav.primaryLabel}
          currentPath={currentPath}
          orientation="column"
          onNavigate={close}
        />
        {showRegister && REGISTER !== undefined ? (
          <Link
            prefetch={false}
            href={REGISTER.href}
            onClick={close}
            className="inline-flex min-h-9 items-center rounded-base px-2 text-sm hover:bg-muted"
          >
            {copy.layout.account.register}
          </Link>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { KeyboardEvent } from "react";
import { cn } from "./cn";

// Thin wrappers over the Base UI Dialog: focus trap, Escape and focus return come from it.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Wraps Tab / Shift+Tab inside the popup synchronously, so focus never lands outside it.
function wrapTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />;
}

export function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: Omit<DialogPrimitive.Title.Props, "className"> & { className?: string }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  );
}

type PopupProps = Omit<DialogPrimitive.Popup.Props, "className"> & { className?: string } & {
  side?: "left" | "right" | "center";
};

export function DialogContent({ className, children, side = "center", ...props }: PopupProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-overlay"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        aria-modal="true"
        onKeyDown={wrapTab}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-background p-4 text-foreground shadow-lg outline-none",
          side === "center" &&
            "top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-base",
          side === "left" && "inset-y-0 left-0 h-full w-72 max-w-[85vw] overflow-y-auto",
          side === "right" && "inset-y-0 right-0 h-full w-72 max-w-[85vw] overflow-y-auto",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type { PrimaryNavItem } from "../../config/site";
import { cn } from "../components/ui/cn";
import { copy } from "../copy/ja";

type Props = {
  items: readonly PrimaryNavItem[];
  label: string;
  currentPath: string;
  orientation?: "row" | "column";
  className?: string;
  id?: string;
  onNavigate?: () => void;
  /** Extra list items after the navigation Links (for example a Link only some visitors need). */
  extraItems?: ReactNode;
};

function isCurrent(currentPath: string, href: string): boolean {
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** A named navigation landmark of Links (navigation is a Link, never a button: SPEC-050 25). */
export function PrimaryNav({
  items,
  label,
  currentPath,
  orientation = "row",
  className,
  id,
  onNavigate,
  extraItems,
}: Props) {
  return (
    <nav id={id} aria-label={label} className={className}>
      <ul className={cn("flex flex-wrap gap-1", orientation === "column" && "flex-col")}>
        {items.map((item) => (
          <li key={item.key}>
            <Link
              prefetch={false}
              href={item.href}
              aria-current={isCurrent(currentPath, item.href) ? "page" : undefined}
              onClick={() => onNavigate?.()}
              className="inline-flex min-h-9 items-center rounded-base px-2 text-sm hover:bg-muted aria-[current=page]:font-semibold aria-[current=page]:underline"
            >
              {copy.layout.nav.items[item.key]}
            </Link>
          </li>
        ))}
        {extraItems}
      </ul>
    </nav>
  );
}

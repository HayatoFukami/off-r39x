import type { ReactNode } from "react";
import { cn } from "./ui/cn";

// A section's heading names its region through aria-labelledby (SPEC-050 25).

export function SectionHeading({
  id,
  level = 2,
  children,
  className,
}: {
  id: string;
  level?: 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag
      id={id}
      className={cn(level === 2 ? "text-xl font-bold" : "text-base font-semibold", className)}
    >
      {children}
    </Tag>
  );
}

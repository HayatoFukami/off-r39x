"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./ui/cn";

// A section's heading names its region through aria-labelledby (SPEC-050 25). It fades in once when it first
// enters the viewport: data-reveal is static (server / first render), pending (waiting, opacity 0) or revealed.
// The states only move forward; reduced motion and missing IntersectionObserver keep it static.

type Reveal = "static" | "pending" | "revealed";

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
  const ref = useRef<HTMLHeadingElement>(null);
  const [reveal, setReveal] = useState<Reveal>("static");

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Only a heading still below the viewport is hidden; one already in view (or above it) stays shown.
    if (element.getBoundingClientRect().top < window.innerHeight) return;
    // Hide without animating the move to opacity 0: the transition is suspended until effect B below.
    element.style.transition = "none";
    setReveal("pending");
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setReveal("revealed");
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // B: once the pending style is applied, force a style recalculation, then restore the CSS transition so
  // that only the later move to opacity 1 animates.
  useLayoutEffect(() => {
    const element = ref.current;
    if (reveal !== "pending" || element === null) return;
    void element.offsetWidth;
    element.style.transition = "";
  }, [reveal]);

  return (
    <Tag
      ref={ref}
      id={id}
      data-reveal={reveal}
      className={cn(level === 2 ? "text-xl font-bold" : "text-base font-semibold", className)}
    >
      {children}
    </Tag>
  );
}

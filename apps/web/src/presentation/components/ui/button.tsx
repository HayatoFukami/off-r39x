import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

// Visual values come from the @theme tokens in app/globals.css (SPEC-050 24.3).
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-base border border-transparent text-sm font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-foreground hover:bg-brand/90",
        outline: "border-border bg-background text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        link: "text-brand underline underline-offset-4 hover:no-underline",
      },
      size: {
        default: "min-h-9 px-3 py-1.5",
        sm: "min-h-8 px-2.5 py-1 text-[0.8rem]",
        lg: "min-h-11 px-4 py-2",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: Omit<ButtonPrimitive.Props, "className"> & { className?: string } & VariantProps<
    typeof buttonVariants
  >) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

import type { ComponentProps } from "react";
import { Link as RouterLink } from "react-router";

// The Next-compatible Link of the app (DEV-WEB-001): call sites keep `href` and the `prefetch` flag. A static SPA has
// nothing to prefetch, so `prefetch` is taken out here and never reaches the DOM.
export type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  prefetch?: false;
};

export function Link({ href, prefetch: _prefetch, ...rest }: LinkProps) {
  return <RouterLink to={href} {...rest} />;
}

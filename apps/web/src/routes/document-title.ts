import { SITE_NAME } from "../config/site";

/** Pages read "Page | SITE_NAME"; a page without a title (Home) keeps the site name (SPEC-050 7). */
export function formatDocumentTitle(title?: string): string {
  return title === undefined ? SITE_NAME : `${title} | ${SITE_NAME}`;
}

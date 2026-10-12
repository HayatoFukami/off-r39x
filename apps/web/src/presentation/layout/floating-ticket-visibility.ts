// Routes whose first path segment hides the Floating Ticket Button (SPEC-050 8.5): Entry Ticket sales,
// Cart, Authentication, Mypage, Purchase Status and the development area. Compared on segment boundaries.
const HIDDEN_FIRST_SEGMENTS: readonly string[] = [
  "entry",
  "cart",
  "account",
  "mypage",
  "purchase",
  "dev",
];

export function isFloatingTicketVisible(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  const first = path.split("/").find((segment) => segment !== "") ?? "";
  return !HIDDEN_FIRST_SEGMENTS.includes(first);
}

/** The rule for when the site name takes over a click (SPEC-050 8.5): only a plain primary click. */
export type ClickLike = {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
};

export function isPlainPrimaryClick(event: ClickLike): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

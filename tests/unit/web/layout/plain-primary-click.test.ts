import { describe, expect, it } from "vitest";
import { isPlainPrimaryClick } from "../../../../apps/web/src/presentation/layout/plain-primary-click.ts";

// Contract: tests/contracts/s10-header-float-reveal.md section 3 (SPEC-050 v1.2.1 8.5 site name).

const base = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

describe("TC-PG-PUB-001-244 a plain primary click is the only click that the site name takes over (SPEC-050 8.5, 25)", () => {
  it("is true for the primary button with no modifier key", () => {
    expect(isPlainPrimaryClick(base)).toBe(true);
  });

  it("is false when any one of Control, Meta, Shift or Alt is held", () => {
    expect(isPlainPrimaryClick({ ...base, ctrlKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...base, metaKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...base, shiftKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...base, altKey: true })).toBe(false);
  });

  it("is false for combined modifiers", () => {
    expect(isPlainPrimaryClick({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("is false for a non-primary button", () => {
    for (const button of [1, 2, 3, 4]) {
      expect(isPlainPrimaryClick({ ...base, button }), `button ${button}`).toBe(false);
    }
  });

  it("is false for a non-primary button together with a modifier", () => {
    expect(isPlainPrimaryClick({ ...base, button: 1, ctrlKey: true })).toBe(false);
  });
});

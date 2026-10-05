import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S10 shell changes (tests/contracts/s10-header-float-reveal.md sections 0, 2, 4, 5, 6).
// These read source files only; behaviour is covered by the Playwright UI mock suite.

const webDir = fileURLToPath(new URL("../../../../apps/web/", import.meta.url));
const abs = (path: string): string => join(webDir, path);
const read = (path: string): string =>
  existsSync(abs(path)) ? readFileSync(abs(path), "utf8") : "";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("TC-PG-PUB-001-243 S10 structure: Header menu, Floating Ticket Button, badge, viewport, reveal CSS (SPEC-050 8.5, 25)", () => {
  it("replaces the Mobile drawer and the always-visible Header navigation with the Header menu", () => {
    expect(existsSync(abs("src/presentation/layout/mobile-nav-drawer.tsx"))).toBe(false);
    const header = read("src/presentation/layout/global-header.tsx");
    expect(header).toMatch(/HeaderMenu/);
    expect(header).not.toMatch(/MobileNavDrawer|mobile-nav-drawer/);
    expect(header).not.toMatch(/hidden md:block/);
  });

  it("builds the menu as a disclosure with aria-expanded, aria-controls and Escape, not a dialog or an ARIA menu", () => {
    const menu = read("src/presentation/layout/header-menu.tsx");
    expect(menu).toMatch(/^\s*["']use client["']/);
    expect(menu).toMatch(/aria-expanded/);
    expect(menu).toMatch(/aria-controls/);
    expect(menu).toMatch(/Escape/);
    expect(menu).toMatch(/copy\.layout\.menu\.button/);
    expect(menu).not.toMatch(/role=["'](menu|menuitem|dialog)["']/);
    expect(menu).not.toMatch(/ui\/dialog/);
    expect(menu).not.toMatch(/md:hidden/);
  });

  it("renders the Floating Ticket Button as a fixed Link to the Entry Ticket page with its own label", () => {
    const button = read("src/presentation/layout/floating-ticket-button.tsx");
    expect(button).toMatch(/fixed/);
    expect(button).toMatch(/safe-area-inset-bottom/);
    expect(button).toMatch(/data-testid=["']floating-ticket-button["']/);
    expect(button).toMatch(/copy\.layout\.floatingTicket\.label/);
    expect(button).not.toMatch(/copy\.layout\.cta\.buyTickets/);
    expect(button).toMatch(/isFloatingTicketVisible/);
    expect(button).toMatch(/CTA_HREF|["']\/entry["']/);
  });

  it("wires the Floating Ticket Button into the root layout and enables viewport-fit=cover", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/FloatingTicket/);
    expect(layout).toMatch(/export\s+const\s+viewport\b/);
    expect(layout).toMatch(/viewportFit\s*:\s*["']cover["']/);
  });

  it("moves the mock badge to the bottom left", () => {
    const badge = read("src/mock/dev-ui/mock-mode-badge.tsx");
    expect(badge).toMatch(/\bleft-/);
    expect(badge).not.toMatch(/\bright-/);
    expect(badge).toMatch(/\bfixed\b/);
  });

  it("defines the reveal states in CSS with a reduced-motion override and marks headings in the presentation layer", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/data-reveal/);
    expect(css).toMatch(/prefers-reduced-motion/);
    const presentation = walk(abs("src/presentation")).filter((f) => /\.tsx?$/.test(f));
    const marked = presentation.filter((f) => /data-reveal/.test(readFileSync(f, "utf8")));
    expect(marked.length).toBeGreaterThan(0);
  });

  it("keeps the reveal attribute out of h1 and Hero code", () => {
    for (const file of walk(abs("src/features")).filter((f) => /\.tsx$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/<h1[^>]*data-reveal/);
    }
  });
});

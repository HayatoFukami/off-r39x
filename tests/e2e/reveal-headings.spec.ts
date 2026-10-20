import { expect, type Locator, type Page, test } from "@playwright/test";
import { gotoHydrated } from "../harness/browser/hydration.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s10-header-float-reveal.md section 6.
// SPEC-050 25: Section headings (h2 / h3) may fade in when they enter the view; they are visible from the
// start without JavaScript and under prefers-reduced-motion, and the DOM / accessibility tree never changes.

const SECTION_HEADINGS = "main h2, main h3";

const opacityOf = (heading: Locator): Promise<string> =>
  heading.evaluate((el) => getComputedStyle(el).opacity);
const revealOf = (heading: Locator): Promise<string | null> =>
  heading.evaluate((el) => el.getAttribute("data-reveal"));

/** Home renders its sections after the mock fetch: wait until enough headings exist. */
async function waitForHeadings(page: Page, min: number): Promise<void> {
  await expect
    .poll(() => page.locator("main h2").count(), { message: "Home h2 headings rendered" })
    .toBeGreaterThanOrEqual(min);
}

const SCROLL_TO_END_IN_STEPS = async (page: Page): Promise<void> => {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.max(200, (page.viewportSize()?.height ?? 600) / 2);
  for (let y = 0; y <= height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
};

function durationsAreZero(value: string): boolean {
  return value.split(",").every((part) => Number.parseFloat(part) === 0);
}

test.describe("TC-SPEC-050-25-001 with prefers-reduced-motion headings are visible from the start and never hidden (SPEC-050 25)", () => {
  test("no heading is pending, every heading is opaque with no transition, before and after scrolling", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoHydrated(page, "/");
    await waitForHeadings(page, 5);
    const headings = page.locator(SECTION_HEADINGS);
    const count = await headings.count();
    expect(count).toBeGreaterThanOrEqual(5);

    const check = async (when: string): Promise<void> => {
      for (let i = 0; i < count; i += 1) {
        const heading = headings.nth(i);
        const state = await revealOf(heading);
        expect(state, `${when}: heading ${i} carries data-reveal`).not.toBeNull();
        expect(state, `${when}: heading ${i} is not pending`).not.toBe("pending");
        expect(await opacityOf(heading), `${when}: heading ${i} opacity`).toBe("1");
        const duration = await heading.evaluate((el) => getComputedStyle(el).transitionDuration);
        expect(durationsAreZero(duration), `${when}: heading ${i} transition ${duration}`).toBe(
          true,
        );
      }
    };
    await check("on load");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await check("after scrolling to the end");
  });
});

test.describe("TC-SPEC-050-25-002 headings below the fold wait invisibly and fade in when they enter the view (SPEC-050 25)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("a heading below the fold is pending (opacity 0, still in the DOM and the accessibility tree), then revealed (opacity 1)", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await waitForHeadings(page, 5);
    const heading = page.locator("main h2").last();
    const text = (await heading.textContent())?.trim() ?? "";
    expect(text.length).toBeGreaterThan(0);

    // Precondition (not an app defect if it fails): the last Home section starts below the first screen.
    const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(top, "precondition: the heading starts below the viewport").toBeGreaterThan(innerHeight);

    await expect(heading).toHaveAttribute("data-reveal", "pending");
    expect(await opacityOf(heading)).toBe("0");
    expect(
      await heading.evaluate((el) => {
        const style = getComputedStyle(el);
        return [
          style.display !== "none",
          style.visibility === "visible",
          el.closest("[aria-hidden]") === null,
        ];
      }),
    ).toEqual([true, true, true]);
    await expect(page.getByRole("heading", { level: 2, name: text, exact: true })).toHaveCount(1);

    // The fade is an opacity transition of a non-zero, short duration.
    const transition = await heading.evaluate((el) => {
      const style = getComputedStyle(el);
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });
    expect(transition.property).toMatch(/\bopacity\b|\ball\b/);
    const seconds = transition.duration.split(",").map((part) => Number.parseFloat(part));
    expect(Math.max(...seconds)).toBeGreaterThan(0);
    expect(Math.max(...seconds)).toBeLessThanOrEqual(1);

    await heading.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(heading).toHaveAttribute("data-reveal", "revealed");
    await expect.poll(() => opacityOf(heading), { timeout: 5000 }).toBe("1");

    // One-shot: leaving the view and coming back does not hide it again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(heading).toHaveAttribute("data-reveal", "revealed");
    expect(await opacityOf(heading)).toBe("1");
  });

  test("headings that are already in the first screen end up visible, and a full scroll leaves none pending", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await waitForHeadings(page, 5);
    const headings = page.locator(SECTION_HEADINGS);
    const count = await headings.count();
    const inFirstScreen = await headings.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().top < window.innerHeight),
    );
    for (let i = 0; i < count; i += 1) {
      if (!inFirstScreen[i]) continue;
      await expect
        .poll(() => opacityOf(headings.nth(i)), { message: `first-screen heading ${i}` })
        .toBe("1");
      expect(await revealOf(headings.nth(i))).not.toBe("pending");
    }

    await SCROLL_TO_END_IN_STEPS(page);
    for (let i = 0; i < count; i += 1) {
      await expect
        .poll(() => revealOf(headings.nth(i)), { message: `heading ${i} after a full scroll` })
        .toMatch(/^(static|revealed)$/);
      await expect.poll(() => opacityOf(headings.nth(i))).toBe("1");
    }
  });
});

test.describe("TC-SPEC-050-25-003 without JavaScript the section headings are visible (SPEC-050 25)", () => {
  test.use({ javaScriptEnabled: false });

  // In UI mock mode the pages render their sections on the client, so the server HTML contains no
  // SectionHeading. The server-rendered form of a heading is `data-reveal="static"` (contract 6.1): this test
  // splices two such headings into the real server HTML of Home and checks them against the real stylesheet.
  test("a server-rendered heading (data-reveal=static) is opaque when scripts do not run", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        if (route.request().resourceType() !== "document") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const html = await response.text();
        const probes =
          '<h2 id="probe-h2" data-reveal="static">probe h2</h2><h3 id="probe-h3" data-reveal="static">probe h3</h3>';
        const patched = html.replace(/(<main[^>]*>)/, `$1${probes}`);
        expect(patched, "the probe headings were spliced into <main>").not.toBe(html);
        await route.fulfill({ response, body: patched });
      },
    );
    await page.goto("/");
    for (const id of ["probe-h2", "probe-h3"]) {
      const heading = page.locator(`#${id}`);
      await expect(heading).toHaveAttribute("data-reveal", "static");
      await expect(heading).toHaveCSS("opacity", "1");
      await expect(heading).toBeVisible();
    }
    // Scripts did not run: nothing armed the reveal and the hydration signal is absent.
    await expect(page.locator("html[data-hydrated]")).toHaveCount(0);
    await expect(page.locator("[data-reveal='pending']")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("TC-SPEC-050-25-004 only h2 / h3 section headings take part, and the DOM and accessibility tree do not change (SPEC-050 25)", () => {
  for (const route of ["/", "/karaoke"]) {
    test(`on ${route}: data-reveal is on h2 / h3 only, never on h1, and the heading outline is unchanged by the reveal`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await gotoHydrated(page, route);
      await expect
        .poll(() => page.locator(SECTION_HEADINGS).count(), { message: "section headings" })
        .toBeGreaterThan(0);
      await page.waitForLoadState("networkidle");

      const snapshot = (): Promise<{ outline: string[]; marked: string[]; ariaHidden: number }> =>
        page.evaluate(() => {
          const all = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
          return {
            outline: all.map(
              (el) => `${el.tagName}:${(el.textContent ?? "").replace(/\s+/g, " ").trim()}`,
            ),
            marked: Array.from(document.querySelectorAll("[data-reveal]")).map((el) => el.tagName),
            ariaHidden: all.filter((el) => el.closest("[aria-hidden='true']") !== null).length,
          };
        });

      const before = await snapshot();
      expect(before.marked.length).toBeGreaterThan(0);
      for (const tag of before.marked) expect(["H2", "H3"], tag).toContain(tag);
      await expect(page.locator("h1[data-reveal]")).toHaveCount(0);
      await expect(page.locator("[data-reveal]:not(h2):not(h3)")).toHaveCount(0);
      // Every section heading in main carries the attribute (the reveal is not partial).
      await expect(
        page.locator("main h2:not([data-reveal]), main h3:not([data-reveal])"),
      ).toHaveCount(0);
      // h1 stays fully visible at all times.
      expect(await opacityOf(page.locator("h1").first())).toBe("1");

      await SCROLL_TO_END_IN_STEPS(page);
      const after = await snapshot();
      expect(after.outline, "heading outline unchanged").toEqual(before.outline);
      expect(after.marked, "marked elements unchanged").toEqual(before.marked);
      expect(before.ariaHidden).toBe(0);
      expect(after.ariaHidden).toBe(0);
    });
  }
});

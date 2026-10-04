import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  awaitingWithWebhook,
  describedBy,
  goodsItemPath,
  mainButton,
  mypageNav,
  navLink,
  navToggle,
  orderPath,
  PATH,
  region,
  rowWithHref,
  ticketPath,
} from "../harness/browser/mypage.ts";
import { alertsOf, heading1, mainOf, openAs, statusLive } from "../harness/browser/purchase.ts";
import { isDesktop } from "../harness/browser/shell.ts";
import { GOODS_ITEM, ORDER, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 4.2, 4.4, 4.6.
// SPEC-050 25 (Accessibility), 31 item 22. Keyboard operation, focus order, state-change announcement,
// described disabled actions and error association. The wording of state labels is covered in the page specs.

const profile = () => copy.mypage.profile;

/** The tab stops inside <main> in DOM order (links, enabled buttons, inputs), skipping hidden ones. */
async function tabStopsInMain(
  page: Page,
): Promise<{ tag: string; text: string; tabindex: string | null }[]> {
  return page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const style = window.getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    return Array.from(
      document.querySelectorAll(
        "main a[href], main button:not([disabled]), main input:not([type='hidden']), main [tabindex]",
      ),
    )
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? "").trim().slice(0, 40),
        tabindex: el.getAttribute("tabindex"),
      }));
  });
}

test.describe("TC-PG-MYP-001-721 the Mypage can be operated with the keyboard alone (E2E 22, SPEC-050 25)", () => {
  test("a navigation link is reached by focus and followed with Enter; the destination takes the focus context", async ({
    page,
  }) => {
    await openAs(page, PATH.overview);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    if (!isDesktop(page)) {
      await navToggle(page).focus();
      await page.keyboard.press("Enter");
      await expect(navToggle(page)).toHaveAttribute("aria-expanded", "true");
    }
    await navLink(page, "orders").focus();
    await expect(navLink(page, "orders")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/mypage\/orders$/);
    await expect(heading1(page)).toHaveText(copy.mypage.orders.heading);

    // From the list, a row's link is followed by the keyboard as well.
    const row = rowWithHref(mainOf(page), orderPath(ORDER.confirmedEntry));
    await row.getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${orderPath(ORDER.confirmedEntry)}$`));
    await expect(heading1(page)).toHaveText(copy.mypage.orders.detail.heading);
  });

  test("the Mobile menu toggle opens and closes with Enter and Space and keeps its state in aria-expanded", async ({
    page,
  }) => {
    test.skip(isDesktop(page), "the toggle exists on Mobile only");
    await openAs(page, PATH.overview);
    const toggle = navToggle(page);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(mypageNav(page)).toBeVisible();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(navLink(page, "profile")).toBeHidden();
  });

  test("the Profile is completed from the keyboard: type, Enter to save, and the result is announced", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    const field = mainOf(page).getByLabel(profile().displayNameLabel, { exact: true });
    await field.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("キーボード入力");
    await page.keyboard.press("Enter");
    await expect(statusLive(page)).toHaveText(profile().status.saved);
    await expect(field).toHaveValue("キーボード入力");
  });
});

test.describe("TC-PG-MYP-001-722 the focus order follows the document order and nothing forces it (SPEC-050 25)", () => {
  const pages: [string, string][] = [
    ["Overview", PATH.overview],
    ["Profile", PATH.profile],
    ["Orders", PATH.orders],
    ["Entry Ticket detail (VALID)", ticketPath(TICKET.valid)],
    ["Goods detail", goodsItemPath(GOODS_ITEM.fulfillable)],
  ];
  for (const [name, path] of pages) {
    test(`${name}: no positive tabindex, and Tab visits the controls in the order they appear`, async ({
      page,
    }) => {
      await openAs(page, path);
      await expect(heading1(page)).toBeVisible();
      await expect(
        mainOf(page).locator('[role="status"]').filter({ hasText: copy.pageState.loading }),
      ).toHaveCount(0);
      const stops = await tabStopsInMain(page);
      expect(stops.length, name).toBeGreaterThan(0);
      for (const stop of stops) {
        expect(Number(stop.tabindex ?? 0), `${name}: ${stop.text}`).toBeLessThanOrEqual(0);
      }
      // Walk the controls by Tab, starting from the first one in main, and compare with the document order.
      const tabbable = stops.filter((s) => s.tabindex !== "-1");
      await page.evaluate(() => {
        const visible = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          const rect = (el as HTMLElement).getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const first = Array.from(
          document.querySelectorAll(
            "main a[href], main button:not([disabled]), main input:not([type='hidden'])",
          ),
        ).find(visible) as HTMLElement | undefined;
        first?.focus();
      });
      const visited: string[] = [];
      const limit = Math.min(tabbable.length, 8);
      for (let i = 0; i < limit; i += 1) {
        visited.push(
          await page.evaluate(() =>
            (document.activeElement?.textContent ?? "").trim().slice(0, 40),
          ),
        );
        await page.keyboard.press("Tab");
      }
      expect(visited, name).toEqual(tabbable.slice(0, limit).map((s) => s.text));
    });
  }
});

test.describe("TC-PG-MYP-001-723 a disabled action explains itself in text and an error is tied to its field (SPEC-050 25)", () => {
  test("a disabled QR action is described by the reason, which is on the page as text", async ({
    page,
  }) => {
    await openAs(page, ticketPath(TICKET.used));
    const button = mainButton(page, copy.mypage.entryTickets.detail.qrLink);
    await expect(button).toBeDisabled();
    const described = await describedBy(button);
    expect(described).toBe(copy.entryTicket.disabledReason.USED);
    await expect(region(page, copy.mypage.entryTickets.detail.infoHeading)).toContainText(
      described,
    );
  });

  test("a rejected Profile name moves the focus to the error summary, which names the field and leads to it", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    const field = mainOf(page).getByLabel(profile().displayNameLabel, { exact: true });
    await field.fill("");
    await mainButton(page, profile().save).click();
    await expect(alertsOf(page)).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(await describedBy(field)).toContain(profile().error.required);
    await page.keyboard.press("Tab");
    await expect(alertsOf(page).getByRole("link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toBeFocused();
  });
});

test.describe("TC-PG-MYP-001-724 a state change is announced to assistive technology without moving the focus (SPEC-050 25)", () => {
  test("the live region exists before the change and receives the announcement of a confirmed Order", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.awaiting), {
      scenario: { paymentOutcome: "confirm_after_recheck" },
      dbEdit: (state) => awaitingWithWebhook(state, ORDER.awaiting),
    });
    await expect(statusLive(page)).toHaveCount(1);
    await expect(statusLive(page)).toHaveText("");
    const button = mainButton(page, copy.order.action.recheck_status);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(statusLive(page)).toHaveText(
      copy.purchase.recheck.changed(copy.order.state.CONFIRMED),
    );
    // The announcement is in a polite live region (role=status), not an alert, and the page did not navigate.
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${orderPath(ORDER.awaiting)}$`));
  });

  test("the Profile status region exists before saving and announces the save", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await expect(statusLive(page)).toHaveCount(1);
    await expect(statusLive(page)).toHaveText("");
    const field = mainOf(page).getByLabel(profile().displayNameLabel, { exact: true });
    await field.fill("通知確認");
    await mainButton(page, profile().save).click();
    await expect(statusLive(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
  });
});

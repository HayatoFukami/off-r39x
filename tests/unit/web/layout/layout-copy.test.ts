import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";

// Contract: tests/contracts/s3-layout.md section 1 (SPEC-050 8.5, 19.1, 24.3, 25, SEC-WEB-012).

describe("TC-PG-PUB-001-221 copy.layout carries the fixed global shell wording (SPEC-050 8.5)", () => {
  it("has the main CTA, cart and account labels", () => {
    expect(copy.layout.cta.buyTickets).toBe("チケットを購入する");
    expect(copy.layout.cart.label).toBe("カート");
    expect(copy.layout.account.login).toBe("ログイン");
    expect(copy.layout.account.register).toBe("アカウント登録");
    expect(copy.layout.account.mypage).toBe("マイページ");
    expect(copy.layout.account.menuButton).toBe("アカウントメニュー");
    expect(copy.layout.account.menuLabel).toBe("アカウント");
    expect(copy.layout.account.logout).toBe("ログアウト");
  });

  it("states the cart quantity in the accessible name with full-width brackets", () => {
    expect(copy.layout.cart.labelWithCount(3)).toBe("カート（3点）");
    expect(copy.layout.cart.labelWithCount(12)).toBe("カート（12点）");
  });

  it("has landmark, skip link, drawer, sponsor and mock badge wording", () => {
    expect(copy.layout.skipLink).toBe("メインコンテンツへ移動");
    expect(copy.layout.nav.primaryLabel).toBe("メインナビゲーション");
    expect(copy.layout.nav.footerLabel).toBe("フッターナビゲーション");
    expect(copy.layout.drawer).toEqual({
      open: "メニューを開く",
      close: "メニューを閉じる",
      title: "メニュー",
    });
    expect(copy.layout.sponsors.regionLabel).toBe("協賛");
    expect(copy.layout.sponsors.externalSuffix).toBe("（外部サイト）");
    expect(copy.layout.mockBadge).toBe("UIモック表示中");
  });

  it("names the navigation items", () => {
    expect(copy.layout.nav.items).toEqual({
      event: "Event",
      entry: "Entry Ticket",
      karaoke: "Karaoke",
      goods: "Goods",
      cart: "カート",
    });
  });

  it("names the account menu items", () => {
    const { account } = copy.layout;
    expect([
      account.profile,
      account.orders,
      account.entryTickets,
      account.karaoke,
      account.goods,
    ]).toEqual(["プロフィール", "注文", "Entry Ticket", "Karaoke", "Goods"]);
  });

  it("never words the sponsor region as a 'none' state", () => {
    const values = [copy.layout.sponsors.regionLabel, copy.layout.sponsors.externalSuffix];
    for (const value of values) expect(value).not.toMatch(/なし|ありません|0件/);
  });
});

describe("TC-PG-XFN-002-201 copy for the Not Found and error pages (SPEC-050 19.1, SEC-WEB-012)", () => {
  it("has the Not Found wording that says the page cannot be shown and links Home", () => {
    expect(copy.notFound.title).toBe("ページを表示できません");
    expect(copy.notFound.description).toBe("お探しのページは存在しないか、現在表示できません。");
    expect(copy.notFound.homeLink).toBe("Event Homeへ戻る");
  });

  it("has generic error wording with a retry action and no technical detail", () => {
    expect(copy.errorPage.title).toBe("問題が発生しました");
    expect(copy.errorPage.description).toBe(
      "ページを表示できませんでした。時間をおいて、もう一度お試しください。",
    );
    expect(copy.errorPage.retry).toBe("再試行");
    expect(copy.errorPage.homeLink).toBe("Event Homeへ戻る");
    for (const value of Object.values(copy.errorPage)) {
      expect(value).not.toMatch(/stack|Error:|digest|\.tsx?|at /i);
    }
  });
});

import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s8-mypage.md section 2 (SPEC-050 17, 18, 19.2, 24.2, 25, 26.2).

const mypage = (): typeof copy.mypage => copy.mypage;

const noneContainsAnother = (values: readonly string[]): boolean =>
  values.every((a, i) => values.every((b, j) => i === j || !a.includes(b)));

describe("TC-PG-MYP-001-601 the Mypage copy is the contracted wording (SPEC-050 17.2, 18.1)", () => {
  it("names the local navigation and the Overview sections literally", () => {
    const m = mypage();
    expect(m.pageTitle).toBe("マイページ");
    expect(m.heading).toBe("マイページ");
    expect(m.nav.label).toBe("マイページ内メニュー");
    expect(m.nav.toggle).toBe("マイページのメニュー");
    expect(m.nav.items).toEqual({
      overview: "マイページ トップ",
      profile: "プロフィール",
      orders: "注文履歴",
      entryTickets: "Entry Ticket一覧",
      reservations: "Karaoke予約一覧",
      goodsItems: "Goods購入一覧",
    });
    expect(m.overview.profileHeading).toBe("アカウント情報");
    expect(m.overview.pendingHeading).toBe("確定前の購入手続き");
    expect(m.overview.latestHeading).toBe("最新の注文");
    expect(m.overview.ticketsHeading).toBe("Entry Ticket");
    expect(m.overview.karaokeHeading).toBe("これからのKaraoke予約");
    expect(m.overview.goodsHeading).toBe("Goodsの受け取り");
    expect(m.overview.ticketsSummary(2, 5)).toBe("利用可能 2枚 / 全 5枚");
    expect(m.overview.goodsSummary(1)).toBe("会場受け取り待ち 1件");
  });

  it("has the Empty wording of the Overview and of the lists literally (SPEC-050 9.2, 18.5)", () => {
    const m = mypage();
    expect(m.overview.pendingEmpty).toBe("確定前の購入手続きはありません");
    expect(m.overview.latestEmpty).toBe("注文はまだありません");
    expect(m.overview.ticketsEmpty).toBe("Entry Ticketはありません");
    expect(m.overview.karaokeEmpty).toBe("予定されているKaraoke予約はありません");
    expect(m.overview.goodsEmpty).toBe("会場受け取り待ちのGoodsはありません");
    expect(m.orders.empty).toBe("注文はありません");
    expect(m.entryTickets.empty).toBe("Entry Ticketはありません");
    expect(m.reservations.empty).toBe("Karaoke予約はありません");
    expect(m.goodsItems.empty).toBe("Goodsの購入はありません");
  });

  it("has the page headings and titles of the ten list / detail pages literally", () => {
    const m = mypage();
    expect([m.profile.pageTitle, m.profile.heading]).toEqual(["プロフィール", "プロフィール"]);
    expect([m.orders.pageTitle, m.orders.heading]).toEqual(["注文履歴", "注文履歴"]);
    expect([m.orders.detail.pageTitle, m.orders.detail.heading]).toEqual([
      "注文の詳細",
      "注文の詳細",
    ]);
    expect([m.entryTickets.pageTitle, m.entryTickets.heading]).toEqual([
      "Entry Ticket一覧",
      "Entry Ticket一覧",
    ]);
    expect([m.entryTickets.detail.pageTitle, m.entryTickets.detail.heading]).toEqual([
      "Entry Ticketの詳細",
      "Entry Ticketの詳細",
    ]);
    expect([m.reservations.pageTitle, m.reservations.heading]).toEqual([
      "Karaoke予約一覧",
      "Karaoke予約一覧",
    ]);
    expect([m.reservations.detail.pageTitle, m.reservations.detail.heading]).toEqual([
      "Karaoke予約の詳細",
      "Karaoke予約の詳細",
    ]);
    expect([m.goodsItems.pageTitle, m.goodsItems.heading]).toEqual([
      "Goods購入一覧",
      "Goods購入一覧",
    ]);
    expect([m.goodsItems.detail.pageTitle, m.goodsItems.detail.heading]).toEqual([
      "Goodsの詳細",
      "Goodsの詳細",
    ]);
  });

  it("does not keep the S6 placeholder marker (it is replaced by the Overview, contract section 10)", () => {
    expect(Object.keys(mypage())).not.toContain("protectedMarker");
  });
});

describe("TC-PG-MYP-002-601 the Profile copy keeps its statuses and errors apart (SPEC-050 18.2, 25)", () => {
  it("has the Profile wording literally", () => {
    const p = mypage().profile;
    expect(p.emailNote).toBe("ログインに使うメールアドレスです。この画面では変更できません");
    expect(p.displayNameLabel).toBe("表示名");
    expect(p.save).toBe("保存する");
    expect(p.status).toEqual({
      dirty: "未保存の変更があります",
      saving: "保存しています",
      saved: "表示名を保存しました",
    });
    expect(p.error.required).toBe("表示名を入力してください");
    expect(p.error.unavailable).toBe(
      "表示名を保存できませんでした。時間をおいて、もう一度お試しください",
    );
    expect(p.passwordReset).toBe("パスワードの再設定へ");
  });

  it("the five status and error messages and the save action never contain one another", () => {
    const p = mypage().profile;
    const messages = [
      p.status.dirty,
      p.status.saving,
      p.status.saved,
      p.error.required,
      p.error.unavailable,
    ];
    expect(noneContainsAnother(messages)).toBe(true);
    for (const message of messages) expect(message).not.toContain(p.save);
    expect(p.error.unavailable).not.toContain(p.status.saved);
  });
});

describe("TC-PG-MYP-003-601 the Empty wordings are distinct so that a negative assertion cannot misfire (S7a lesson)", () => {
  it("the five Overview Empty messages never contain one another", () => {
    const o = mypage().overview;
    expect(
      noneContainsAnother([
        o.pendingEmpty,
        o.latestEmpty,
        o.ticketsEmpty,
        o.karaokeEmpty,
        o.goodsEmpty,
      ]),
    ).toBe(true);
  });

  it("the four list Empty messages never contain one another", () => {
    const m = mypage();
    expect(
      noneContainsAnother([
        m.orders.empty,
        m.entryTickets.empty,
        m.reservations.empty,
        m.goodsItems.empty,
      ]),
    ).toBe(true);
  });

  it("an unavailable read is never worded as an Empty and no Empty is worded as unavailable", () => {
    const m = mypage();
    const empties = [
      m.overview.pendingEmpty,
      m.overview.latestEmpty,
      m.overview.ticketsEmpty,
      m.overview.karaokeEmpty,
      m.overview.goodsEmpty,
      m.orders.empty,
      m.entryTickets.empty,
      m.reservations.empty,
      m.goodsItems.empty,
    ];
    const subjects = [
      m.overview.profileSubject,
      m.overview.pendingSubject,
      m.overview.latestSubject,
      m.overview.ticketsSubject,
      m.overview.karaokeSubject,
      m.overview.goodsSubject,
      m.profile.subject,
      m.orders.subject,
      m.orders.detail.subject,
      m.entryTickets.subject,
      m.entryTickets.detail.subject,
      m.reservations.subject,
      m.reservations.detail.subject,
      m.goodsItems.subject,
      m.goodsItems.detail.subject,
    ];
    for (const subject of subjects) {
      const message = copy.pageState.unavailable(subject);
      expect(message).toMatch(/を取得できません$/);
      for (const empty of empties) expect(message, empty).not.toContain(empty);
    }
    for (const empty of empties) expect(empty).not.toMatch(/取得できません|読み込み/);
  });
});

describe("TC-PG-MYP-004-601 the Order / Ticket / Reservation / Goods pages use the wording the Pages require", () => {
  it("has the Entry Ticket pages' wording literally (SPEC-050 18.5, 18.6)", () => {
    const e = mypage().entryTickets;
    expect(e.detail.kindLabel).toBe("Ticketの種別");
    expect(e.detail.infoHeading).toBe("Ticketの情報");
    expect(e.detail.stateLabel).toBe("Ticketの状態");
    expect(e.detail.issuedAtLabel).toBe("発行日時");
    expect(e.detail.usableLabel).toBe("入場受付での利用");
    expect(e.detail.usable).toBe("入場受付に利用できます");
    expect(e.detail.notUsable).toBe("入場受付には利用できません");
    expect(e.detail.qrLink).toBe("QRを表示する");
    expect(e.orderLink).toBe("対応する購入を見る");
    expect(e.detail.usable).not.toContain(e.detail.notUsable);
    expect(e.detail.notUsable).not.toContain(e.detail.usable);
  });

  it("has the Karaoke and Goods pages' wording literally (SPEC-050 18.8 .. 18.12)", () => {
    const r = mypage().reservations;
    const g = mypage().goodsItems;
    expect(r.detail.startLabel).toBe("利用開始時刻");
    expect(r.detail.endLabel).toBe("利用終了時刻");
    expect(r.reservationStateLabel).toBe("予約の状態");
    expect(r.ticketStateLabel).toBe("Ticketの状態");
    expect(r.detail.qrLink).toBe("QRを表示する");
    expect(r.detailLink("2027/03/08(月)", "12:20-12:35")).toBe(
      "2027/03/08(月) 12:20-12:35のKaraoke予約を見る",
    );
    expect(g.itemStateLabel).toBe("購入の状態");
    expect(g.handoffStateLabel).toBe("受け渡しの状態");
    expect(g.orderStateLabel).toBe("注文の状態");
    expect(g.detail.noSecondHandoff).toBe("二回目の受け取りはできません");
    expect(mypage().orders.detailLink("2027/03/01 20:00")).toBe("2027/03/01 20:00の注文を見る");
  });

  it("the Access Denied list links are fixed and reveal nothing about the target (SPEC-050 19.2)", () => {
    expect(copy.accessDenied.entryTicketsLink).toBe("Entry Ticket一覧へ戻る");
    expect(copy.accessDenied.reservationsLink).toBe("Karaoke予約一覧へ戻る");
    expect(copy.accessDenied.goodsItemsLink).toBe("Goods購入一覧へ戻る");
    for (const value of stringLeaves(copy.accessDenied)) {
      expect(value, value).not.toMatch(/他の|存在|所有/);
    }
  });
});

describe("TC-PG-MYP-007-601 the QR copy separates the two purposes and says that the QR is a mock (SEC-QR-012, SPEC-050 18.7, 18.10, 24.2)", () => {
  it("keeps the Entry and Karaoke titles, image labels and notices apart", () => {
    const qr = mypage().qr;
    expect(copy.qr.ENTRY).toBe("Entry Ticket / 入場受付用");
    expect(copy.qr.KARAOKE).toBe("Karaoke Ticket / Karaoke受付用");
    expect(qr.mockNotice).toBe("モック表示：実際のQRではありません");
    expect(qr.mockNotice).toContain("実際のQRではありません");
    expect(qr.imageLabel.ENTRY).toBe("Entry Ticket用の入場受付QR（モック表示）");
    expect(qr.imageLabel.KARAOKE).toBe("Karaoke Ticket用のKaraoke受付QR（モック表示）");
    expect(
      noneContainsAnother([
        qr.imageLabel.ENTRY,
        qr.imageLabel.KARAOKE,
        copy.qr.ENTRY,
        copy.qr.KARAOKE,
      ]),
    ).toBe(true);
    expect(qr.backToTicket).toBe("Ticketの詳細へ戻る");
    expect(qr.backToReservation).toBe("予約の詳細へ戻る");
  });
});

describe("TC-DEV-WEB-001-801 every S8 string leaf is plain, trimmed text without markup or secrets (SEC-WEB-017, SEC-AUTH-018)", () => {
  it("has only trimmed, non-empty leaves without angle brackets", () => {
    const leaves = stringLeaves({ mypage: copy.mypage, accessDenied: copy.accessDenied });
    expect(leaves.length).toBeGreaterThan(100);
    for (const value of leaves) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
    }
  });

  it("mentions a password or token only in the Profile's password pointer", () => {
    const { profile, ...rest } = copy.mypage;
    const leaves = stringLeaves({ ...rest, accessDenied: copy.accessDenied });
    for (const value of leaves) expect(value, value).not.toMatch(/パスワード|token|トークン/i);
    expect(profile.passwordNote).toMatch(/パスワード/);
  });
});

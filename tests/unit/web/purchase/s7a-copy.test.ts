import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s7a-purchase.md section 2 (SPEC-050 14A.1, 16.4, 16.6, 16.7, 19.2, 25, design section 6).

describe("TC-PG-XFN-001-641 the S7a copy is the contracted wording (SPEC-050 14A.1 / 16, design 6)", () => {
  it("has the Cart purchase-start wording literally", () => {
    expect(copy.cart.purchase.verifying).toBe("購入条件を確認しています");
    expect(copy.cart.purchase.rejectedTitle).toBe("購入は開始されていません");
    expect(copy.cart.purchase.preparing).toBe("支払い画面を準備中です。購入はまだ確定していません");
    expect(copy.cart.purchase.rejectedBody).toBe(
      "購入手続きは作成されていません。カートの内容はそのまま残っています。成立しなかった商品を確認し、数量を変更するか削除してください",
    );
    expect(copy.cart.purchase.unavailable).toBe(
      "購入条件を確認できませんでした。購入は開始されていません。時間をおいて、もう一度お試しください",
    );
  });

  it("has the Purchase Status wording literally", () => {
    expect(copy.purchase.pageTitle).toBe("購入状況");
    expect(copy.purchase.heading).toBe("購入状況");
    expect(copy.purchase.subject).toBe("購入状況");
    expect(copy.purchase.outcomeHeading).toBe("現在の状態");
    expect(copy.purchase.purposeLabel).toBe("購入の種類");
    expect(copy.purchase.createdAtLabel).toBe("作成日時");
    expect(copy.purchase.itemsHeading).toBe("購入内容");
    expect(copy.purchase.totalLabel).toBe("合計金額");
    expect(copy.purchase.checkoutPreparing).toBe(
      "支払い画面を準備中です。購入はまだ確定していません",
    );
    expect(copy.purchase.checkoutStartFailed).toBe(
      "支払い画面を開始できませんでした。購入は確定していません",
    );
    expect(copy.purchase.receipt.link).toBe("Receiptを見る");
    expect(copy.purchase.itemKind).toEqual({
      ENTRY_TICKET: "Entry Ticket",
      GOODS: "Goods",
      KARAOKE: "Karaoke",
    });
  });

  it("has the template wording literally", () => {
    expect(copy.purchase.quantity(3)).toBe("数量 3");
    expect(copy.purchase.usage("2027/03/08", "12:20-12:35")).toBe(
      "利用日時 2027/03/08 12:20-12:35",
    );
    expect(copy.purchase.recheck.changed("購入確定")).toBe(
      "購入状態が『購入確定』に更新されました",
    );
    expect(copy.purchase.recheck.inProgress).toBe("購入状態を確認しています");
    expect(copy.purchase.recheck.unchanged).toBe("購入状態はまだ変わっていません");
    expect(copy.purchase.recheck.failed).toBe(
      "購入状態を取得できませんでした。時間をおいて、もう一度お試しください",
    );
  });

  it("has the entitlement wording literally", () => {
    expect(copy.purchase.entitlements.heading).toBe("購入した権利");
    expect(copy.purchase.entitlements.entryHeading).toBe("Entry Ticket");
    expect(copy.purchase.entitlements.karaokeHeading).toBe("Karaoke予約");
    expect(copy.purchase.entitlements.goodsHeading).toBe("Goods");
    expect(copy.purchase.entitlements.entryLink(2)).toBe("Entry Ticket 2を見る");
    expect(copy.purchase.entitlements.reservationLink).toBe("Karaoke Ticketを見る");
    expect(copy.purchase.entitlements.goodsLink(1)).toBe("Goods 1を見る");
  });

  it("has the Access Denied and mock Checkout wording literally", () => {
    expect(copy.accessDenied.title).toBe("このページの内容を表示できません");
    expect(copy.accessDenied.mypageLink).toBe("マイページへ戻る");
    expect(copy.accessDenied.ordersLink).toBe("注文一覧へ戻る");
    expect(copy.mockCheckout.pageTitle).toBe("支払い画面（モック）");
    expect(copy.mockCheckout.heading).toBe("Stripe Checkoutの代替モック。実際の決済は行われません");
    expect(copy.mockCheckout.pay).toBe("支払う（モック）");
    expect(copy.mockCheckout.back).toBe("戻る");
  });
});

describe("TC-PG-XFN-001-642 the wording never claims success before the server confirms, nor reveals what it must not (SPEC-050 14A.1, 16.3, 19.2, PAY-BRW-001)", () => {
  const success =
    /購入確定|購入が確定|支払い完了|完了しました|成功|Ticket発行済み|予約確定|受け取り可能/;

  it("the in-progress and failure wording does not announce a confirmed purchase", () => {
    for (const text of [
      copy.cart.purchase.verifying,
      copy.cart.purchase.preparing,
      copy.cart.purchase.rejectedTitle,
      copy.cart.purchase.rejectedBody,
      copy.cart.purchase.unavailable,
      copy.purchase.checkoutPreparing,
      copy.purchase.checkoutStartFailed,
      copy.purchase.recheck.inProgress,
      copy.purchase.recheck.unchanged,
      copy.purchase.recheck.failed,
    ]) {
      expect(text).not.toMatch(success);
    }
  });

  it("the start-failure wording says the purchase is not confirmed, and the preparing wording says it is not yet", () => {
    expect(copy.purchase.checkoutStartFailed).toContain("購入は確定していません");
    expect(copy.cart.purchase.preparing).toContain("まだ確定していません");
    expect(copy.purchase.checkoutPreparing).toContain("支払い画面を準備中");
    expect(copy.cart.purchase.preparing).toContain("支払い画面を準備中");
  });

  it("the rejection wording states that no purchase was created and that the Cart is kept", () => {
    expect(copy.cart.purchase.rejectedBody).toContain("作成されていません");
    expect(copy.cart.purchase.rejectedBody).toContain("カートの内容");
    expect(copy.cart.purchase.rejectedBody).toMatch(/数量を変更|削除/);
  });

  it("the Access Denied wording does not confirm that a target exists or whose it is (SPEC-050 19.2)", () => {
    for (const text of [copy.accessDenied.title, copy.accessDenied.description]) {
      expect(text).not.toMatch(/他の|存在|所有|あなた以外/);
    }
  });

  it("the mock Checkout says it is a stand-in, that no real payment happens, and that its buttons do not confirm", () => {
    expect(copy.mockCheckout.heading).toContain("代替モック");
    expect(copy.mockCheckout.heading).toContain("実際の決済は行われません");
    expect(copy.mockCheckout.note).toContain("購入は確定しません");
    expect(copy.mockCheckout.note).toContain("支払い結果");
  });

  it("the state-change announcement carries the new label and no more", () => {
    expect(copy.purchase.recheck.changed("支払い不成立")).toBe(
      "購入状態が『支払い不成立』に更新されました",
    );
  });
});

describe("TC-PG-XFN-001-643 the S7a copy follows the copy rules (SPEC-050 24.3)", () => {
  it("every S7a leaf is a trimmed non-empty string", () => {
    const leaves = stringLeaves({
      cartPurchase: copy.cart.purchase,
      purchase: copy.purchase,
      accessDenied: copy.accessDenied,
      mockCheckout: copy.mockCheckout,
    });
    expect(leaves.length).toBeGreaterThanOrEqual(30);
    for (const leaf of leaves) {
      expect(leaf.trim()).toBe(leaf);
      expect(leaf.length).toBeGreaterThan(0);
    }
  });

  it("keeps the S5 / S6 keys that S7a builds on", () => {
    expect(copy.cart.proceed.label).toBe("購入手続きへ進む");
    expect(copy.cart.empty).toBe("カートは空です");
    expect(copy.order.action.purchase_again).toBe("もう一度購入する");
    expect(copy.order.action.retry_checkout).toBe("支払い開始を再試行");
    expect(copy.order.action.recheck_status).toBe("状態を再確認");
    expect(copy.auth.continuation.purpose.purchaseOrder).toBe("購入状況の確認");
  });

  it("does not leak internal identifiers into user-facing wording (SPEC-050 16.2)", () => {
    const leaves = stringLeaves({ purchase: copy.purchase, mock: copy.mockCheckout });
    for (const leaf of leaves) {
      expect(leaf).not.toMatch(/webhook|evt_|payment_intent|checkout\.session/i);
    }
  });
});

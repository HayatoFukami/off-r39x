import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s6-auth.md section 1 (SPEC-050 15, 25, SPEC-140 SEC-API-027, SPEC-060 AR-CONT-004).

describe("TC-PG-AUTH-003-401 the S6 copy is the contracted wording (SPEC-050 15.1-15.5, 24.3)", () => {
  it("names the five Pages and the placeholder Mypage", () => {
    expect(copy.auth.register.heading).toBe("アカウント登録");
    expect(copy.auth.register.pageTitle).toBe("アカウント登録");
    expect(copy.auth.verify.heading).toBe("メールアドレスの確認");
    expect(copy.auth.verify.pageTitle).toBe("メールアドレスの確認");
    expect(copy.auth.login.heading).toBe("ログイン");
    expect(copy.auth.login.pageTitle).toBe("ログイン");
    expect(copy.auth.reset.heading).toBe("パスワードの再設定");
    expect(copy.auth.reset.pageTitle).toBe("パスワードの再設定");
    expect(copy.auth.resetComplete.heading).toBe("新しいパスワードの設定");
    expect(copy.auth.resetComplete.pageTitle).toBe("新しいパスワードの設定");
    expect(copy.mypage.heading).toBe("マイページ");
    expect(copy.mypage.pageTitle).toBe("マイページ");
    expect(copy.mypage.protectedMarker).toBe("ログイン中の方だけに表示される内容です");
  });

  it("has the field labels, the password hint and the form-level wording literally", () => {
    expect(copy.auth.field.email.label).toBe("メールアドレス");
    expect(copy.auth.field.password.label).toBe("パスワード");
    expect(copy.auth.field.password.hint).toBe("12文字以上128文字以下で入力してください");
    expect(copy.auth.field.passwordConfirm.label).toBe("パスワード（確認）");
    expect(copy.auth.field.newPassword.label).toBe("新しいパスワード");
    expect(copy.auth.field.newPasswordConfirm.label).toBe("新しいパスワード（確認）");
    expect(copy.auth.form.errorSummaryTitle).toBe("入力内容を確認してください");
    expect(copy.auth.form.submitting).toBe("処理中です");
    expect(copy.auth.field.email.required).toBe("メールアドレスを入力してください");
    expect(copy.auth.field.email.invalidFormat).toBe("メールアドレスの形式が正しくありません");
    expect(copy.auth.field.password.required).toBe("パスワードを入力してください");
    expect(copy.auth.field.password.tooShort).toBe("パスワードは12文字以上で入力してください");
    expect(copy.auth.field.password.tooLong).toBe("パスワードは128文字以下で入力してください");
    expect(copy.auth.field.passwordConfirm.mismatch).toBe("確認用のパスワードが一致しません");
  });

  it("has the action wording literally", () => {
    expect(copy.auth.login.submit).toBe("ログイン");
    expect(copy.auth.login.toPasswordReset).toBe("パスワードをお忘れの方");
    expect(copy.auth.login.toRegister).toBe("アカウント登録へ");
    expect(copy.auth.login.cancel).toBe("ログインせずに戻る");
    expect(copy.auth.register.submit).toBe("アカウントを登録する");
    expect(copy.auth.register.toLogin).toBe("ログインへ");
    expect(copy.auth.reset.submit).toBe("再設定の案内を送る");
    expect(copy.auth.reset.backToLogin).toBe("ログインへ戻る");
    expect(copy.auth.resetComplete.submit).toBe("パスワードを更新する");
    expect(copy.auth.resetComplete.requestAgain).toBe("再設定の案内をもう一度送る");
    expect(copy.auth.verify.retry).toBe("もう一度確認する");
    expect(copy.auth.verify.toLogin).toBe("ログインへ進む");
    expect(copy.auth.verify.continue).toBe("続きへ進む");
  });

  it("has the Continuation notice wording literally (SPEC-050 10.1, AR-CONT-004)", () => {
    expect(copy.auth.continuation.notice).toBe("この操作にはログインが必要です");
    expect(copy.auth.continuation.returnAfter).toBe("認証後に、元の操作へ戻ります");
    expect(copy.auth.continuation.revalidate).toBe(
      "ログイン後に、販売状況や在庫などの現在の状態を確認し直します",
    );
    expect(copy.auth.continuation.purpose).toEqual({
      cart: "カートの購入手続き",
      karaokeSlot: "Karaoke Ticketの購入手続き",
      purchaseOrder: "購入状況の確認",
      mypage: "マイページの利用",
    });
  });

  it("has the AuthGate wording literally", () => {
    expect(copy.auth.gate.subject).toBe("ログイン状態");
    expect(copy.auth.gate.redirecting).toBe("ログイン画面へ移動しています");
  });
});

describe("TC-PG-AUTH-003-402 failure and result wording separates what must be separated (SPEC-050 9.3, 15, SEC-API-027)", () => {
  it("does not reveal which credential was wrong (15.3)", () => {
    expect(copy.auth.login.credentialFailure).toBe(
      "メールアドレスまたはパスワードが正しくありません。ログインできませんでした",
    );
    expect(copy.auth.login.credentialFailure).not.toMatch(
      /存在しません|登録されていません|パスワードが間違|メールアドレスが間違/,
    );
  });

  it("separates a service outage from a rejection or a credential failure", () => {
    const messages = [
      copy.auth.login.credentialFailure,
      copy.auth.login.unavailable,
      copy.auth.register.rejected,
      copy.auth.register.unavailable,
      copy.auth.reset.unavailable,
      copy.auth.resetComplete.unavailable,
      copy.auth.resetComplete.invalid,
      copy.auth.verify.invalid,
      copy.auth.verify.unavailable,
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(copy.auth.login.unavailable).toMatch(/できません/);
    expect(copy.auth.register.unavailable).toMatch(/できません/);
  });

  it("the reset acceptance does not disclose whether the account exists (SEC-API-027)", () => {
    expect(copy.auth.reset.accepted).toBe(
      "入力されたメールアドレスが登録されている場合、パスワード再設定の案内を送信しました",
    );
    expect(copy.auth.reset.accepted).toContain("場合");
    expect(copy.auth.reset.accepted).not.toMatch(/登録されていません|存在しません|見つかりません/);
  });

  it("an invalid verification is never worded as verified, and claims no data was deleted (15.2)", () => {
    expect(copy.auth.verify.verified).toBe("メールアドレスを確認しました");
    expect(copy.auth.verify.invalid).not.toContain(copy.auth.verify.verified);
    expect(copy.auth.verify.invalid).not.toMatch(/削除|取り消/);
    expect(copy.auth.verify.required).not.toContain(copy.auth.verify.verified);
    expect(copy.auth.verify.verifying).not.toContain(copy.auth.verify.verified);
    expect(copy.auth.login.passwordUpdated).toMatch(/ログイン/);
  });

  it("every S6 leaf is a trimmed, non-empty string without secrets or markup", () => {
    const leaves = stringLeaves({ auth: copy.auth, mypage: copy.mypage });
    expect(leaves.length).toBeGreaterThan(50);
    for (const value of leaves) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
    }
  });
});

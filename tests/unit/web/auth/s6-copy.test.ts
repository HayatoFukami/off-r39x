import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s6-auth.md section 1 (SPEC-050 15, 25, SPEC-140 SEC-API-027, SPEC-060 AR-CONT-004).

/** The Google wording as one object: the method label, copy.auth.google.* and the stand-in's copy.mockGoogle. */
const googleCopy = () => ({
  method: copy.auth.method.google,
  ...copy.auth.google,
  mock: copy.mockGoogle,
});
const googleCopyKeys = () => ({
  google: Object.keys(copy.auth.google).sort(),
  mock: Object.keys(copy.mockGoogle).sort(),
});

describe("TC-PG-AUTH-003-401 the S6 copy is the contracted wording (SPEC-050 15.1-15.5, 24.3)", () => {
  it("names the five Pages and the Mypage", () => {
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

// B5 C1 (tests/contracts/s6-auth.md section 1): the method selection and Email OTP wording. SPEC-050 15.0
// (no account existence in the sent wording, no GitHub / Discord), SPEC-140 SEC-API-027.
describe("TC-PG-AUTH-003-403 the method selection and Email OTP wording is the contracted wording and keeps what must be separated apart (SPEC-050 15.0, SEC-API-027)", () => {
  const otp = () => copy.auth.otp;

  it("has the method legends and labels literally", () => {
    expect(copy.auth.method.legendLogin).toBe("ログイン方法");
    expect(copy.auth.method.legendRegister).toBe("登録方法");
    expect(copy.auth.method.password).toBe("メールアドレスとパスワード");
    expect(copy.auth.method.emailOtp).toBe("メールで届く確認コード");
    // C2 added the Google method label and C3 adds the Magic Link label: the four methods' labels and two legends.
    expect(Object.keys(copy.auth.method).sort()).toEqual(
      ["emailOtp", "google", "legendLogin", "legendRegister", "magicLink", "password"].sort(),
    );
    for (const value of stringLeaves(copy.auth.method)) {
      expect(value, value).not.toMatch(/github|discord|\bline\b|\bapple\b/i);
    }
  });

  // B5 C2 (tests/contracts/s6-auth.md section 1): Google. The strings that the plan fixes are literal; the others are
  // pinned by what they must be and must not say.
  it("has the Google method label, the start actions and the result wording (SPEC-050 15.0)", () => {
    const g = googleCopy();
    expect(g.method).toContain("Google");
    expect(g.startLogin).toBe("Googleでログイン");
    expect(g.startRegister).toBe("Googleで登録");
    expect(g.failed).toBe(
      "Googleでの認証は完了しませんでした。もう一度お試しいただくか、別の方法を選んでください",
    );
    expect(g.signedIn).toBe(
      "ログイン中は Google でのログインを使えません。別のアカウントで利用するには、ログアウトしてください",
    );
    expect(g.unavailable).toMatch(/できません/);
    expect(googleCopyKeys().google).toEqual(
      ["failed", "signedIn", "startLogin", "startRegister", "unavailable"].sort(),
    );
  });

  it("the Google wording states how to continue, names no account existence and no number, and the signed-in hint names Logout (SPEC-050 15.0, SEC-API-027)", () => {
    const g = googleCopy();
    expect(g.failed).toMatch(/もう一度/);
    expect(g.failed).toMatch(/別の方法/);
    expect(g.signedIn).toMatch(/ログアウト/);
    for (const value of [
      g.method,
      g.startLogin,
      g.startRegister,
      g.failed,
      g.unavailable,
      g.signedIn,
    ]) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
      expect(value, value).not.toMatch(/[0-9０-９]/);
      expect(value, value).not.toMatch(
        /登録されていません|存在しません|見つかりません|登録されている/,
      );
      expect(value, value).not.toMatch(/github|discord|\bline\b|\bapple\b/i);
    }
    // The Google wordings are separate: a failure, an outage, the Logout hint and the two actions.
    const distinct = [g.failed, g.unavailable, g.signedIn, g.startLogin, g.startRegister];
    expect(new Set(distinct).size).toBe(distinct.length);
    // The start button names do not collide with the existing action names (getByRole name matching is exact).
    for (const other of [
      copy.auth.login.submit,
      copy.auth.register.submit,
      copy.auth.otp.send,
      copy.auth.otp.submitLogin,
      copy.auth.otp.submitRegister,
      copy.auth.otp.resend,
      copy.auth.otp.changeEmail,
    ]) {
      expect([g.startLogin, g.startRegister]).not.toContain(other);
    }
  });

  it("the dev stand-in screen names its three actions literally and says it is a stand-in (DEV-WEB-012, DEV-WEB-013)", () => {
    const m = googleCopy().mock;
    expect(m.allowDemo).toBe("demo@example.com として許可");
    expect(m.allowNew).toBe("新しいアカウント（google.new@example.com）として許可");
    expect(m.cancel).toBe("キャンセル");
    expect(googleCopyKeys().mock).toEqual(
      ["allowDemo", "allowNew", "cancel", "heading", "note", "pageTitle"].sort(),
    );
    for (const value of Object.values(m)) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
    }
    // Like the Stripe Checkout stand-in: the heading says it is a stand-in and that nothing real happens.
    expect(m.heading).toMatch(/モック|代替/);
    expect(m.pageTitle).toMatch(/モック/);
    expect(new Set([m.allowDemo, m.allowNew, m.cancel]).size).toBe(3);
    // The addresses are reserved synthetic ones.
    for (const value of [m.allowDemo, m.allowNew]) {
      const emails = value.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g) ?? [];
      expect(emails.length, value).toBe(1);
      expect(emails[0], value).toMatch(/@example\.com$/);
    }
  });

  it("has the code field and the action wording literally", () => {
    expect(copy.auth.field.otpCode.label).toBe("確認コード");
    expect(copy.auth.field.otpCode.required).toBe("確認コードを入力してください");
    expect(otp().send).toBe("確認コードを送る");
    expect(otp().submitLogin).toBe("確認コードでログインする");
    expect(otp().submitRegister).toBe("確認コードで登録する");
    expect(otp().resend).toBe("確認コードを再送する");
    expect(otp().changeEmail).toBe("メールアドレスを変更する");
    expect(Object.keys(otp()).sort()).toEqual(
      [
        "changeEmail",
        "codeExpired",
        "codeInvalid",
        "resend",
        "send",
        "sent",
        "submitLogin",
        "submitRegister",
        "unavailable",
      ].sort(),
    );
  });

  it("has the result wording literally", () => {
    expect(otp().sent).toBe("確認コードを送信しました。メールに記載されたコードを入力してください");
    expect(otp().codeInvalid).toBe("確認コードが正しくありません。もう一度入力してください");
    expect(otp().codeExpired).toBe(
      "確認コードの有効期限が切れたか、入力できる回数を超えました。確認コードを再送してください",
    );
    expect(otp().unavailable).toBe(
      "確認コードを処理できません。時間をおいて、もう一度お試しください",
    );
  });

  it("the sent wording never discloses whether the email is registered (SEC-API-027, SPEC-050 15.0)", () => {
    expect(otp().sent).not.toMatch(/登録|存在|見つかり|アカウント|場合/);
    for (const value of stringLeaves(copy.auth.otp)) {
      expect(value, value).not.toMatch(
        /登録されていません|存在しません|見つかりません|登録されている/,
      );
    }
  });

  it("states no expiry time and no attempt count: those values belong to the provider and are checked at the Production gate (SPEC-050 15.0)", () => {
    const leaves = stringLeaves(copy.auth.otp);
    expect(leaves, "copy.auth.otp must exist").toHaveLength(9);
    for (const value of leaves) {
      expect(value, value).not.toMatch(/[0-9０-９]/);
      expect(value, value).not.toMatch(/[0-9０-９一二三四五六七八九十]+\s*(分|秒|回|桁)/);
    }
  });

  it("a wrong code and an expired or exhausted code are separate messages with their own next step", () => {
    expect(otp().codeInvalid).not.toBe(otp().codeExpired);
    expect(otp().codeInvalid).not.toContain("再送");
    expect(otp().codeExpired).toContain("再送");
    expect(otp().unavailable).toMatch(/できません/);
    const distinct = [
      otp().sent,
      otp().codeInvalid,
      otp().codeExpired,
      otp().unavailable,
      copy.auth.login.credentialFailure,
      copy.auth.login.unavailable,
      copy.auth.register.unavailable,
    ];
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it("every new leaf is a trimmed, non-empty string without markup, and the buttons have distinct names", () => {
    const leaves = stringLeaves({
      method: copy.auth.method,
      code: copy.auth.field.otpCode,
      otp: copy.auth.otp,
    });
    expect(leaves).toHaveLength(6 + 2 + 9);
    for (const value of leaves) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
    }
    // getByRole name matching in the E2E suite is exact; these names must not collide with each other
    // or with the existing submit buttons.
    const names = [
      otp().send,
      otp().submitLogin,
      otp().submitRegister,
      otp().resend,
      otp().changeEmail,
      copy.auth.login.submit,
      copy.auth.register.submit,
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  // B5 C3 (tests/contracts/s6-auth.md section 1): Magic Link. The method label, the four action and result strings
  // and the dev stand-in's wording are literal; the rules about what they must not say are pinned separately.
  it("has the Magic Link method label, the send and resend actions and the result wording literally (SPEC-050 15.0)", () => {
    const m = copy;
    expect(m.auth.method.magicLink).toBe("メールで届くログインリンク");
    expect(m.auth.magicLink.send).toBe("ログインリンクを送る");
    expect(m.auth.magicLink.resend).toBe("ログインリンクを再送する");
    expect(m.auth.magicLink.sent).toBe(
      "ログインリンクを送信しました。メールに記載されたリンクを開いてください。リンクの有効期限は5分です",
    );
    expect(m.auth.magicLink.failed).toBe(
      "ログインリンクでの認証は完了しませんでした。リンクが無効か、期限が切れた可能性があります。ログインリンクを再送するか、別の方法を選んでください",
    );
    expect(m.auth.magicLink.unavailable).toBe(
      "ログインリンクを送信できません。時間をおいて、もう一度お試しください",
    );
    expect(m.auth.magicLink.signedIn).toBe(
      "ログイン中はログインリンクを使えません。別のアカウントで利用するには、ログアウトしてください",
    );
    expect(Object.keys(m.auth.magicLink).sort()).toEqual(
      ["failed", "resend", "send", "sent", "signedIn", "unavailable"].sort(),
    );
  });

  it("the Magic Link wording states the 5 minute validity only in the sent status, discloses no account, names how to continue and the Logout (SPEC-050 15.0, SEC-API-027)", () => {
    const m = copy.auth;
    // The sent status states the validity period of the link (SPEC-050 15.0: 5 minutes), and says nothing about whether
    // the address is registered.
    expect(m.magicLink.sent).toContain("5分");
    expect(m.magicLink.sent).not.toMatch(/登録|存在|場合/);
    expect(m.magicLink.sent).not.toMatch(/[<>]/);
    // Failure: a link that is invalid, expired or never arrived leaves the user unauthenticated with a next step.
    expect(m.magicLink.failed).toMatch(/再送/);
    expect(m.magicLink.failed).toMatch(/別の方法/);
    expect(m.magicLink.unavailable).toMatch(/できません/);
    expect(m.magicLink.signedIn).toMatch(/ログアウト/);
    for (const value of [
      m.method.magicLink,
      m.magicLink.send,
      m.magicLink.resend,
      m.magicLink.failed,
      m.magicLink.unavailable,
      m.magicLink.signedIn,
    ]) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
      expect(value, value).not.toMatch(/[0-9０-９]/);
      expect(value, value).not.toMatch(
        /登録されていません|存在しません|見つかりません|登録されている/,
      );
      expect(value, value).not.toMatch(/github|discord|\bline\b|\bapple\b/i);
    }
    // The status, the failure, the outage and the Logout hint are separate messages.
    const distinct = [
      m.magicLink.sent,
      m.magicLink.failed,
      m.magicLink.unavailable,
      m.magicLink.signedIn,
      copy.auth.otp.sent,
      copy.auth.otp.unavailable,
      copy.auth.google.failed,
      copy.auth.google.unavailable,
      copy.auth.google.signedIn,
      copy.auth.login.unavailable,
    ];
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it("the Magic Link buttons do not collide with any other button name and the method label differs from every other method label (exact name matching)", () => {
    const m = copy.auth;
    const others = [
      copy.auth.login.submit,
      copy.auth.register.submit,
      copy.auth.otp.send,
      copy.auth.otp.submitLogin,
      copy.auth.otp.submitRegister,
      copy.auth.otp.resend,
      copy.auth.otp.changeEmail,
      copy.auth.google.startLogin,
      copy.auth.google.startRegister,
    ];
    expect(new Set([m.magicLink.send, m.magicLink.resend, ...others]).size).toBe(others.length + 2);
    expect(
      new Set([
        copy.auth.method.password,
        copy.auth.method.google,
        copy.auth.method.emailOtp,
        m.method.magicLink,
      ]).size,
    ).toBe(4);
  });

  it("the dev stand-in for the link names its two actions literally and says it is a stand-in (DEV-WEB-012, DEV-WEB-013)", () => {
    const m = copy.mockMagicLink;
    expect(m.openValid).toBe("有効なリンクとして開く");
    expect(m.openExpired).toBe("期限切れのリンクとして開く");
    expect(m.emailLabel).toBe("リンクを開く利用者のメールアドレス");
    expect(m.pageTitle).toBe("ログインリンク（モック）");
    expect(m.heading).toBe("ログインリンクの代替モック。実際のメールは送信されません");
    expect(m.note).toBe(
      "ここで開くリンクは実際のメールのリンクではありません。選んだ結果に従って、元の画面へ戻ります",
    );
    expect(Object.keys(m).sort()).toEqual(
      ["emailLabel", "heading", "note", "openExpired", "openValid", "pageTitle"].sort(),
    );
    for (const value of Object.values(m)) {
      expect(value, value).toBe(value.trim());
      expect(value.length, value).toBeGreaterThan(0);
      expect(value, value).not.toMatch(/[<>]/);
    }
    expect(m.heading).toMatch(/モック|代替/);
    expect(m.pageTitle).toMatch(/モック/);
    expect(m.openValid).not.toBe(m.openExpired);
    // The stand-in's field label must not be the sign-in forms' email label (a stand-in is never mistaken for a form).
    expect(m.emailLabel).not.toBe(copy.auth.field.email.label);
    // No email address is written in the wording: the address comes from the developer's input.
    for (const value of Object.values(m)) expect(value, value).not.toMatch(/@/);
  });
});

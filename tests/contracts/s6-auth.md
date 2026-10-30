# S6 認証 契約書（PG-AUTH-001〜005 / Continuation Intent / AuthGate / Logout / no-store）

テスト担当が定義した S6 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/auth/*.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/auth-*.spec.ts`
- ハーネス: `tests/harness/browser/auth.ts`

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §3 AuthPort、§6、§7 Continuation、S6 行、Test plan U9 / U13 / E2E 3 / 24 後半 / Logout 後の back / header / no-store）、SPEC-050 v1.1.0 §7 / §8.2 / §8.3 / §9 / §10 / §15 / §22 / §25 / §26 / §31（3, 22, 24）/ §33、SPEC-060 §29（AR-CONT-001〜004）、AR-AUTH-006〜008、AR-SES-007 / 009、SPEC-140 SEC-WEB-009 / 013 / SEC-AUTH-016〜018 / SEC-API-027、SPEC-190 DEV-WEB-001〜013、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`。S1〜S5 の契約は**変更しない**（S2 の `AuthPort` / `mock-auth` / `session-store` / `password-policy`、S3 の `SessionProvider` / Header / `AccountMenu` は拡張のみ。既存 export の名前・シグネチャは変えない）。

共通の約束（S4 / S5 の約束を引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。`features/auth/**`、`src/auth/**` の新規ファイル、新規 `presentation/components/**` に**日本語の直書き・色の直書きを置かない**。
- route module（`src/routes/auth/**`。React Router）は薄い殻（`export const handle = { title }` だけ。route param は無い。`<main>` を描画しない）。画面は `"use client"` の container が `useAuth()`（下記 §3）経由の `AuthPort` だけを呼ぶ。`mock/**` を import しない（import してよいのは `src/auth/index.ts` だけ。DEV-WEB-012）。`mock-auth` を直接呼ばない。
- パスワード・reset context・verification context は**どこにも保存・記録・表示しない**（SEC-AUTH-018）: URL（成功後・失敗後とも）、DOM のテキスト、localStorage / sessionStorage、console、Cookie に出さない。`console.*` を使わない。パスワードは **trim しない**（SEC-AUTH-016）。`maxLength` 属性を付けない（付けると 129 文字目以降が黙って切り捨てられ、検証エラーが見えなくなる）。
- 各ページの `h1` は 1 つだけ。`main` 内の `role="alert"` は同時に 1 つだけ（route announcer は追加しない）。
- 認証 UI は Guest / Authenticated のどちらでも閲覧できる（Actor は SPEC-050 §7 のとおり）。**既に Authenticated でも自動 redirect はしない**（login 成功後の自身の遷移と競合するため。曖昧さ 3）。

## 0. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/auth/continuation.ts` | 純粋（react / next を import しない） | `CONTINUATION_PARAM`, `ContinuationKey`, `ContinuationIntent`, `CONTINUATION_KEYS`, `parseContinuation`, `serializeContinuation`, `continuationPath`, `continuationCancelPath`, `continuationForPath`, `isSafeRelativePath`, `accountPath`, `PROTECTED_PATH_PREFIXES` |
| `apps/web/src/auth/gate-decision.ts` | 純粋 | `GateDecision`, `decideGate` |
| `apps/web/src/auth/auth-gate.tsx` | client | `AuthGate`（props `{ children: ReactNode }`） |
| `apps/web/src/auth/use-auth.ts` | client hook | `useAuth(): AuthPort`（`SessionProvider` が保持する同じ `AuthPort` instance を返す。`SessionContextValue` に `auth: AuthPort` を**追加**する拡張。既存の `state` / `signOut` は変えない） |
| `apps/web/src/features/auth/form-validation.ts` | 純粋 | `FieldName`, `FieldErrorCode`, `FieldError`, `FormValidation`, `normalizeEmail`, `validateLoginForm`, `validateRegisterForm`, `validateResetRequestForm`, `validateResetCompleteForm`, `fieldErrorMessage`、B5 C1 で `validateOtpCodeForm` を追加（§4） |
| `apps/web/src/features/auth/continuation-view.ts` | 純粋 | `ContinuationNotice`, `describeContinuation` |
| `apps/web/src/features/auth/auth-methods.ts` | 純粋（B5 C1。§5A） | `AuthMethod`, `AUTH_METHODS`, `DEFAULT_AUTH_METHOD`, `authMethodLabel` |
| `apps/web/src/features/auth/method-selector.tsx` | client（B5 C1。§5A） | `MethodSelector`（radio group） |
| `apps/web/src/features/auth/email-otp-form.tsx` | client container（B5 C1。§6.1B） | `EmailOtpForm`（OTP の 2 step。Login / 登録で共用） |
| `apps/web/src/features/auth/auth-return.ts` | 純粋（B5 C2。§5B。react / mock を import しない） | `RETURNED_PARAM`, `externalReturnPath`, `externalFailurePath`, `parseReturned`, `parseFailureNotice`。【B5 C3】`method` 引数と戻り値に `"magic-link"` を加える（export 名は変えない） |
| `apps/web/src/features/auth/magic-link-form.tsx` | client container（B5 C3。§6.1D） | `MagicLinkForm`（email 入力、送信、送信状態、再送。Login / 登録で共用。port は `useAuth()` 経由だけ） |
| `apps/web/src/features/auth/google-sign-in.tsx` | client container（B5 C2。§6.1C） | `GoogleSignIn`（Google の開始 button。Login / 登録で共用。port は `useAuth()` 経由だけ） |
| `apps/web/src/features/auth/use-external-return.ts` | client hook（B5 C2） | 外部認証からの戻り（`returned` / `notice`）の処理。`completeExternalAuthentication` を呼び、`returned` を `replaceState` で除く |
| `apps/web/src/mock/dev-ui/mock-google-screen.tsx` | dev 専用の代わりの画面（B5 C2。§6.9。s2-mock-backend.md §14.2） | `MockGoogleScreen`（`mock-auth.ts` の `allowMockGoogleSignIn` を呼ぶ唯一の画面） |
| `apps/web/src/routes/dev/mock-google.tsx` | route（dev 専用。B5 C2） | `/dev/mock-google`。`handle.title = copy.mockGoogle.pageTitle`。薄い殻（`<main>` を描画しない）。route-table の `DevLayout` 配下に足す |
| `apps/web/src/mock/dev-ui/mock-magic-link-screen.tsx` | dev 専用の代わりの画面（B5 C3。§6.10。s2-mock-backend.md §14.3） | `MockMagicLinkScreen`（`mock-auth.ts` の `openMockMagicLink` を呼ぶ唯一の画面。受信箱の代わり） |
| `apps/web/src/routes/dev/mock-magic-link.tsx` | route（dev 専用。B5 C3） | `/dev/mock-magic-link`。`handle.title = copy.mockMagicLink.pageTitle`。薄い殻（`<main>` を描画しない）。route-table の `DevLayout` 配下に足す（合計 33 path） |
| `apps/web/src/features/auth/login-page.tsx` | client container | `LoginPage` |
| `apps/web/src/features/auth/register-page.tsx` | client container | `RegisterPage` |
| `apps/web/src/features/auth/email-verification-page.tsx` | client container | `EmailVerificationPage` |
| `apps/web/src/features/auth/password-reset-request-page.tsx` | client container | `PasswordResetRequestPage` |
| `apps/web/src/features/auth/password-reset-complete-page.tsx` | client container | `PasswordResetCompletePage` |
| `apps/web/src/presentation/components/form-field.tsx` | 純粋な表示部品 | `FormField` |
| `apps/web/src/presentation/components/error-summary.tsx` | 純粋な表示部品 | `ErrorSummary` |
| `apps/web/src/routes/auth/register.tsx` | route | PG-AUTH-001。`metadata.title = copy.auth.register.pageTitle` |
| `apps/web/src/routes/auth/email-verification.tsx` | route | PG-AUTH-002。`copy.auth.verify.pageTitle` |
| `apps/web/src/routes/auth/login.tsx` | route | PG-AUTH-003。`copy.auth.login.pageTitle` |
| `apps/web/src/routes/auth/password-reset.tsx` | route | PG-AUTH-004。`copy.auth.reset.pageTitle` |
| `apps/web/src/routes/auth/password-reset-complete.tsx` | route | PG-AUTH-005。`copy.auth.resetComplete.pageTitle` |
| `apps/web/src/routes/self/self-layout.tsx` | route layout | `AuthGate` で `children` を包む（Design §3 の `(self)/layout.tsx`）。`/mypage/*` と `/purchase/*` を覆う |
| `apps/web/src/routes/self/mypage-overview.tsx` | route | **S6 の最小 placeholder**（S8 が PG-MYP-001 に置き換える。`h1` と AuthGate の配下を保つ）。`metadata.title = copy.mypage.pageTitle` |

route module の位置は上の表のとおり。title は `copy.<...>.pageTitle` に置き、`copy.pageTitle` へ足さない（S4 の `s4-copy.test.ts` が全 key を固定している）。no-store ヘッダ（SEC-WEB-009。content-hash 付き asset の正規の path 以外の全応答。保護 6 prefix `/account`・`/auth`・`/purchase`・`/mypage`・`/admin`・`/staff` を含む）は `dist/_headers` の `/*` 規則（`scripts/generate-web-headers.mts` が生成。`tests/contracts/s9-finalize.md` §8）が付ける。`Referrer-Policy` は全応答で `no-referrer`（`/*` の 1 つだけで、連結しない）。

## 1. 文言 `copy`（`ja.ts` に追加。既存 key は変えない）

```ts
auth: {
  gate: {
    subject: "ログイン状態",
    redirecting: "ログイン画面へ移動しています",
  },
  form: {
    errorSummaryTitle: "入力内容を確認してください",
    submitting: "処理中です",
  },
  field: {
    email: {
      label: "メールアドレス",
      required: "メールアドレスを入力してください",
      invalidFormat: "メールアドレスの形式が正しくありません",
    },
    password: {
      label: "パスワード",
      hint: "12文字以上128文字以下で入力してください",
      required: "パスワードを入力してください",
      tooShort: "パスワードは12文字以上で入力してください",
      tooLong: "パスワードは128文字以下で入力してください",
    },
    passwordConfirm: {
      label: "パスワード（確認）",
      mismatch: "確認用のパスワードが一致しません",
    },
    newPassword: { label: "新しいパスワード" },
    newPasswordConfirm: { label: "新しいパスワード（確認）" },
    otpCode: {                                        // B5 C1
      label: "確認コード",
      required: "確認コードを入力してください",
    },
  },
  method: {                                           // B5 C1（方式選択。§5A / §6.1A）
    legendLogin: "ログイン方法",
    legendRegister: "登録方法",
    password: "メールアドレスとパスワード",
    emailOtp: "メールで届く確認コード",
    google: "Google",                                 // B5 C2（Google の radio のラベル）
    magicLink: "メールで届くログインリンク",              // B5 C3（Magic Link の radio のラベル。4 番目）
  },
  google: {                                           // B5 C2（Google。§6.1C / §6.2B）。数字・アカウントの有無を書かない
    startLogin: "Googleでログイン",
    startRegister: "Googleで登録",
    failed: "Googleでの認証は完了しませんでした。もう一度お試しいただくか、別の方法を選んでください",
    unavailable: "Googleでの認証を開始できません。時間をおいて、もう一度お試しください",
    signedIn: "ログイン中は Google でのログインを使えません。別のアカウントで利用するには、ログアウトしてください",
    sessionUnavailable: "ログイン状態を確認できないため、Google でのログインを開始できません。ページを再読み込みするか、時間をおいて、もう一度お試しください", // B5 レビュー F-4（SPEC-050 §25。§6.1C）
  },
  magicLink: {                                        // B5 C3（Magic Link。§6.1D / §6.2C）。アカウントの有無を書かない
    send: "ログインリンクを送る",
    resend: "ログインリンクを再送する",
    sent: "ログインリンクを送信しました。メールに記載されたリンクを開いてください。リンクの有効期限は5分です",
    failed: "ログインリンクでの認証は完了しませんでした。リンクが無効か、期限が切れた可能性があります。ログインリンクを再送するか、別の方法を選んでください",
    unavailable: "ログインリンクを送信できません。時間をおいて、もう一度お試しください",
    signedIn: "ログイン中はログインリンクを使えません。別のアカウントで利用するには、ログアウトしてください",
    sessionUnavailable: "ログイン状態を確認できないため、ログインリンクを送信できません。ページを再読み込みするか、時間をおいて、もう一度お試しください", // B5 レビュー F-4（SPEC-050 §25。§6.1D）
  },
  otp: {                                              // B5 C1（Email OTP。§6.1B）。有効期限・試行回数の数値を書かない
    send: "確認コードを送る",
    sent: "確認コードを送信しました。メールに記載されたコードを入力してください",
    submitLogin: "確認コードでログインする",
    submitRegister: "確認コードで登録する",
    resend: "確認コードを再送する",
    changeEmail: "メールアドレスを変更する",
    codeInvalid: "確認コードが正しくありません。もう一度入力してください",
    codeExpired: "確認コードの有効期限が切れたか、入力できる回数を超えました。確認コードを再送してください",
    unavailable: "確認コードを処理できません。時間をおいて、もう一度お試しください",
  },
  continuation: {
    notice: "この操作にはログインが必要です",
    returnAfter: "認証後に、元の操作へ戻ります",
    revalidate: "ログイン後に、販売状況や在庫などの現在の状態を確認し直します",
    purpose: {
      cart: "カートの購入手続き",
      karaokeSlot: "Karaoke Ticketの購入手続き",
      purchaseOrder: "購入状況の確認",
      mypage: "マイページの利用",
    },
  },
  register: {
    pageTitle: "アカウント登録",
    heading: "アカウント登録",
    submit: "アカウントを登録する",
    toLogin: "ログインへ",
    rejected: "アカウントを登録できませんでした。入力内容を確認してください",
    unavailable: "登録を完了できません。時間をおいて、もう一度お試しください",
  },
  verify: {
    pageTitle: "メールアドレスの確認",
    heading: "メールアドレスの確認",
    required: "確認メールのリンクを開いて、メールアドレスを確認してください",
    verifying: "メールアドレスを確認しています",
    verified: "メールアドレスを確認しました",
    invalid: "メールアドレスを確認できませんでした。リンクが無効か、期限が切れています",
    unavailable: "確認結果を取得できません。時間をおいて、もう一度お試しください",
    retry: "もう一度確認する",
    toLogin: "ログインへ進む",
    continue: "続きへ進む",
  },
  login: {
    pageTitle: "ログイン",
    heading: "ログイン",
    submit: "ログイン",
    credentialFailure: "メールアドレスまたはパスワードが正しくありません。ログインできませんでした",
    unavailable: "ログインを完了できません。時間をおいて、もう一度お試しください",
    toPasswordReset: "パスワードをお忘れの方",
    toRegister: "アカウント登録へ",
    cancel: "ログインせずに戻る",
    passwordUpdated: "パスワードを更新しました。新しいパスワードでログインしてください",
  },
  reset: {
    pageTitle: "パスワードの再設定",
    heading: "パスワードの再設定",
    submit: "再設定の案内を送る",
    accepted: "入力されたメールアドレスが登録されている場合、パスワード再設定の案内を送信しました",
    unavailable: "再設定を要求できませんでした。時間をおいて、もう一度お試しください",
    backToLogin: "ログインへ戻る",
  },
  resetComplete: {
    pageTitle: "新しいパスワードの設定",
    heading: "新しいパスワードの設定",
    submit: "パスワードを更新する",
    invalid: "再設定のリンクが無効か、期限が切れています",
    requestAgain: "再設定の案内をもう一度送る",
    unavailable: "パスワードを更新できませんでした。時間をおいて、もう一度お試しください",
  },
},
mypage: {
  pageTitle: "マイページ",
  heading: "マイページ",
  protectedMarker: "ログイン中の方だけに表示される内容です",   // S6 placeholder。S8 が置き換えてよい
},
mockGoogle: {                                         // B5 C2（dev 専用の代わりの画面。§6.9。copy.mockCheckout と同じ階層）
  pageTitle: "Google認証（モック）",
  heading: "Googleの代替モック。実際の認証は行われません",
  note: "ここで押すボタンでは実際のGoogleアカウントは使われません。選んだ結果に従って、元の画面へ戻ります",
  allowDemo: "demo@example.com として許可",
  allowNew: "新しいアカウント（google.new@example.com）として許可",
  cancel: "キャンセル",
},
mockMagicLink: {                                      // B5 C3（dev 専用の代わりの画面。§6.10。受信箱の代わり）
  pageTitle: "ログインリンク（モック）",
  heading: "ログインリンクの代替モック。実際のメールは送信されません",
  note: "ここで開くリンクは実際のメールのリンクではありません。選んだ結果に従って、元の画面へ戻ります",
  emailLabel: "リンクを開く利用者のメールアドレス",
  openValid: "有効なリンクとして開く",
  openExpired: "期限切れのリンクとして開く",
},
```

- 既存 `copy.test.ts` の制約（全 leaf は trim 済みの非空 string か関数）を守る。上記の文字列は**そのまま**使う（`s6-copy.test.ts` が固定する）。
- `copy.auth.login.credentialFailure` は「どの要素が一致したか」を示さない（SPEC-050 §15.3、SEC-API-027）。`copy.auth.reset.accepted` は Account の有無を断定せず「場合」を含む。`copy.auth.verify.invalid` は `copy.auth.verify.verified` の文字列を**含まない**（確認済みと誤読させない）。
- `copy.pageState.unavailable` / `retry`（S1）は AuthGate の unavailable 表示で再利用する。
- 【B5 C2】`copy.auth.method` の key は `legendLogin` / `legendRegister` / `password` / `emailOtp` / `google`（C3 が `magicLink` を足す）。`copy.auth.google` の key は `startLogin` / `startRegister` / `failed` / `unavailable` / `signedIn` の 5 つ（【B5 レビュー F-4】`sessionUnavailable` を足して 6 つ。下の bullet）だけ。`startLogin` と `startRegister` は文字列そのまま（`s6-copy.test.ts` が固定）。`failed` は「もう一度」と「別の方法」を含み、`signedIn` は「ログアウト」を含み、`unavailable` は「できません」を含む。5 つと `copy.auth.method.google` は数字・`<` `>` を含まず、互いに異なり（`failed` / `unavailable` / `signedIn` / `startLogin` / `startRegister`）、Account の有無を示す語（「登録されていません」「存在しません」「見つかりません」「登録されている」）を含まない。`startLogin` / `startRegister` は他の button 名（`login.submit` / `register.submit` / `otp.*`）と異なる。`copy.mockGoogle` の key は `pageTitle` / `heading` / `note` / `allowDemo` / `allowNew` / `cancel` の 6 つだけ。`allowDemo` / `allowNew` / `cancel` は文字列そのまま。`pageTitle` と `heading` は「モック」または「代替」を含み、実在のメールアドレスは `@example.com` の 1 つだけ。
- 【B5 C3】`copy.auth.method` の key は `legendLogin` / `legendRegister` / `password` / `emailOtp` / `google` / `magicLink` の 6 つ。`copy.auth.magicLink` の key は `send` / `resend` / `sent` / `failed` / `unavailable` / `signedIn` の 6 つだけ。6 つと `copy.auth.method.magicLink` は文字列そのまま（`s6-copy.test.ts` が固定）。`sent` は「5分」（仕様 SPEC-050 §15.0「Linkは5分有効」）を含み、Account の有無を示す語（「登録」「存在」「見つかりません」）を含まない。`failed` は「再送」と「別の方法」を含む（無効・期限切れ・不達を区別せず、「可能性があります」で述べる）。`signedIn` は「ログアウト」を含み、`unavailable` は「できません」を含む。`sent` 以外の `copy.auth.magicLink.*` と `copy.auth.method.magicLink` は数字・`<` `>` を含まず、Account の有無を示す語（「登録されていません」「存在しません」「見つかりません」「登録されている」）と GitHub / Discord / LINE / Apple の語を含まない。`send` / `resend` は互いに、また他の button 名（`login.submit` / `register.submit` / `otp.*` / `google.start*`）と異なり、4 つの方式ラベルも互いに異なる（`getByRole` の exact 照合が衝突しないため）。`sent` / `failed` / `unavailable` / `signedIn` は互いに異なり、`otp.sent` / `otp.unavailable` / `google.*` / `login.unavailable` とも異なる。`copy.mockMagicLink` の key は `pageTitle` / `heading` / `note` / `emailLabel` / `openValid` / `openExpired` の 6 つだけ。6 つは文字列そのまま。`pageTitle` と `heading` は「モック」または「代替」を含み、`openValid` と `openExpired` は互いに異なり、`emailLabel` は `copy.auth.field.email.label` と異なる（代わりの画面を実フォームと取り違えない）。どれも `<` `>` と `@`（実在のメールアドレス）を含まない。
- 【B5 レビュー F-4】`copy.auth.google.sessionUnavailable` と `copy.auth.magicLink.sessionUnavailable`（上の listing の文字列そのまま。`s6-copy.test.ts` が固定）を足す。したがって `copy.auth.google` の key は 6 つ、`copy.auth.magicLink` の key は 7 つ。Session を確認できない（`unavailable`）ために開始 / 送信が無効なとき、その理由を button の周辺 text で示す文言（SPEC-050 §25「Disabled Actionは理由を周辺Textで示す」）。「ログイン状態を確認できない」と「再読み込み」を含み、「ログアウト」を含まない（利用者が Authenticated とは限らない。`signedIn` の文言ではない）。数字・`<` `>`・Account の有無を示す語（「登録されていません」「存在しません」「見つかりません」「登録されている」）・GitHub / Discord / LINE / Apple の語を含まず、前後の空白が無い。Google 側と Magic Link 側は互いに異なり、`google.*` / `magicLink.*` / `otp.*` / `login.unavailable` / `register.unavailable` の他のどの文言とも異なる。
- 【B5 C1】`copy.auth.otp.sent` は Account の有無（登録・存在・「場合」）に触れない（SEC-API-027）。`copy.auth.otp.*` は数字と「N分 / N秒 / N回 / N桁」を含まない（有効期限・試行回数は provider の値で、Production gate で確認する）。`codeInvalid` は「再送」を含まず、`codeExpired` は含む。`sent` / `codeInvalid` / `codeExpired` / `unavailable` と既存の `login.credentialFailure` / `login.unavailable` / `register.unavailable` は互いに異なる。新しい button 名（`send` / `submitLogin` / `submitRegister` / `resend` / `changeEmail`）は互いに、また `login.submit` / `register.submit` と異なる（`getByRole` の exact 照合が衝突しないため）。`copy.auth.method.*` に GitHub / Discord / LINE / Apple の語を置かない。

## 2. Continuation（`src/auth/continuation.ts`。純粋）

```ts
export const CONTINUATION_PARAM = "continue";
export type ContinuationKey =
  | "cart" | "karaoke-slot" | "purchase-order"
  | "mypage" | "mypage-profile" | "mypage-orders" | "mypage-order"
  | "mypage-entry-tickets" | "mypage-entry-ticket"
  | "mypage-karaoke" | "mypage-reservation"
  | "mypage-goods" | "mypage-goods-item";
export type ContinuationIntent = { readonly key: ContinuationKey; readonly ref: string | null };
export const CONTINUATION_KEYS: readonly ContinuationKey[];       // 上の 13 個（この順）
export const PROTECTED_PATH_PREFIXES: readonly string[];          // ["/mypage", "/purchase"]
export function parseContinuation(raw: string | null | undefined): ContinuationIntent | null;
export function serializeContinuation(intent: ContinuationIntent): string;
export function continuationPath(intent: ContinuationIntent): string;
export function continuationCancelPath(intent: ContinuationIntent | null): string;
export function continuationForPath(pathname: string): ContinuationIntent | null;
export function isSafeRelativePath(path: unknown): boolean;
export function accountPath(
  page: "login" | "register" | "email-verification" | "password-reset",
  intent: ContinuationIntent | null,
): string;
```

key と path の対応（ref は canonical lowercase UUID `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`）:

| key | ref | path |
|---|---|---|
| `cart` | なし | `/cart` |
| `karaoke-slot` | 必須 | `/karaoke/slots/{ref}` |
| `purchase-order` | 必須 | `/purchase/orders/{ref}` |
| `mypage` | なし | `/mypage` |
| `mypage-profile` | なし | `/mypage/profile` |
| `mypage-orders` | なし | `/mypage/orders` |
| `mypage-order` | 必須 | `/mypage/orders/{ref}` |
| `mypage-entry-tickets` | なし | `/mypage/entry-tickets` |
| `mypage-entry-ticket` | 必須 | `/mypage/entry-tickets/{ref}` |
| `mypage-karaoke` | なし | `/mypage/karaoke` |
| `mypage-reservation` | 必須 | `/mypage/karaoke/{ref}` |
| `mypage-goods` | なし | `/mypage/goods` |
| `mypage-goods-item` | 必須 | `/mypage/goods/{ref}` |

QR ページ（`.../qr`）の key は**ない**（QR は復帰先にしない。SEC-QR-012 / 013。曖昧さ 2）。

- `parseContinuation(raw)`: `raw` が `null` / `undefined`（`continue` が無い）→ `null`（intent なし）。文字列で、`<key>`（ref なしの key）または `<key>:<canonical uuid>`（ref ありの key）に**厳密に**一致すれば `{ key, ref }`。それ以外（空文字、大文字小文字違い、前後の空白、未知の key、ref が必要な key で ref なし、不要な key に ref あり、非 canonical UUID、`:` が 2 個以上、scheme 付き URL、`//`、path、`/admin` 等、percent-encoding 付きの変形）は **`{ key: "mypage", ref: null }`**（不正な値は mypage 扱い。Design §7）。**例外を throw しない**。
- `serializeContinuation`: `ref === null` → `key`、それ以外 → `key:ref`。`parseContinuation(serializeContinuation(i))` は `i` と等しい（全 key で往復する）。
- `continuationPath(intent)`: 上表の path。組み立てたあと `isSafeRelativePath` で再検査し、通らなければ `"/mypage"`（SEC-WEB-013「最終 redirect 前に再 parse」）。`ref` が必要なのに不正な intent（型を破った入力）も `"/mypage"`。
- `continuationCancelPath(intent)`: 認証をやめたときの戻り先。`cart` → `/cart`、`karaoke-slot` → `/karaoke/slots/{ref}`、それ以外（`null` を含む）→ `/`。
- `continuationForPath(pathname)`: AuthGate 用の逆引き（保護された path だけ。公開 path の `cart` / `karaoke-slot` の path も `null`）。`PROTECTED_PATH_PREFIXES` のどれか（`/mypage` / `/purchase` と一致、または `/mypage/…` / `/purchase/…`）でなければ `null`。保護された path は、上表に完全一致するなら対応する intent、一致しない保護 path（`/mypage/entry-tickets/{uuid}/qr`、`/mypage/unknown`、`/purchase/orders`（ref なし）、末尾 `/` や query / hash 付き、ref が非 canonical）は `{ key: "mypage", ref: null }`。query / hash は無視して path 部分だけで判定する（`/mypage/orders?x=1` → `mypage-orders`）。
- `isSafeRelativePath(path)`（SEC-WEB-013 の全拒否条件）: 文字列でない、空、`/` で始まらない、`//` で始まる、backslash（`\`）を含む、control character（U+0000〜U+001F、U+007F）を含む、scheme を持つ（`^[A-Za-z][A-Za-z0-9+.-]*:` に一致。`/` で始まらないので上の条件で落ちる）、username / password component（`@` が authority 位置に来る形。`/` で始まらないか `//` で始まるので上の条件で落ちる）、**percent decode を安定するまで繰り返し（最大 3 回）、いずれかの段階で上記の禁止形になる値**、decode できない（不正な percent-encoding）値、decode 後に `.` / `..` の segment を含む値、decode 後の path の最初の segment が `admin` または `staff`（大文字小文字を区別しない。`/admin`、`/admin/x`、`/ADMIN`、`/%61dmin`、`/Staff/y`）である値、は `false`。それ以外の `/` で始まる同一 origin の path（`/cart`、`/mypage/orders/{uuid}`、`/entry?x=1`）は `true`。
- `accountPath(page, intent)`: `/account/{page}`。`intent !== null` のとき `?continue=` + `encodeURIComponent(serializeContinuation(intent))`（`URLSearchParams` で読むと `serializeContinuation(intent)` に戻る）。`intent === null` は query なし。
- 価格・金額・数量・在庫・販売可否・Owner・Role・token・成功結果は `ContinuationIntent` に**含められない**型である（key と公開 ref だけ。AR-CONT-001 / 002、SPEC-050 §10.3）。Cart の内容（参照と数量）は Intent に入れない（Cart は Browser 側の Cart が保持する）。

## 3. AuthGate / `decideGate` / `useAuth`

```ts
export type GateDecision =
  | { kind: "loading" }
  | { kind: "allow" }
  | { kind: "unavailable" }
  | { kind: "redirect"; reason: "guest" | "email_unverified"; to: string };
export function decideGate(state: SessionState, pathname: string): GateDecision;
```

- `state.status === "loading"` → `loading`。`"unavailable"` → `unavailable`（Session を確認できないとき Authenticated とも Guest とも扱わない）。
- `ready` + `guest` → `redirect`、`reason: "guest"`、`to = accountPath("login", continuationForPath(pathname) ?? { key: "mypage", ref: null })`。
- `ready` + `authenticated` かつ `emailVerified === false` → `redirect`、`reason: "email_unverified"`、`to = accountPath("email-verification", <同じ intent>)`。
- `ready` + `authenticated` かつ `emailVerified === true` → `allow`。
- 入力を変更しない。

`AuthGate`（`"use client"`。`src/routes/self/self-layout.tsx` が `children` を包む）:

- `useSession()` と `usePathname()` から `decideGate` を求める。**`allow` のときだけ `children` を描画する**。`loading` / `redirect` / `unavailable` の間は保護 Content を DOM に出さない（最初の描画は常に `loading`。SSR を含む）。
- `loading`: `role="status"` + `copy.pageState.loading`。`redirect`: `role="status"` + `copy.auth.gate.redirecting` を描画し、`useEffect` で `router.replace(to)`。`unavailable`: `role="alert"` + `copy.pageState.unavailable(copy.auth.gate.subject)` + `<button type="button">` `copy.pageState.retry`（`window.location.reload()`。Login へ redirect しない）。
- Session が変わったとき（同じ tab の Logout、他 tab の変更 = `storage` event）に再評価される（`SessionProvider` が既に購読している。AuthGate は state の変化に従う）。
- `pageshow` イベントで `event.persisted === true`（bfcache 復帰）のとき、`window.location.reload()` で Session を確かめ直す（SPEC-050 §15.6、Design §7）。
- **Logout との競合**: Account menu の Logout（`SessionProvider.signOut`）は `PG-PUB-001`（`/`）へ遷移して終わる。AuthGate が authenticated → guest の変化を見て `router.replace(login)` を後から行い、`/` への遷移を上書きしてはならない（Logout 後の最終 URL は `/`）。実装方法は任意（coder 判断）。

`useAuth()`: `SessionContext` の値に `auth: AuthPort` を足し、画面 container は `useAuth()` だけで port を得る。画面 container が `createAuthPort()` を直接呼ばない（`SessionProvider` と同じ instance を使う。`onSessionChange` が同じ listener 集合に届くため）。

## 3A. AuthPort の Email OTP（B5 C1。`src/auth/port.ts`、`cart-lifecycle-auth-port.ts`、`mock-auth.ts`）

`AuthPort` に次の 2 method を**加える**（既存 8 method は変えない。合計 10。Neon Auth の transport であり、業務の Operation ID は無い。SPEC-110 §23.1）。

```ts
requestEmailOtp(input: { email: string }): Promise<
  | { kind: "sent" }
  | { kind: "unavailable" }
  | { kind: "cart_busy" }
  | { kind: "cart_blocked" }>;
signInWithEmailOtp(input: { email: string; code: string }): Promise<
  | { kind: "signed_in"; emailVerified: boolean }
  | { kind: "code_invalid" }
  | { kind: "code_expired" }
  | { kind: "unavailable" }
  | { kind: "cart_busy" }
  | { kind: "cart_blocked" }>;
```

- `port.ts` の注釈に、2 method が Neon Auth の transport で業務 Operation ID を持たないこと、`requestEmailOtp` は Account の有無を開示しないこと（SEC-API-027）、`signInWithEmailOtp` はコードを保持しないこと（SEC-AUTH-018）と `code_expired` が期限切れと試行回数超過を含むことを書く（`ports.test.ts` が固定）。
- mock（`mock-auth.ts`）: `s2-mock-backend.md` §14。Cart lifecycle decorator（`createCartLifecycleAuthPort`）: `signInWithEmailOtp` は `signIn` と同じ規則（FR-CRT-012）で包む。成功（`signed_in`、`emailVerified` が false でも）で Guest Cart を維持して由来 `authenticated` を記録し、由来が `authenticated` / 不明の Cart を clear する。失敗（`code_invalid` / `code_expired` / `unavailable`）と raw の reject は Cart を変えない。遷移中（lifecycle、他 Tab の Web Lock、この port 自身の実行中）は `cart_busy`、Cart キーを読めないとき（Q-1）は `cart_blocked`。いずれも raw を呼ばず storage を変えない。`requestEmailOtp` は Cart が準備済みなら raw を 1 回呼んで結果をそのまま返し、Cart / metadata に書かない。busy / blocked では raw を呼ばない。raw の session 通知は Cart の cleanup のあとに公開する。
- `useAuth()` は同じ instance を返す（新しい method も含む）。

## 3B. AuthPort の Google（B5 C2。`src/auth/port.ts`、`cart-lifecycle-auth-port.ts`、`mock-auth.ts`）

`AuthPort` に次の 1 method を**加える**（既存 10 method は変えない。合計 11。Neon Auth の transport であり、業務の Operation ID も API ID も無い。SPEC-110 §23.1。UCR を参照しない）。

```ts
startGoogleSignIn(input: { successPath: string; failurePath: string }): Promise<
  | { kind: "redirect"; url: string }
  | { kind: "unavailable" }
  | { kind: "already_signed_in" }
  | { kind: "cart_busy" }
  | { kind: "cart_blocked" }>;
```

- `port.ts` の注釈（`startGoogleSignIn(` の宣言の直前に連続するコメント）に、Neon Auth の transport で業務 Operation ID を持たないこと（`SPEC-110 23.1`）、`redirect` の `url` は same origin の相対 path で、利用者はこの URL へ**ページ全体の遷移**で移ること、認証の成否（outcome）はこの promise の結果ではなく**戻った画面で判断する**こと、`successPath` / `failurePath` は PG-AUTH-003 / PG-AUTH-001 の path に限ること（`AR-CONT-001`、`SEC-WEB-013`）を書く。`ports.test.ts` は `Neon Auth`、`23.1`、`Operation ID`、`outcome`、`same origin`、`AR-CONT-001`、`SEC-WEB-013` の語を要求し、`API-<…>-NNN` 形式の ID と `UCR-` を禁じる。
- 渡す 2 つの path は `auth-return.ts`（§5B）が作る。`successPath` は Google の成功の戻り（`returned=google`）、`failurePath` は取消・失敗の戻り（`notice=google-failed`）。
- mock（`mock-auth.ts`）: `s2-mock-backend.md` §14.2。DB・session・storage を変えない（開始は何も成立させない）。
- Cart lifecycle decorator（`createCartLifecycleAuthPort`）の規則（FR-CRT-012 の外部完了認証の規則。§10A の対応表）。順に判定する:
  1. Session を確認できない（`getSession` が `unavailable`）→ `{ kind: "unavailable" }`。raw を呼ばず、何も書かない。
  2. Session が `authenticated`（`emailVerified` が false でも）→ `{ kind: "already_signed_in" }`。raw を呼ばず、storage を変えない（手順 1。Email 未確認の Session を持つ利用者は Guest ではない）。
  3. 遷移中（lifecycle の遷移、他 Tab の Web Lock、この port 自身の実行中の `signIn` 等）→ `{ kind: "cart_busy" }`。Cart キーを読めない・lifecycle が停止中・孤立した遷移記録・Lock を取れない → `{ kind: "cart_blocked" }`（Q-1）。いずれも raw を呼ばず、storage を変えない。**待たずに**返す。
  4. それ以外は `lifecycle.beginExternalAuthentication()` を呼ぶ。`blocked` → `cart_blocked`、`busy` → `cart_busy`（raw を呼ばない）。`ready` なら、**raw の `startGoogleSignIn` を呼ぶ前に**、metadata の `external: "pending"` を書き、由来不明・`authenticated` の Cart を clear しておく（手順 2・3。Guest 由来の Cart は保持）。
  5. raw の結果（`redirect` / `unavailable`）をそのまま返す。raw が `unavailable` を返しても、reject しても、`external` は `"pending"` のまま残り、clear した Cart は戻さない（手順 3、7）。
- Browser storage 自体を取得できない場合は decorator を通らず（`createCartLifecycleAuthPort` が lifecycle を持たない）、記録を作らない。raw をそのまま呼ぶ（開始を妨げない。手順 2 の最後の文。TC-FR-CRT-012-018）。
- `useAuth()` は同じ instance を返す（`startGoogleSignIn` も含む）。

## 3C. AuthPort の Magic Link（B5 C3。`src/auth/port.ts`、`cart-lifecycle-auth-port.ts`、`mock-auth.ts`）

`AuthPort` に次の 1 method を**加える**（既存 11 method は変えない。合計 12。Neon Auth の transport であり、業務の Operation ID も API ID も無い。SPEC-110 §23.1。UCR を参照しない）。Magic Link は 2 つ目の外部完了認証である（Google との違い: 利用者はページを離れず、リンクは**あとで**この Tab・他の Tab・他の端末のどれでも開かれる）。

```ts
requestMagicLink(input: { email: string; successPath: string; failurePath: string }): Promise<
  | { kind: "sent" }
  | { kind: "unavailable" }
  | { kind: "already_signed_in" }
  | { kind: "cart_busy" }
  | { kind: "cart_blocked" }>;
```

- `port.ts` の注釈（`requestMagicLink(` の宣言の直前に連続するコメント）に、Neon Auth の transport で業務 Operation ID を持たないこと（`SPEC-110 23.1`）、`sent` は Account の有無を開示しないこと（`SEC-API-027`）、リンクは画面の外（メール）で開かれ、認証の成否（outcome）はこの promise の結果ではなく**リンクを開いて表示された画面で判断する**こと、`successPath` / `failurePath` は PG-AUTH-003 / PG-AUTH-001 の path に限ること（same origin の相対 path。`AR-CONT-001`、`SEC-WEB-013`）を書く。`ports.test.ts` は `Neon Auth`、`23.1`、`Operation ID`、`SEC-API-027`、`outcome`、`same origin`、`AR-CONT-001`、`SEC-WEB-013` の語を要求し、`API-<…>-NNN` 形式の ID と `UCR-` を禁じる。
- 渡す 2 つの path は `auth-return.ts`（§5B）が作る。`successPath` は有効なリンクの戻り（`returned=magic-link`）、`failurePath` は無効・期限切れのリンクの戻り（`notice=link-failed`）。mock の代わりの画面（§6.10）はこの 2 つを URL で受け取る。`email` は `normalizeEmail` 済みで、path・metadata・storage・URL・console に出さない。
- mock（`mock-auth.ts`）: `s2-mock-backend.md` §14.3。**送信は何も成立させない**（DB・session・storage を変えない。登録済み・未確認・未登録の email で同じ `sent`）。
- Cart lifecycle decorator（`createCartLifecycleAuthPort`）の規則は Google（§3B）と同じ判定順で、`startGoogleSignIn` を `requestMagicLink` に読み替える: ① Session を確認できない → `unavailable`（raw を呼ばない）、② Session が `authenticated`（未確認を含む）→ `already_signed_in`（raw を呼ばず storage を変えない）、③ 遷移中 → `cart_busy`、Cart キー不読・lifecycle 停止・孤立した遷移記録・Lock 不可 → `cart_blocked`（raw を呼ばず storage を変えない。待たずに返す）、④ それ以外は `beginExternalAuthentication()`（`blocked` → `cart_blocked`、`busy` → `cart_busy`）→ **raw の `requestMagicLink` を呼ぶ前に** `external: "pending"` を書き、由来不明・`authenticated` の Cart を clear（Guest 由来は保持）、⑤ raw の結果（`sent` / `unavailable`）をそのまま返す。raw が `unavailable` を返しても reject しても `external` は `"pending"` のまま残り、clear した Cart は戻さない。**再送**は新しい開始として同じ手順を踏み、記録を置き換える（手順 3）。email は metadata に入らない。
- Browser storage 自体を取得できない場合は decorator を通らず、記録を作らない。raw をそのまま呼ぶ（開始を妨げない。TC-FR-CRT-012-018）。
- `useAuth()` は同じ instance を返す（`requestMagicLink` も含む）。

## 4. フォーム検証（`features/auth/form-validation.ts`。純粋。U13）

```ts
export type FieldName = "email" | "password" | "passwordConfirm";
export type FieldErrorCode = "required" | "invalid_format" | "too_short" | "too_long" | "mismatch";
export type FieldError = { readonly field: FieldName; readonly code: FieldErrorCode };
export type FormValidation = { ok: true } | { ok: false; errors: readonly FieldError[] };
export const normalizeEmail = (raw: string): string => raw.trim();
export function validateLoginForm(i: { email: string; password: string }): FormValidation;
export function validateRegisterForm(i: { email: string; password: string; passwordConfirm: string }): FormValidation;
export function validateResetRequestForm(i: { email: string }): FormValidation;
export function validateResetCompleteForm(i: { password: string; passwordConfirm: string }): FormValidation;
export function fieldErrorMessage(error: FieldError): string;
```

- **Email**: `normalizeEmail`（前後の空白だけを除く）した値で判定。空 → `required`、`/^[^@\s]+@[^@\s]+$/` に一致しない → `invalid_format`。Port へ渡す email も `normalizeEmail` 済みの値。
- **Password（Login）**: 空文字 → `required` だけ。**長さの検査をしない**（既存の Password を弾かない。SEC-AUTH-016 は新規設定 / reset 時）。空白だけの Password も空ではない（trim しない）。
- **Password（Register / ResetComplete）**: 空文字 → `required`。それ以外は `validatePassword`（S2、Unicode code point 数、12〜128、trim・正規化なし）で `too_short` / `too_long`。**固定の複雑性 rule を足さない**（SEC-AUTH-017）。11 文字 → `too_short`、12 / 128 文字 → ok、129 文字 → `too_long`、空白だけ 12 文字 → ok。
- **passwordConfirm**: `passwordConfirm !== password`（trim しない厳密比較）なら `mismatch`。両方空なら confirm のエラーは出さない（Password の `required` だけ）。
- `errors` は **field の順（email → password → passwordConfirm）** で、1 field に 1 つまで。全て問題なければ `{ ok: true }`。入力を変更しない。
- `fieldErrorMessage`: `email` の `required` / `invalid_format` → `copy.auth.field.email.required` / `.invalidFormat`、`password` の `required` / `too_short` / `too_long` → `copy.auth.field.password.required` / `.tooShort` / `.tooLong`、`passwordConfirm` の `mismatch` → `copy.auth.field.passwordConfirm.mismatch`。上記以外の組み合わせは `RangeError`。
- 【B5 C1】`FieldName` に `"code"` を加える（`FieldErrorCode` は変えない）。`validateOtpCodeForm(i: { code: string }): FormValidation` を加える。code が空または空白だけ（空白・tab・全角空白・改行）なら `[{ field: "code", code: "required" }]`、それ以外は `{ ok: true }`。**桁数・数字・形式の規則を持たない**（provider の規則を複製しない）。入力を echo せず変更しない。`fieldErrorMessage({ field: "code", code: "required" })` は `copy.auth.field.otpCode.required`、`code` の他の `code` は `RangeError`。既存の対応は変えない。OTP の email step は `validateResetRequestForm` で検証する。

## 5. Continuation 表示（`features/auth/continuation-view.ts`。純粋）

```ts
export type ContinuationNotice = {
  notice: string; purposeLabel: string; returnAfter: string; revalidate: string;
};
export function describeContinuation(intent: ContinuationIntent | null): ContinuationNotice | null;
```

- `null` → `null`（通常の Login / 登録。案内を出さない）。
- それ以外 → `notice = copy.auth.continuation.notice`、`returnAfter = copy.auth.continuation.returnAfter`、`revalidate = copy.auth.continuation.revalidate`、`purposeLabel` は key で決める: `cart` → `purpose.cart`、`karaoke-slot` → `purpose.karaokeSlot`、`purchase-order` → `purpose.purchaseOrder`、`mypage*`（`mypage` で始まる 8 つ）→ `purpose.mypage`。価格・数量・Slot の日時など key 以外の情報を含めない（SPEC-050 §15.3「安全な一般名称」）。

## 5A. 認証方式の一覧（B5 C1。`features/auth/auth-methods.ts`。純粋）

```ts
export type AuthMethod = "password" | "google" | "email-otp" | "magic-link";
export const AUTH_METHODS: readonly AuthMethod[];        // C3: ["password", "google", "email-otp", "magic-link"]（この順。ちょうど 4 つ）
export const DEFAULT_AUTH_METHOD: AuthMethod;            // "password"（AUTH_METHODS[0]）
export function authMethodLabel(method: AuthMethod): string;
```

- `authMethodLabel("password")` = `copy.auth.method.password`、`"email-otp"` = `copy.auth.method.emailOtp`、`"google"` = `copy.auth.method.google`、`"magic-link"` = `copy.auth.method.magicLink`。ラベルは互いに異なる。GitHub / Discord / LINE / Apple の方式を持たない（SPEC-050 §15.0）。
- 仕様の順序は Email+Password、Google、Email OTP、Magic Link（SPEC-050 §15.0）。【B5 C3】`AUTH_METHODS` は**ちょうど** `["password", "google", "email-otp", "magic-link"]`（この順。TC-PG-AUTH-003-212）で、E2E の `expectMethodRadios` も**ちょうど 4 つ**の radio（`password`、`google`、`emailOtp`、`magicLink` の順）を要求する（C2 までの「あれば 4 つ目」の受け入れは外した）。矢印キーはこの順に進む（TC-PG-AUTH-003-305）。
- `features/auth/method-selector.tsx`（client。`MethodSelector`）: `<fieldset>` + `<legend>`（props で受ける）+ `AUTH_METHODS` を `type="radio"` の `<input>` と `<label>` で描画する。`useId` で id を作る。focus を動かさない（`autoFocus` / `.focus()` を使わない）。port・`fetch`・storage・`console` を使わない。`features/auth/email-otp-form.tsx`（client。`EmailOtpForm`）は §6.1B の OTP 2 step を担い、port は `useAuth()` 経由だけで呼ぶ。

## 5B. 外部完了認証の戻り path（B5 C2。`features/auth/auth-return.ts`。純粋）

外部サービスで認証する方式（Google と Magic Link）は、PG-AUTH 画面（Login または登録）へ、ページ全体の遷移で戻る（SPEC-050 §15.0）。Google は開始した画面と**同じ画面**へ、Magic Link は**リンクを開いて表示された画面**（`successPath` / `failurePath` の画面。リンクの送信に使った画面と同じ page）へ戻る。戻り先は固定の語だけで作り、email・token・code・識別子を含めない（SEC-AUTH-018、SEC-WEB-013）。

```ts
export const RETURNED_PARAM = "returned";                      // 成功の戻りの query 名
type ExternalMethod = "google" | "magic-link";                 // C3 が "magic-link" を足す
export function externalReturnPath(
  method: ExternalMethod, page: "login" | "register", intent: ContinuationIntent | null): string;
export function externalFailurePath(
  method: ExternalMethod, page: "login" | "register", intent: ContinuationIntent | null): string;
export function parseReturned(raw: string | null | undefined): ExternalMethod | null;
export function parseFailureNotice(raw: string | null | undefined): ExternalMethod | null;
```

- `externalReturnPath("google", page, intent)` = `accountPath(page, intent)` + （`intent === null` なら `?`、そうでなければ `&`）+ `returned=google`。例: `/account/login?continue=cart&returned=google`、`/account/register?returned=google`。`externalFailurePath` は末尾が `notice=google-failed`（`returned` を付けない）。どちらも `isSafeRelativePath` を通り、pathname は `/account/login` または `/account/register`、`continue` は intent の `serializeContinuation` と同じ値のまま（`parseContinuation` で同じ intent に戻る）。query は `continue` と、`returned` または `notice` の 2 つだけ。`@` `token` `secret` `code=` `password` `session` `email` のどれも含まない。
- `parseReturned(raw)`: 厳密に `"google"` のときだけ `"google"`。それ以外（`null`、`undefined`、空、大文字小文字違い、前後の空白、`google,google`、`google-failed`、未知の provider 名など）は `null`（無視）。
- `parseFailureNotice(raw)`: 厳密に `"google-failed"` のときだけ `"google"`。`password-updated`（既存の通知）を含む他の値は `null`。
- 【B5 C3】`externalReturnPath("magic-link", page, intent)` = `accountPath(page, intent)` + （`intent === null` なら `?`、そうでなければ `&`）+ `returned=magic-link`。`externalFailurePath("magic-link", page, intent)` の末尾は `notice=link-failed`。他の規則（安全な相対 path、pathname、`continue` の保持、query は 2 つだけ、禁止語）は Google と同じ。`parseReturned` は厳密に `"google"` または `"magic-link"` のときだけその値を返す（`magic_link`、`magiclink`、`Magic-Link`、前後の空白、`magic-link,google`、`magic-link&x=1` などは `null`）。`parseFailureNotice` は厳密に `"google-failed"` → `"google"`、`"link-failed"` → `"magic-link"`、それ以外（`magic-link-failed`、`google`、`password-updated` を含む）は `null`。Google の値と path は変わらない。
- `RETURNED_PARAM` と `"google-failed"` / `"link-failed"` の文字列は `auth-return.ts` だけが持つ。`returned=…` の URL を作るのは `auth-return.ts` の戻り path だけで、それを開くのは mock の代わりの画面（`window.location.assign`）と、実 Neon Auth の中継の redirect だけに限る。SPA 内の遷移（`router.push` / `Link`）で `returned=…` の URL を開く経路を作らない（§10A の R11）。

## 6. DOM 契約（E2E が検査する）

共通: 本体は layout の `<main>` の中。`<form noValidate>`（ブラウザの組み込み検証を使わず、独自の error summary を使う）。入力は `<label>` で名前が付く（`getByLabel(…, { exact: true })`）。email は `type="email"`、`autoComplete="email"`、password は `type="password"`（Login は `autoComplete="current-password"`、Register / ResetComplete は `new-password`）。

**検証エラー**（クライアント側、Port を呼ぶ前）: 該当 field に `aria-invalid="true"` と、エラー文を含む要素への `aria-describedby`（hint がある field は hint と error の両方の id を空白区切りで含める）。`role="alert"` の error summary を form の**直前**に描画し、`copy.auth.form.errorSummaryTitle` と、エラーごとの `<a href="#<field id>">`（text = `fieldErrorMessage`）を含み、**送信後に focus を移す**（`tabindex="-1"`）。エラーが無い field に `aria-invalid="true"` を付けない。入力し直して再送信し、すべて通れば error summary は消える。検証エラーのとき Port を呼ばない（Session も storage も変わらない）。

**送信中**: submit button はネイティブ `disabled`、文字は `copy.auth.form.submitting`、form に `aria-busy="true"`（SPEC-050 §9.1）。二重送信しない。

**サービス失敗の表示**: 該当 container ごとに `main` 内の `role="alert"` 1 つ（error summary と同時に出さない）。Credential は保持しない（Port へ渡した後、state へ保存しない）。

### 6.1 `/account/login`（PG-AUTH-003）

- `h1` = `copy.auth.login.heading`。Continuation Intent（`?continue=`。`parseContinuation`。**不正な値は mypage の intent として案内を出す**）があるとき、`h1` の下に `describeContinuation` の 4 文（`notice` / `purposeLabel` / `returnAfter` / `revalidate`）を表示する。intent が無ければ案内を出さない。
- `?notice=password-updated`（これだけを認める。他の値は無視）のとき `role="status"` + `copy.auth.login.passwordUpdated`。それ以外では `main` に `role="status"` を出さない（例外: Email OTP のコード要求が `sent` のあとの `copy.auth.otp.sent`。§6.1B）。
- Fields: `copy.auth.field.email.label`、`copy.auth.field.password.label`（hint なし）。submit `<button type="submit">` name = `copy.auth.login.submit`（exact）。
- Links（`main` 内）: `copy.auth.login.toPasswordReset` → `accountPath("password-reset", intent)`（intent があれば `continue` を引き継ぐ。**ただし不正値は `mypage` へ正規化した intent を使う**）、`copy.auth.login.toRegister` → `accountPath("register", intent)`、`copy.auth.login.cancel` → `continuationCancelPath(intent)`（intent が無ければ `/`）。
- 結果（`signIn`）:
  - `signed_in` + `emailVerified: true` → `continuationPath(intent)`（intent が無ければ `/mypage`）へ遷移。遷移先は現在状態を再取得する（Continuation は値を運ばない）。
  - `signed_in` + `emailVerified: false` → `accountPath("email-verification", intent)` へ遷移（Authenticated として購入等へ進めない）。
  - `credential_failure` → `role="alert"` + `copy.auth.login.credentialFailure`（email / password のどちらかを示さない。Session は guest のまま。Password 欄の値を URL・storage・DOM テキストへ出さない）。
  - `unavailable` → `role="alert"` + `copy.auth.login.unavailable`（未検証 User を Authenticated として扱わない。Session は guest のまま）。
- 検証: `validateLoginForm`。

### 6.1A Login の方式選択（B5 C1。PG-AUTH-003。SPEC-050 §15.0）

- `h1` の下（Continuation の案内の下）、フォームの上に、`role="group"` の `<fieldset>`（accessible name = `copy.auth.method.legendLogin`）を描画する。中に `role="radio"` が【B5 C3】**ちょうど 4 つ**、この順: `copy.auth.method.password`、`copy.auth.method.google`、`copy.auth.method.emailOtp`、`copy.auth.method.magicLink`（accessible name は exact）。初期は `password` が checked。GitHub / Discord の語は出さない。矢印キーはこの順に進む（`password` → `google` → `email-otp` → `magic-link`。戻りは逆順）。
- `password` を選んでいるとき、既存の Login フォーム（§6.1）をそのまま表示する（email / password、submit `copy.auth.login.submit`、Links）。OTP の操作（`copy.auth.otp.send`、コード欄）は無い。初期表示に `role="alert"` / `role="status"` は無い。
- `email-otp` を選ぶと、password の欄と `copy.auth.login.submit` が消え、email 欄と `copy.auth.otp.send` button が出る（コード欄はまだ無い）。URL（`continue` を含む）、Session、Continuation の案内は変わらない。**focus は選んだ radio に残る**（動かさない）。`password` に戻すと password 欄は**空**で現れ、入力済みの password はどこにも残らない（storage にも）。
- 方式の radio group は矢印キーだけで操作でき（ネイティブの radio）、選択は navigation を起こさない。Links（登録へ、パスワードをお忘れの方、ログインせずに戻る）は両方式で `continue` を保つ。

### 6.1B Login の Email OTP（B5 C1。PG-AUTH-003、UF-AUTH-002、AR-AUTH-008、SEC-API-027、FR-CRT-012）

2 step。どちらも `<form noValidate>`、検証エラーと送信中の表示は §6 の共通（error summary、`aria-busy`、natively disabled）に従う。

- **step 1（コード要求）**: email 欄（`copy.auth.field.email.label`、`type="email"`、`autoComplete="email"`）+ button `copy.auth.otp.send`。検証は `validateResetRequestForm`（email）で、通らなければ port を呼ばず error summary に focus を移す。通れば `requestEmailOtp({ email: normalizeEmail(email) })`。
  - `sent` → step 2 へ進み、`role="status"` + `copy.auth.otp.sent`（**登録済みでも未登録でも同一の見た目・文言・button**。Account の有無を開示しない。SEC-API-027）。status は同時に 1 つ。
  - `unavailable` → `role="alert"` + `copy.auth.otp.unavailable`、step 1 に留まる（status もコード欄も出さない）。
  - `cart_busy` / `cart_blocked` → Password Login と同じ扱い（`CartRecovery` を page 経由で表示。§10）。button は Cart 停止中ネイティブに disabled。
- **step 2（コード入力）**: コード欄（`copy.auth.field.otpCode.label`、`autoComplete="one-time-code"`、`inputMode="numeric"`、`maxLength` なし）+ submit `copy.auth.otp.submitLogin` + button `copy.auth.otp.resend` + button `copy.auth.otp.changeEmail`。コード欄は state にだけ保持し、URL・storage・console・navigation 先へ出さない（SEC-AUTH-018）。**送信のたびに空にする**（成功・失敗とも）。
  - 空のコードは port を呼ばず、error summary（`copy.auth.field.otpCode.required`）に focus を移し、コード欄は `aria-invalid="true"` + `aria-describedby` にエラー文。summary のリンクはコード欄へ focus を移す。
  - `signInWithEmailOtp({ email, code })` の結果:
    - `signed_in` + `emailVerified: true` → `continuationPath(intent)`（無ければ `/mypage`）。`emailVerified: false` → `accountPath("email-verification", intent)`（§6.1 と同じ）。Cart は password Login と同じ規則（Guest Cart は維持され由来が `authenticated` になる。由来が `authenticated` / 不明の Cart は clear。§10）。
    - `code_invalid` → `role="alert"` + `copy.auth.otp.codeInvalid`（入力し直す。`copy.auth.login.credentialFailure` を出さない）。コード欄と再送 button は残る。
    - `code_expired` → `role="alert"` + `copy.auth.otp.codeExpired`（再送を促す。`codeInvalid` と別の文言）。再送 button は有効。
    - `unavailable` → `role="alert"` + `copy.auth.otp.unavailable`。コード欄は残る。
    - いずれの失敗でも Session は guest、URL と mock DB は不変。`main` 内の `role="alert"` は同時に 1 つ。
  - `copy.auth.otp.resend` → `requestEmailOtp` を同じ email で呼び、`sent` なら新しい `copy.auth.otp.sent` の status を出して step 2 に留まる（前の alert は消える）。`copy.auth.otp.changeEmail` → step 1 へ戻る（status / alert を消し、コード欄を消す）。
- 【B5 レビュー I-1】**step が変わるときの focus**: step 1 の送信 button（`copy.auth.otp.send`）は step 2 へ移ると DOM から消え、step 2 の `copy.auth.otp.changeEmail` は step 1 へ戻ると消える。focus が `body` に落ちないように（SPEC-050 §25 の「主要 Action と Form control は Keyboard 操作可能」「Focus 順序を DOM 上の論理順序と一致させる」。落ちるとキーボード利用者は Tab を文書の先頭からやり直すことになる）、**step 2 へ移ったらコード欄へ、step 1 へ戻ったら email 欄へ focus を移す**。移すのは step が変わった直後の 1 回だけで、初期表示・方式の切替（focus は選んだ radio に残る。§6.1A）・検証エラー（error summary へ focus を移す）・再送（step 2 に留まる）では focus を動かさない。Login（§6.1B）と登録（§6.2A）の両方で同じ。E2E は `auth-login.spec.ts`（TC-PG-AUTH-003-306）と `auth-register-verify.spec.ts`（TC-PG-AUTH-001-305）。
- 未確認 User も、コードで Login すると確認済みになる（mailbox の証明。stored user と Session が `emailVerified: true`）。

### 6.1C Login の Google（B5 C2。PG-AUTH-003、SPEC-050 §15.0 / §15.3、FR-CRT-012 の外部完了認証の規則）

Google は外部サービスで認証する方式である。開始は `AuthPort.startGoogleSignIn`（§3B）、成否は**戻った画面**が決める。`GoogleSignIn`（`features/auth/google-sign-in.tsx`）は Login と登録で共用する container で、props は `{ page: "login" | "register"; intent: ContinuationIntent | null; cartBlocked; onCartFailure; onAttempt? }`（`EmailOtpForm` と同じ形。Cart 停止時の `CartRecovery` は page が出す）。戻りの処理（`completeExternalAuthentication`）は `features/auth/use-external-return.ts` の hook にまとめ、login / register の各 page が呼ぶ。

- **開始の画面**: radio `copy.auth.method.google` を選ぶと、password の欄と `copy.auth.login.submit`・OTP の操作が消え、`<button type="button">` 1 つが出る。accessible name は Login で `copy.auth.google.startLogin`、登録で `copy.auth.google.startRegister`（exact）。これは **button であり link ではない**（`<a>` を使わない。mock の代わりの画面への href を置かない。SEC-WEB-013、DEV-WEB-012）。URL・Session・Continuation の案内・focus（選んだ radio に残る）は変わらない。Links（登録へ、パスワードをお忘れの方、ログインせずに戻る）は `continue` を保つ。
- **有効・無効**: button は、Session が `ready` で Guest、Cart が停止中でなく、開始中でないときだけ有効。それ以外は**ネイティブに `disabled`**（`aria-disabled` ではない）。
  - Session が Authenticated（`emailVerified` が false でも）: 無効。`aria-describedby` が、`copy.auth.google.signedIn` を text とする要素を指す（Guest のときはその要素を描画しない）。押しても何も起きない（`/dev/*` へ移らず、記録も作らない）。Email+Password の form は選べば表示される（開始可否を仕様は定めない。現状の UI の挙動を固定するだけ）。Session が他の Tab で成立したときも、開いている page の button が無効になる（`SessionProvider` の購読）。
  - Session が `loading` / `unavailable`: 無効（Session を確認できないとき開始しない）。【B5 レビュー F-4。SPEC-050 §25「Disabled Actionは理由を周辺Textで示す」】`unavailable` の間は、無効の理由を button の周辺 text で示す: `copy.auth.google.sessionUnavailable` を text とする要素を 1 つ描画し、button の `aria-describedby` がその要素を指す（`main` の中で見える。`role="alert"` / `role="status"` を付けない。試行の失敗ではなく状態の説明であり、`main` 内の alert は 0 のまま）。`signedIn` の text は出さない。Session が `ready`（Guest を含む）のときはこの要素を描画しない。`loading` は一時的な状態なので理由を出さない（対象外）。E2E は scenario `auth.session = "unavailable"` で、Login と登録の両方の button がネイティブに `disabled` で、理由が `main` に見え、`aria-describedby` で結ばれ、押しても `/dev/*` へ移らず記録を作らないことを確かめる（TC-PG-AUTH-003-313）。
  - Cart 停止中（Cart キーを読めない。Q-1）: 無効。`CartRecovery`（`role="alert"` に `copy.cart.lifecycleBlocked.title`、復旧 button）を page 経由で表示する（password Login・OTP と同じ。§10）。disabled を外して押された場合も `cart_blocked` になり、画面に留まる。
- **押したとき**: 二重に押せない（開始中は無効）。`startGoogleSignIn({ successPath, failurePath })`（`externalReturnPath("google", page, intent)` と `externalFailurePath("google", page, intent)`）を呼ぶ。結果:
  - `redirect` → **`url` を検査してから** `window.location.assign(url)`（ページ全体の遷移。`router.push` / `Link` を使わない。`fetch` を使わない）。【B5 レビュー F-1。SEC-WEB-013「最終 redirect の前に再 parse し、同一 origin の path であることを再確認する」、`port.ts` の注釈「`redirect` の `url` は same origin の相対 path」】検査は `isSafeCheckoutUrl(url)` と同じ条件（`features/purchase/cart-purchase-flow.ts` の関数をそのまま使う。同一 origin の安全な相対 path、または userinfo の無い `https:`）で、**`assign` の前**に行い、`assign` に渡す値は検査した値そのもの。通らない値（`javascript:`、`data:`、`http:`、`//evil.example`、backslash を含む値、制御文字・空白を含む値、空文字 等）は**遷移せず**、`unavailable` と同じ表示（`role="alert"` + `copy.auth.google.unavailable`、`main` 内の alert は 1 つ、button は有効のまま、記録は `pending` のまま）にする。検査関数の条件そのものは `cart-purchase-flow.test.ts`（TC-SEC-WEB-005-602）が固定し、`google-sign-in.tsx` が `assign` の前にそれを呼ぶことを `s6-static.test.ts`（TC-PG-AUTH-003-512）が固定する。mock の port は常に安全な path を返し、どの suite にも DOM も不正な URL を返す port も無いので、不正な URL を受けたときの alert の表示は契約とレビューで担保する。
  - `unavailable` → `role="alert"` + `copy.auth.google.unavailable`（`main` 内の alert は同時に 1 つ）。画面に留まり、button は有効のまま（再試行できる）。mock では scenario `auth.login = "unavailable"`。このとき lifecycle には `external: "pending"` が残る（手順 3、7）。
  - `already_signed_in` → 無効の表示（上記）に切り替える。alert は出さない。
  - `cart_busy` / `cart_blocked` → password Login と同じ扱い（`CartRecovery`。§10）。
- **戻りの処理**（`LoginPage`。登録は §6.2B）: mount 後、`?returned=` と `?notice=` を **1 回だけ**読み、読んだ直後に `history.replaceState` で URL から `returned` と `notice` を除く（`continue` など他の query は残す）。
  - `parseReturned(returned) === "google"`（成功の戻り）で、Session が `ready` になったら:
    - `authenticated` かつ `emailVerified: true` → `getBrowserCartLifecycle()?.completeExternalAuthentication()` を **1 回**呼んでから `continuationPath(intent)`（`continue` が無ければ `/mypage`）へ遷移する。
    - `authenticated` かつ `emailVerified: false` → `completeExternalAuthentication()` を呼んでから `accountPath("email-verification", intent)` へ遷移する（Authenticated として購入等へ進めない）。
    - `guest`（Link を別の端末で開いた等）→ `role="alert"` + `copy.auth.google.failed`。`completeExternalAuthentication()` を**呼ばない**（記録は残す）。遷移しない。
    - `unavailable` → 同じく `copy.auth.google.failed` の alert。`completeExternalAuthentication()` を呼ばない。
  - `parseFailureNotice(notice) === "google"`（取消・失敗の戻り）→ `role="alert"` + `copy.auth.google.failed`（Session が何であっても）。`completeExternalAuthentication()` を呼ばない。Guest のまま、radio で別方式を選び直せる。
  - 未知の `returned` / `notice` の値は無視する（alert も遷移も無い）。
  - 上の alert が出ている間、`main` 内の他の `role="alert"` は無い。どの radio が checked かは規定しない（戻りの後に Google 以外を選べればよい）。
  - **戻りの処理は、`returned=google` を持つ URL を文書の読み込みで開いた画面だけが行う**（§10A の R11）。同じ画面でも、`returned` を持たない通常の表示（再読込、戻る・進む、`/mypage` や `/cart` の通常の訪問、他の Tab の画面）は `completeExternalAuthentication()` を呼ばず、`external` の記録を変えない。
  - 受領した後の `completeExternalAuthentication()` の結果は画面に出さない（失敗しても throw しない。Cart の機能だけが停止表示になる）。
- 秘密の扱い: URL・storage・DOM・console に、email・token・code・Google の識別子を出さない（mock の代わりの画面の `success` / `failure` の path 以外）。`console.*` を使わない。

### 6.1D Login の Magic Link（B5 C3。PG-AUTH-003、SPEC-050 §15.0 / §15.3、SEC-API-027、FR-CRT-012 の外部完了認証の規則）

Magic Link は Google に続く 2 つ目の外部完了認証である。送信は `AuthPort.requestMagicLink`（§3C）、成否は**リンクを開いて表示された画面**が決める。`MagicLinkForm`（`features/auth/magic-link-form.tsx`）は Login と登録で共用する container で、props は `GoogleSignIn` と同じ形（`{ page: "login" | "register"; intent: ContinuationIntent | null; cartBlocked; onCartFailure; onAttempt? }`）。戻りの処理は Google と同じ `features/auth/use-external-return.ts` を拡張して使う（`completeExternalAuthentication` を呼ぶのはこの hook だけ）。

- **入力の画面**: radio `copy.auth.method.magicLink` を選ぶと、password の欄と `copy.auth.login.submit`・OTP・Google の操作が消え、`<form noValidate>` に email 欄（`copy.auth.field.email.label`、`type="email"`、`autoComplete="email"`）と `<button type="submit">` `copy.auth.magicLink.send` が出る。password 欄は無い。初期表示に `role="alert"` / `role="status"` は無い。URL・Session・Continuation の案内・focus（選んだ radio に残る）は変わらない。Links（登録へ、パスワードをお忘れの方、ログインせずに戻る）は `continue` を保つ。送信は button であり link ではない（`<a>` を使わない。代わりの画面への href を置かない。SEC-WEB-013、DEV-WEB-012）。
- **検証**: 送信前に `validateResetRequestForm`（email）で検証する。通らなければ port を呼ばず（Cart lifecycle も変えない）、error summary（`copy.auth.field.email.required` / `.invalidFormat`）に focus を移し、email 欄は `aria-invalid="true"` + `aria-describedby`。通れば `requestMagicLink({ email: normalizeEmail(email), successPath: externalReturnPath("magic-link", page, intent), failurePath: externalFailurePath("magic-link", page, intent) })`。送信中は button がネイティブ `disabled`、form に `aria-busy="true"`、二重に送らない（§6 の共通）。
- **有効・無効**: button は、Session が `ready` で Guest、Cart が停止中でなく、送信中でないときだけ有効。それ以外は**ネイティブに `disabled`**。Session が Authenticated（`emailVerified` が false でも）のとき `aria-describedby` が `copy.auth.magicLink.signedIn` を text とする要素を指す（Guest のときはその要素を描画しない）。押しても何も起きない（`/dev/*` へ移らず、pending の記録も作らない）。Session が `loading` / `unavailable`: 無効。【B5 レビュー F-4。SPEC-050 §25】`unavailable` の間は、§6.1C と同じく無効の理由を周辺 text で示す: `copy.auth.magicLink.sessionUnavailable` を text とする要素を 1 つ描画し、button（送信状態の再送 button を含む）の `aria-describedby` がその要素を指す（`main` の中で見える。`role="alert"` / `role="status"` を付けない。`signedIn` の text は出さない。`ready` のときは描画しない。`loading` は対象外）。E2E は Login と登録の両方で、button がネイティブに `disabled`、理由が見える、`aria-describedby` で結ばれる、email を入れて押しても status を出さず記録を作らないことを確かめる（TC-PG-AUTH-003-313）。Cart 停止中（Q-1）: 無効で、`CartRecovery` を page 経由で表示する（§10）。disabled を外して押されても `cart_blocked` になり、画面に留まる。Email+Password の form は選べば表示される。Session が他の Tab で成立したときも、開いている page の button（送信状態の再送 button を含む）が無効になる。
- **結果**:
  - `sent` → email 欄の下に `role="status"` が **1 つ**（`copy.auth.magicLink.sent`。「5分」を含み、**登録済み・未確認・未登録のどの email でも同一の見た目・文言・button 名**で、Account の有無を開示しない。SEC-API-027）。送信 button は名前が `copy.auth.magicLink.resend` の button **に置き換わる**（`send` は無くなり、`resend` が 1 つ）。page は**移動しない**（URL・Session・Cart・mock DB は不変。metadata には `external: "pending"` が書かれている）。email 欄は残り、値を保つ。
  - `unavailable` → `role="alert"` + `copy.auth.magicLink.unavailable`（status は出さない）。画面に留まり、button は有効のまま（`send` の名前のまま。再試行できる）。mock では scenario `auth.login = "unavailable"`。このとき lifecycle には `external: "pending"` が残る（手順 3、7）。
  - `already_signed_in` → 無効の表示（上記）に切り替える。alert は出さない。
  - `cart_busy` / `cart_blocked` → password Login と同じ扱い（`CartRecovery`。§10）。
  - **再送**（`resend` button）: 同じ手順で新しく `requestMagicLink` を呼ぶ（email 欄の現在の値を検証して送る）。新しい送信を始めた時点で前の alert / status を消し、結果が `sent` なら status を 1 つ出す（status と alert は同時に出さない）。再送が `unavailable` になったときは status を消して alert を出し、そのあとの button の名前（`send` / `resend`）は規定しない（E2E は名前を assert しない）。
- **別方式の選び直し**: 送信状態・失敗の表示のあとでも、radio で別方式を選べる（`password` に戻すと password 欄は**空**で現れる）。`magic-link` を選び直したときの送信状態の復元は規定しない。
- **リンクが開かれたとき**（Link は送信した Tab・他の Tab・他の端末のどれでも開かれうる）: 送信した画面は**結果を受け取らない**。結果を受け取るのは、リンクを開く操作で表示された PG-AUTH 画面（`returned=magic-link` または `notice=link-failed` を持つ URL を**文書の読み込み**で開いた画面。§10A の R11）だけである。送信した Tab は、リンクが他の Tab で開かれても、送信状態のまま遷移も判定も行わず、失敗も表示せず、再読込しても何も判定しない。他の Tab で Session が成立したことは `SessionProvider` の購読で見えるだけ（再送 button が無効になる）。
- **戻りの処理**（`LoginPage`。登録は §6.2C）は §6.1C と同じ規則で、`parseReturned(returned) === "magic-link"` / `parseFailureNotice(notice) === "magic-link"` を扱い、失敗の文言は `copy.auth.magicLink.failed`:
  - 成功の戻りで Session が `authenticated` かつ `emailVerified: true` → `completeExternalAuthentication()` を 1 回呼んでから `continuationPath(intent)`（無ければ `/mypage`）。`emailVerified: false` → 呼んでから `accountPath("email-verification", intent)`。`guest`（リンクを別の端末で開いた、または Session が成立しなかった）または `unavailable` → `role="alert"` + `copy.auth.magicLink.failed`、`completeExternalAuthentication()` を**呼ばない**（記録を残す）、遷移しない。
  - `notice=link-failed`（無効・期限切れの戻り）→ Session が何であっても `role="alert"` + `copy.auth.magicLink.failed`。呼ばない。Guest のまま、再送するか別方式を選べる。
  - `returned` を処理した直後に `history.replaceState` で `returned` と `notice` を URL から除く（`continue` は残す）。未知の値（`magic_link` など）は無視する（alert も遷移も無い）。Google の戻りと Magic Link の戻りは互いの文言を出さない（`notice=google-failed` は `copy.auth.google.failed`、`notice=link-failed` は `copy.auth.magicLink.failed`）。
  - どの radio が checked かは規定しない（戻りの後に別の方式を選べればよい）。受領後の `completeExternalAuthentication()` の結果は画面に出さない。
- 秘密の扱い: URL・storage・DOM のテキスト・console に、送信した email・リンク・token を出さない。`console.*` を使わない。送信状態の status に email を含めない（`copy.auth.magicLink.sent` は固定文）。

### 6.2A Registration の方式選択と Email OTP（B5 C1。PG-AUTH-001、FR-AUTH-001、SPEC-030 §9.2）

- 登録画面にも §6.1A と同じ radio group を置く。legend は `copy.auth.method.legendRegister`、初期は `password`（既存の登録フォーム §6.2）。`email-otp` を選ぶと email 欄と `copy.auth.otp.send` に替わり、URL と Continuation の案内は変わらない。
- Email OTP の step 1 / step 2 は §6.1B と同じだが、step 2 の submit は `copy.auth.otp.submitRegister`（`submitLogin` は無い）。Links は `copy.auth.register.toLogin`（`continue` 保持）。
- 未知の email は、コードで初回登録になる: `/mypage`（または `continuationPath(intent)`）へ進み、Session は `authenticated` + `emailVerified: true`、mock の user が**ちょうど 1 人**増え `{ displayName: null, emailVerified: true }`（Mypage の表示名は「未設定」。email から推測しない）。
- 既に登録済みの email でも「すでに登録されています」等の答えを出さない: Login と同じく signed_in になり user は増えない（SEC-API-027）。
- 誤ったコード（`code_invalid`）・サービス失敗（`unavailable`）は §6.1B と同じ文言の alert で、Guest のまま user を作らず、URL は `/account/register` のまま。

### 6.2 `/account/register`（PG-AUTH-001）

- `h1` = `copy.auth.register.heading`。Continuation Intent があれば §6.1 と同じ案内（4 文）。無ければ出さない。
- Fields: email、password（`copy.auth.field.password.label`。hint `copy.auth.field.password.hint` を `aria-describedby` で結ぶ）、`copy.auth.field.passwordConfirm.label`。submit name = `copy.auth.register.submit`。Link `copy.auth.register.toLogin` → `accountPath("login", intent)`。
- 検証: `validateRegisterForm`。**Password を trim しない**（先頭・末尾の空白を含む 12 文字は有効）。
- 結果（`signUp`）:
  - `confirmation_required` → `accountPath("email-verification", intent)` へ遷移（既存 Account の email でも同じ結果。存在を開示しない）。
  - `signed_in` → `continuationPath(intent)`（無ければ `/mypage`）へ遷移。
  - `rejected` → `role="alert"` + `copy.auth.register.rejected`（登録未成立）。
  - `unavailable` → `role="alert"` + `copy.auth.register.unavailable`（購入等を認証済みとして進めない）。`rejected` と `unavailable` の文言は異なる。
  - いずれの失敗でも Session は guest のまま。

### 6.2B Registration の Google（B5 C2。PG-AUTH-001、FR-AUTH-001、SPEC-030 §9.2、SPEC-050 §15.1）

- radio group（legend は `copy.auth.method.legendRegister`）の `copy.auth.method.google` を選ぶと、§6.1C と同じ `GoogleSignIn`（`page="register"`）が出る。button の accessible name は `copy.auth.google.startRegister`。有効・無効、`already_signed_in`、`cart_busy` / `cart_blocked`、`unavailable` の扱いは §6.1C と同じ。
- stand-in の `success` は `externalReturnPath("google", "register", intent)`（`/account/register?…&returned=google`）、`failure` は `externalFailurePath("google", "register", intent)`。
- 戻りの処理は §6.1C と**同じ順序**（`RegisterPage` が行う）: verified → `completeExternalAuthentication()` の後に `continuationPath(intent)`（`continue` が無ければ `/mypage`）、未確認 → `completeExternalAuthentication()` の後に `accountPath("email-verification", intent)`、Guest → `copy.auth.google.failed` の alert（遷移しない、記録を残す）、`notice=google-failed` → 同じ alert。
- 未知の email（`google.new@example.com`）の許可は初回登録になる: Session は `authenticated` + `emailVerified: true`、mock の user が**ちょうど 1 人**増え `{ displayName: null, emailVerified: true }`（Mypage の表示名は「未設定」。email から推測しない）。既に登録済みの email（`demo@example.com`）の許可でも「すでに登録されています」等の答えを出さない: Login と同じく signed_in になり user は増えない（SEC-API-027）。

### 6.2C Registration の Magic Link（B5 C3。PG-AUTH-001、FR-AUTH-001、SPEC-030 §9.2、SPEC-050 §15.1）

- radio group（legend は `copy.auth.method.legendRegister`）の `copy.auth.method.magicLink` を選ぶと、§6.1D と同じ `MagicLinkForm`（`page="register"`）が出る。送信・再送・有効無効・`already_signed_in`・`cart_busy` / `cart_blocked`・`unavailable` の扱いは §6.1D と同じ。
- `successPath` は `externalReturnPath("magic-link", "register", intent)`（`/account/register?…&returned=magic-link`）、`failurePath` は `externalFailurePath("magic-link", "register", intent)`。
- 戻りの処理は §6.1D と**同じ順序**（`RegisterPage` が行う）: verified → `completeExternalAuthentication()` の後に `continuationPath(intent)`（無ければ `/mypage`）、未確認 → 呼んでから `accountPath("email-verification", intent)`、Guest → `copy.auth.magicLink.failed` の alert（遷移しない、記録を残す）、`notice=link-failed` → 同じ alert。
- 未知の email のリンクを開くと初回登録になる: Session は `authenticated` + `emailVerified: true`、mock の user が**ちょうど 1 人**増え `{ displayName: null, emailVerified: true }`（Mypage の表示名は「未設定」。email から推測しない）。既に登録済みの email のリンクでも「すでに登録されています」等の答えを出さない: Login と同じく signed_in になり user は増えない（SEC-API-027）。

### 6.3 `/account/email-verification`（PG-AUTH-002）

- `h1` = `copy.auth.verify.heading`。`?continue=` は §6.1 と同様に解釈して引き継ぐ。
- `context` query（opaque な verification context。mock では任意の非空文字列）が**無い**: `role="status"` + `copy.auth.verify.required`（確認待ち。`copy.auth.verify.verified` を出さない）と、Link `copy.auth.verify.toLogin` → `accountPath("login", intent)`。
- `context` が**ある**: mount 後に 1 度だけ `verifyEmail({ context })` を呼ぶ。呼び出し中は `role="status"` + `copy.auth.verify.verifying`。**読み取った直後に、URL から `context` だけを除去する**（`history.replaceState`。`continue` など他の query は残す。context を DOM のテキスト・storage・console に出さない）。結果:
  - `verified` → `role="status"` + `copy.auth.verify.verified`。Session が Authenticated のとき（Login 済みで未確認だった User）は Link `copy.auth.verify.continue` → `continuationPath(intent)`（無ければ `/mypage`）。Guest のときは Link `copy.auth.verify.toLogin` → `accountPath("login", intent)`。
  - `invalid_or_expired` → `role="alert"` + `copy.auth.verify.invalid`（確認済みと表示しない。「削除」等、既存 Profile や購入を消したと読める語を出さない）+ Link `copy.auth.verify.toLogin`。
  - `unavailable` → `role="alert"` + `copy.auth.verify.unavailable` + `<button type="button">` `copy.auth.verify.retry`（`verifyEmail` を再度呼ぶ。URL に context が無くなっているため、container が読み取った context を state で保持して再利用する）。

### 6.4 `/account/password-reset`（PG-AUTH-004）

- `h1` = `copy.auth.reset.heading`。Field: email。submit name = `copy.auth.reset.submit`。Link `copy.auth.reset.backToLogin` → `accountPath("login", intent)`（`?continue=` があれば引き継ぐ）。
- 検証: `validateResetRequestForm`。
- 結果（`requestPasswordReset`）:
  - `accepted` → `role="status"` + `copy.auth.reset.accepted`（**登録済みでも未登録でも同一の文言**。SEC-API-027）。
  - `unavailable` → `role="alert"` + `copy.auth.reset.unavailable`（reset 未完了。`accepted` の status を出さない）。
- どの結果でも Session は変わらない。

### 6.5 `/account/password-reset/complete`（PG-AUTH-005）

- `h1` = `copy.auth.resetComplete.heading`。`context` query が**無い**（または空）: form を出さず、`role="alert"` + `copy.auth.resetComplete.invalid` と Link `copy.auth.resetComplete.requestAgain` → `/account/password-reset`。`AuthPort` を呼ばない。
- `context` が**ある**: Fields = `copy.auth.field.newPassword.label`（hint `copy.auth.field.password.hint`）、`copy.auth.field.newPasswordConfirm.label`。submit name = `copy.auth.resetComplete.submit`。`context` は読み取った直後に URL から除去する（§6.3 と同じ）。検証: `validateResetCompleteForm`（**検証を通るまで `completePasswordReset` を呼ばない**。mock は policy 違反で throw する）。
- 結果（`completePasswordReset`）:
  - `updated` → `/account/login?notice=password-updated` へ遷移（Session は変えず、自動 Login しない）。
  - `invalid_context` → form を `role="alert"` + `copy.auth.resetComplete.invalid` と Link `copy.auth.resetComplete.requestAgain` に置き換える。
  - `unavailable` → `role="alert"` + `copy.auth.resetComplete.unavailable`（form は残す）。

### 6.6 AuthGate 配下（`/mypage`）

> **S8 で置き換え済み**（`tests/contracts/s8-mypage.md` §10）: `/mypage` は PG-MYP-001（Overview）になり、`copy.mypage.protectedMarker` は削除された。S6 のテストの「保護 Content の目印」は seed の表示名（`MARKER_PROTECTED_TEXT` = `デモ太郎`）に置き換わった。以下の記述のうち `protectedMarker` に関する部分は本注記が優先する。

- `/mypage`（S6 placeholder）: `h1` = `copy.mypage.heading`、本文に `copy.mypage.protectedMarker`。**Authenticated かつ email 確認済み**のときだけ描画される。
- Guest が `/mypage` を開く → `/account/login?continue=mypage` へ redirect（`copy.mypage.heading` / `protectedMarker` を一度も DOM に出さない）。
- email 未確認の Authenticated（`unverified@example.com`）→ `/account/email-verification?continue=mypage` へ redirect。
- Session 取得失敗（scenario `auth.session = "unavailable"`）→ AuthGate の unavailable 表示（§3）。Login へ redirect しない。

### 6.7 Logout と Header

- Account menu の `copy.layout.account.logout` button → 同じ tab で `/` へ遷移して終わる（Home。Login や `/mypage` ではない）。Session は guest（`r39x.mock.session.v1`）。Cart（`r39x.cart.v1`）は clear（key 削除）する。mock DB は**変更しない**（Cart の clear は既存 Order 等を変えない。FR-CRT-012、SPEC-050 §15.6、AR-SES-009、UF-AUTH-004）。Logout 後の `/cart` は Empty。
- Logout 後の Browser back で `/mypage` へ戻る → 保護 Content（`copy.mypage.heading` / `protectedMarker`）を一度も表示せず、`/account/login?continue=mypage` へ遷移する。
- Header（S3 の挙動を変えない）: Guest は `copy.layout.account.login` Link があり、`copy.layout.account.mypage` / Account menu button が無い。Authenticated は逆。Login / Logout の直後に追加の reload なしで切り替わる。Login（Guest → 初回 Login）では Cart 数は変わらない。Logout 後は件数なしの Cart link になる。

### 6.8 no-store と共通（`/account/*`、`/mypage`）

- `/account/login`、`/account/register`、`/account/email-verification`、`/account/password-reset`、`/account/password-reset/complete`、`/mypage` の GET が **HTTP 200** で、`Cache-Control` が `no-store` と `private` を含み、`Pragma: no-cache`（SEC-WEB-009。`dist/_headers` の規則。静的 shell なので route が未実装でも 200 になる）。`/` の navigation 応答も `no-store, private, max-age=0`（公開 page も同じ。S4 / S5 と TC-SEC-WEB-009-701 の後半）。
- 各ページは title = `${copy.<…>.pageTitle} | ${SITE_NAME}`、`h1` が 1 つ、`pageerror` / `console.error`（resource load 失敗を除く）が無く、外部 origin へ要求せず、`/admin` / `/staff` への href が無く、390px 幅で横 scroll が無い。
- 認証フローの前後で、localStorage / sessionStorage の全内容（key と value）、URL、`main` のテキストに、入力した Password（テストの sentinel）と verification / reset の context が現れない（SEC-AUTH-018）。【B5 C1】Email OTP のコード（sentinel）も同様に、誤り・期限切れ・サービス失敗・成功のどの後でも、URL・storage・DOM のテキスト・console に現れず、コード欄は送信のたびに空になる（TC-SEC-AUTH-018-702）。390px 幅では方式の radio group、OTP の email step、コード step（欄・送信・再送・メール変更）が viewport 内に収まり横 scroll が無い（Login と登録。TC-PG-AUTH-003-504）。root layout の `<ScrollRestoration />` は `getKey` を渡さず既定の location key を使うので、sessionStorage の保存値に URL・query（`context` など）が入らない（`tests/e2e/static-hosting.spec.ts` TC-STACK-008-306）。【B5 C2】Google の開始・stand-in・戻りの前後で、URL・storage・DOM のテキスト・console に、email・token・code・Google の識別子が現れない（stand-in の URL の `success` / `failure` の path と、固定の `returned=google` / `notice=google-failed` の語は例外）。`/account/login` と `/account/register` の radio を Google にしても、`<a href>` に `/dev`・`/admin`・`/staff` が無く、外部 origin への要求（Google の画像・script を含む）が無い。390px 幅では Google の開始 button が viewport に収まり横 scroll が無い（TC-PG-AUTH-003-308）。`/dev/mock-google` の GET も `dist/_headers` の `/*` 規則で no-store（SEC-WEB-009）。【B5 C3】Magic Link の送信・再送・失敗の戻り・有効なリンクの前後で、送信した email・リンクの持ち主の email が、URL・storage（持ち主の user 記録は有効なリンクが意図して書く）・DOM のテキスト・console に現れない（TC-SEC-AUTH-018-702。代わりの画面の URL の `success` / `failure` の path と、固定の `returned=magic-link` / `notice=link-failed` の語は例外）。radio を Magic Link にしても `<a href>` に `/dev`・`/admin`・`/staff` が無く、外部 origin への要求が無い。390px 幅では email 欄・送信 button・送信状態・再送 button が viewport に収まり横 scroll が無い（TC-PG-AUTH-003-504）。`/dev/mock-magic-link` の GET も `dist/_headers` の `/*` 規則で no-store。

### 6.9 `/dev/mock-google`（B5 C2。dev 専用。DEV-WEB-012 / 013。`mock/dev-ui/mock-google-screen.tsx` + `routes/dev/mock-google.tsx`）

Stripe Checkout の代わりの画面（`/dev/mock-checkout`）と同じ位置づけの、Google の代わりの画面である。`DevLayout` の guard 配下にあるため、mock が無効なとき（`VITE_UI_MOCK` が `1` でない、または `APP_ENV=production`）は Not Found 表示になる。一般 Navigation・Footer・Drawer・Account menu・MockModeBadge・PG-AUTH 画面から **Link しない**（`<a href>` を置かない。開始は `window.location.assign`）。

- query: `success` と `failure`（どちらも percent-encoded された相対 path。`startGoogleSignIn` の返す URL の形。`s2-mock-backend.md` §14.2）。画面は表示のたびに、**両方が**あり、それぞれ `isSafeRelativePath` を通り、pathname が `/account/login` または `/account/register` であることを検査する。1 つでも満たさない（欠落、重複して複数値、絶対 URL、`//`、backslash、dot segment、保護 path・`/dev`・`/admin`・`/`・PG-AUTH でも Login / 登録でもない path）場合は、**3 つの操作すべてが `disabled`**（ネイティブ）で、何も変更せず、何も辿らない（`window.location.assign` を呼ばない）。
- 表示: `h1` = `copy.mockGoogle.heading`（代わりの画面で、実際の認証が行われないことを言う）、本文に `copy.mockGoogle.note`、title は `copy.mockGoogle.pageTitle`。`<main>` は layout のものだけ。入力欄を持たない（email を入力させない。URL にも storage にも email を出さない）。
- 操作（`<button type="button">`、accessible name は exact）:
  - `copy.mockGoogle.allowDemo`（"demo@example.com として許可"）: `allowMockGoogleSignIn(deps, "demo@example.com")`（既存 user の session を作る。DB 不変）を呼び、`signed_in` なら `window.location.assign(success)`。
  - `copy.mockGoogle.allowNew`（"新しいアカウント（google.new@example.com）として許可"）: `allowMockGoogleSignIn(deps, "google.new@example.com")`（user が無ければ `displayName: null`、`emailVerified: true` で作り、session を `authenticated` にする）を呼び、`signed_in` なら `window.location.assign(success)`。
  - `copy.mockGoogle.cancel`（"キャンセル"）: 何も変更せず `window.location.assign(failure)`。
  - `allowMockGoogleSignIn` が `unavailable`（DB・session の破損）を返したら遷移せず、画面に留まる（表示は規定しない）。
  - 画面を開いただけでは Session・DB・Cart・metadata を変えない。許可はこの画面が Session を直接書くため、Cart lifecycle の decorator を通らない（結果の受領は戻った PG-AUTH 画面の仕事。§10A）。
- 「未確認 user として許可」の操作は置かない。未確認 Session の戻りは、`unverified@example.com` の Session を seed して `returned=google` の URL を直接開いて検査する（TC-PG-AUTH-003-310）。
- `window.location.assign(success)` は、`auth-return.ts` が作る戻り path（`returned=google`）を**ページ全体の遷移**で開く唯一の経路である（§10A の R11）。

### 6.10 `/dev/mock-magic-link`（B5 C3。dev 専用。DEV-WEB-012 / 013。`mock/dev-ui/mock-magic-link-screen.tsx` + `routes/dev/mock-magic-link.tsx`）

実際のメールの受信箱の代わりの画面である（`/dev/mock-google` と同じ位置づけ）。開発者が「リンクの持ち主のメールアドレス」を入力して、リンクを有効として開くか、期限切れとして開く。`DevLayout` の guard 配下にあるため、mock が無効なときは Not Found 表示になる。一般 Navigation・Footer・Drawer・Account menu・MockModeBadge・PG-AUTH 画面・`features/**` から **Link も参照もしない**（`<a href>` を置かない。リンクを開く操作は開発者がこの画面の URL を直接開くことで表す）。

- query: `success` と `failure`（どちらも percent-encoded された相対 path。`s2-mock-backend.md` §14.3）。§6.9 と同じ検査（両方がある、`isSafeRelativePath`、pathname が `/account/login` または `/account/register`）を表示のたびに行い、1 つでも満たさない場合（欠落、複数値、絶対 URL、`//`、backslash、dot segment、Login / 登録でない path・`/dev` など）は、**2 つの操作ともネイティブ `disabled`** で、何も変更せず、何も辿らない（`window.location.assign` を呼ばない）。query が両方とも無い場合も同じ。
- 表示: `h1` = `copy.mockMagicLink.heading`、本文に `copy.mockMagicLink.note`、title は `copy.mockMagicLink.pageTitle`。`<main>` は layout のものだけ。`<form>` を持たない。email 欄 1 つ（`copy.mockMagicLink.emailLabel`、`type="email"`、初期は空）。
- 操作（`<button type="button">`、accessible name は exact）:
  - `copy.mockMagicLink.openValid`: 欄の値を `normalizeEmail` した email で `openMockMagicLink(deps, email)`（`s2-mock-backend.md` §14.3。既存 user の session を作る。未確認 user は確認済みにする。user が無ければ `displayName: null`、`emailVerified: true` で作る）を呼び、`signed_in` なら `window.location.assign(success)`。**欄が空または形式不正（`validateResetRequestForm` を通らない）のときは何も呼ばず、遷移もしない**（button は有効のまま。何も変わらない）。`unavailable`（DB・session の破損）なら遷移せず画面に留まる（表示は規定しない）。
  - `copy.mockMagicLink.openExpired`: **email を必要とせず**、何も変更せず `window.location.assign(failure)`。
  - 画面を開いただけ・欄に入力しただけでは Session・DB・Cart・metadata・storage を変えない。入力した email は URL・storage・DOM のテキスト（欄の値以外）・console のどこにも出さない（`success` / `failure` の path は固定の語だけで、email を含まない）。
  - 有効なリンクを開く操作は Session を直接書くため、Cart lifecycle の decorator を通らない（結果の受領は、遷移先の PG-AUTH 画面の仕事。§10A）。
- `window.location.assign(success)` / `assign(failure)` は、`auth-return.ts` が作る戻り path（`returned=magic-link` / `notice=link-failed`）を**ページ全体の遷移**で開く唯一の経路である（§10A の R11）。リンクを「他の Tab で開く」操作は、E2E が別の Tab で同じ URL を開いて表す。
- 実装の静的検査（TC-PG-AUTH-003-512）: route は薄い殻（`copy.mockMagicLink.pageTitle` を title に使う）、画面は `openMockMagicLink`・`window.location.assign`・`isSafeRelativePath`・`type="email"` を使い、`<form`・`console`・`fetch`・日本語の直書きを持たず、`features/**` のどのファイルもこの画面と route を参照しない。

## 7. E2E の共通条件

- 時刻は `page.clock.setFixedTime(NOW_ISO)`（`fixClock`）。状態の仕込みは `seedLocalStorage`（`KEYS.session` / `KEYS.scenario` / `KEYS.cart`）。ナビゲーションは `gotoHydrated` / `reloadHydrated`（`HydrationMarker` は S5 で実装済み）。
- Seed の User: `demo@example.com`（確認済み）、`new@example.com`（確認済み）、`unverified@example.com`（未確認）、`other@example.com`（確認済み）。Password は mock が形だけ検査する（空でなければよい。`TEST_PASSWORD`）。メールアドレスは `example.com` だけ（TST-DAT-002）。
- scenario の auth 切替（`scenarioJson({ auth: {...} })`、`tests/harness/browser/auth.ts` の `authScenario(patch)` が既定値へ合成する）: `login` / `signup` / `verify` / `reset` / `resetContext` / `session`。scenario の失敗は mock 内の切替であり SPEC-170 の Fault Point ではない（TST-GEN-006）。【B5 C1】Email OTP は新しい値を作らず、`login`（`unavailable` / `credential_failure`）と `verify`（`invalid_or_expired`）を再利用する（§9 の 12）。E2E は `auth.ts` の `setAuthScenario(page, patch)` で、画面を開いたまま scenario を切り替えられる（mock は呼び出しごとに scenario を読む）。コードの sentinel は `SENTINEL_OTP_CODE`、通常のコードは `OTP_CODE`。
- 【B5 C2】Google の E2E の helper は `tests/harness/browser/auth.ts`: `expectMethodRadios(group)`（仕様の順の radio と、`copy.auth.method.magicLink` があれば最後の 4 つ目）、`openAuthPage(page, name, query?, entries?)`、`googleRadio` / `googleStartButton(page, "login" | "register")` / `standInButton(page, "allowDemo" | "allowNew" | "cancel")`、`googleReturnPath` / `googleFailurePath`（§5B の path を**文字どおり**に組む。production の builder に依存しない）、`mockGoogleUrl` / `openMockGoogle`（stand-in を直接開く）、`startGoogle(page, name)`（radio を選び、開始 button を押し、`/dev/mock-google` への全遷移と hydration を待つ）、`watchDocumentRequests(page)`（main frame の document 要求の path と query。`returned=google` が文書の読み込みで来たことを確かめる）、`readCartLifecycle` / `readCartLifecycleRaw`、`cartEntriesWithExternal(lines, "pending" | "superseded", provenance?)`、`sessionEntry(email, emailVerified?)`。Google の文言は `copy.auth.method.google` / `copy.auth.google.*` / `copy.mockGoogle.*` を直接読む。
- 【B5 C3】Magic Link の E2E の helper も `tests/harness/browser/auth.ts`: `expectMethodRadios(group)` は**ちょうど 4 つ**の radio（`password`、`google`、`emailOtp`、`magicLink` の順）を要求する、`magicRadio` / `magicSendButton` / `magicResendButton`、`standInEmailField` / `standInLinkButton(page, "openValid" | "openExpired")`、`magicReturnPath` / `magicFailurePath`（§5B の path を**文字どおり**に組む）、`MOCK_MAGIC_LINK_PATH` / `mockMagicLinkUrl` / `openMockMagicLink`（代わりの画面を直接開く）、`sendMagicLink(page, email)`（radio を選び、email を入れて送信し、`sent` の status を待つ）、`openValidLink(page, name, email, continueValue?)`（代わりの画面を文書の読み込みで開き、email を入れ、「有効なリンクとして開く」を押す。**遷移先の待ちは呼び出し側**）。文言は `copy` を直接読む。
- 【B5 C2】Playwright は直列（`--workers=1`、`127.0.0.1:3100` を専有）。stand-in への遷移・戻りの文書は `page.waitForURL` で待ち、`waitForHydration` で hydration を確かめてから操作する。2 つ目の page は `openSecondTab(page.context())`（同じ localStorage を共有する）。

## 8. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/auth/continuation.test.ts` | §2（U9） |
| `tests/unit/web/auth/gate-decision.test.ts` | §3 |
| `tests/unit/web/auth/form-validation.test.ts` | §4（U13） |
| `tests/unit/web/auth/continuation-view.test.ts` | §5 |
| `tests/unit/web/auth/s6-copy.test.ts` | §1 |
| `tests/unit/web/auth/s6-static.test.ts` | §0 と静的検査（構成、page 殻、直書き、secret の扱い、依存方向） |
| `tests/e2e/auth-login.spec.ts` | §6.1、E2E 3、E2E 24 後半 |
| `tests/e2e/auth-register-verify.spec.ts` | §6.2、§6.3 |
| `tests/e2e/auth-password-reset.spec.ts` | §6.4、§6.5 |
| `tests/e2e/auth-gate-logout.spec.ts` | §3、§6.6、§6.7 |
| `tests/e2e/auth-common.spec.ts` | §6.8、390px の方式選択と OTP の 2 step（TC-PG-AUTH-003-504）、コードの非漏えい（TC-SEC-AUTH-018-702） |
| `tests/unit/web/auth/auth-methods.test.ts` | §5A（TC-PG-AUTH-003-212） |
| `tests/unit/web/mock/mock-auth.test.ts` | s2-mock-backend.md §14（OTP。TC-PG-AUTH-003-102 / -103、TC-SEC-AUTH-018-101） |
| `tests/unit/web/auth/cart-lifecycle-auth-port.test.ts` | §3A と §10（TC-FR-CRT-012-016） |
| `tests/e2e/cart-failure-modes.spec.ts` | §10 の Q-1（OTP を含む。TC-PG-CRT-001-543）、Google の Q-1 と storage 取得不可（TC-FR-CRT-012-018） |
| `tests/unit/web/auth/auth-return.test.ts` | §5B（B5 C2。TC-PG-AUTH-003-213） |
| `tests/unit/web/cart/cart-lifecycle-external.test.ts` | §10A（lifecycle の `beginExternalAuthentication` / `completeExternalAuthentication`。TC-FR-CRT-012-017 / -019） |
| `tests/e2e/auth-google.spec.ts` | §6.1C、§6.2B、§6.9、§10A（TC-PG-AUTH-003-308 / -310 / -313、TC-FR-CRT-012-020） |
| `tests/e2e/auth-magic-link.spec.ts` | §6.1D、§6.2C、§6.10、§10A（B5 C3。TC-PG-AUTH-003-309 / -310 / -313、TC-FR-CRT-012-020、TC-SEC-AUTH-018-702） |

B5 全体レビューの指摘（F-1〜F-4、I-1、I-10）の対応: F-1（Google の `redirect` の `url` の検査。§6.1C）は `s6-static.test.ts`（TC-PG-AUTH-003-512）、F-2（別方式の Login 成功時に Cart の clear が失敗しても手順 5 の `superseded` を記録する。§10A）は `cart-lifecycle-external.test.ts`（TC-FR-CRT-012-019。Google と Magic Link の両方）、F-3（Session 未確定の復旧と `abortTransition("unknown")` で結果待ち記録を残す。§10A、§9 の 15）は `cart-lifecycle-external.test.ts`（TC-FR-CRT-012-017 / -019）、F-4（Session を確認できないとき開始 / 送信が無効な理由の表示。§1、§6.1C、§6.1D）は `s6-copy.test.ts`（TC-PG-AUTH-003-403）・`s6-static.test.ts`（TC-PG-AUTH-003-512）・`auth-google.spec.ts` / `auth-magic-link.spec.ts`（TC-PG-AUTH-003-313）、I-1（OTP の step が変わるときの focus。§6.1B）は `auth-login.spec.ts`（TC-PG-AUTH-003-306）・`auth-register-verify.spec.ts`（TC-PG-AUTH-001-305）、I-10（§9 の 13・14 の `notice` の扱い）は契約の文だけの訂正（テストなし）。

B5 C3 の対応: §1（`copy.auth.method.magicLink` / `copy.auth.magicLink` / `copy.mockMagicLink`）は `s6-copy.test.ts`（TC-PG-AUTH-003-403）、§3C は `ports.test.ts`（TC-DEV-WEB-010-102）・`mock-auth.test.ts`（TC-PG-AUTH-003-105）・`cart-lifecycle-auth-port.test.ts`（TC-FR-CRT-012-019）・`cart-lifecycle-external.test.ts`（TC-FR-CRT-012-019。Google と Magic Link の両方で同じ journey を回す）、§5A は `auth-methods.test.ts`（TC-PG-AUTH-003-212。ちょうど 4 方式）、§5B は `auth-return.test.ts`（TC-PG-AUTH-003-213）、§0 / §6.1D / §6.2C / §6.10 の構成は `s6-static.test.ts`（TC-PG-AUTH-003-512）と `route-table-static.test.ts`（TC-STACK-008-002。`/dev/mock-magic-link` を足して 33 path）・`floating-ticket-visibility.test.ts`、§6.1A の radio の順と矢印キーは `auth-login.spec.ts`（TC-PG-AUTH-003-305）と `auth-register-verify.spec.ts`（TC-PG-AUTH-001-305）、§6.1D / §6.2C / §6.10 / §10A の画面は `auth-magic-link.spec.ts`、Q-1 は `cart-failure-modes.spec.ts`（TC-FR-CRT-012-018）、390px は `auth-common.spec.ts`（TC-PG-AUTH-003-504）。

B5 C2 の対応: §1（`copy.auth.method.google` / `copy.auth.google` / `copy.mockGoogle`）は `s6-copy.test.ts`（TC-PG-AUTH-003-403）、§3B は `ports.test.ts`（TC-DEV-WEB-010-102）・`mock-auth.test.ts`（TC-PG-AUTH-003-104）・`cart-lifecycle-auth-port.test.ts`（TC-FR-CRT-012-017）、§5A は `auth-methods.test.ts`（TC-PG-AUTH-003-212）、§5B は `auth-return.test.ts`（TC-PG-AUTH-003-213）、§0 / §6.1C / §6.2B / §6.9 の構成は `s6-static.test.ts`（TC-PG-AUTH-003-512、TC-DEV-WEB-001-501 / -503）と `route-table-static.test.ts`（TC-STACK-008-002。`/dev/mock-google` を足して 32 path）、§6.1A の radio の順は `auth-login.spec.ts`（TC-PG-AUTH-003-305）と `auth-register-verify.spec.ts`（TC-PG-AUTH-001-305）、§6.1C / §6.2B / §6.9 / §10A の画面は `auth-google.spec.ts`。

B5 C1 の対応: §1（`copy.auth.method` / `copy.auth.otp` / `copy.auth.field.otpCode`）は `s6-copy.test.ts`（TC-PG-AUTH-003-403）、§4 の `validateOtpCodeForm` は `form-validation.test.ts`（TC-PG-AUTH-003-202）、§0 / §5A / §6.1A / §6.1B / §6.2A の構成は `s6-static.test.ts`（TC-PG-AUTH-003-512）、§6.1A〜§6.1B は `auth-login.spec.ts`（TC-PG-AUTH-003-305 / -306 / -307）、§6.2A は `auth-register-verify.spec.ts`（TC-PG-AUTH-001-305）。

## 9. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **Continuation key の一覧**: Design §7 は「cart, karaoke-slot, purchase-order, mypage と mypage 配下の各 key」とだけ書く。→ §2 の 13 個に固定した（SPEC-060 §29.1 の許可例と SPEC-050 §17.2 の Mypage 構成から導いた）。Entry / Goods の販売 Page への key は、Cart 導入後は不要（SPEC-060 §29.1 / SPEC-050 の例が Cart 導入前の記述。OI-6 と同じ性質）なので作らない。
2. **QR ページは復帰先にしない**: QR は保護 path だが key を持たず、AuthGate の逆引きは `mypage` へ寄せる。QR 提示は直前の認証・Owner 再検証を要するため（SEC-QR-012 / 013 の趣旨）。
3. **既に Authenticated で Login / 登録を開いたとき**: SPEC-050 に規定がない。自動 redirect は、login 成功直後の自身の遷移と競合するため行わない（フォームをそのまま出す）。
4. **verification / reset context の運び方**: Design / SPEC-050 は context の運び方を定めない。mock では `?context=<opaque>` の query とし、読み取り後に URL から除去する（SEC-AUTH-018 の趣旨: token を URL に残さない）。実 Neon Auth では provider の redirect 規約に従う（UCR 不要。実装前の mock の決定）。
5. **Logout と AuthGate の競合**: §3 のとおり、Logout 後の最終 URL は `/`（SPEC-050 §15.6）。back で保護 Page に戻ったときだけ Login へ遷移する。
6. **email の trim**: SPEC-140 は Password だけ trim を禁じる。email は前後の空白を除いて検証・送信する（利用者の貼り付け誤りに寛容）。
7. **不正な `continue` の扱い**: Design §7 の「不正な値は mypage 扱い」に従い、Login 後は `/mypage`、案内は「マイページの利用」。silent に捨てて通常 Login（案内なし）にはしない。
8. **S6 の placeholder `/mypage`**: PG-MYP-001 は S8 の範囲だが、Login 成功の既定の遷移先（SPEC-050 §15.3）と AuthGate / Logout back の E2E に実在する保護 route が要る。S6 は h1 と固定の一文だけの placeholder とし、S8 が置き換える。`/purchase/orders/{ref}` の route は S7a の範囲（S6 では作らない。key と gate の純粋ロジックだけ検証する）。
10. **`?notice=password-updated`**: Password reset 完了後の通知のための、このモックの内部 query である（Secret を含まない固定値。SPEC-050 §15.5 は成功後に PG-AUTH-003 へ遷移するとだけ定める）。
9. **pageshow**: bfcache 復帰時の再確認は `window.location.reload()` とする（再取得を確実にするため）。E2E は `PageTransitionEvent("pageshow", { persisted: true })` を dispatch して検証する（Chromium は headless で bfcache を無効にするため、実際の bfcache 復帰は再現できない）。
11. **検証 round 1 の訂正**: `email-verification-page.tsx`（PG-AUTH-002、SPEC-050 §15.2）は入力欄を持たないため、`noValidate` / `ErrorSummary` / `aria-busy` の form 要件（TC-PG-AUTH-003-511）の対象外とする（テスト側の誤りだった。対象は login / register / password-reset の2ページ）。
12. **【B5 C1】方式選択と Email OTP の mock の決定**（計画書 `ref/planning/20261029-b5-auth-methods.md` v4 の Q2 / Q5 / Q7 / Q-1。SPEC-050 §15.0 / §25）:
    - 新しい scenario 値・storage key・State・API は作らない。Email OTP の成否は既存の auth scenario を再利用する: `auth.login = "unavailable"` は要求・検証とも `unavailable`、`auth.login = "credential_failure"` は `code_invalid`、`auth.verify = "invalid_or_expired"` は `code_expired`（`code_invalid` と `code_expired` の両方が成り立つときは `code_invalid`）。scenario 値の名前は password 向けの語だが、mock の内部の切替であり意味は広げない（`unavailable` を「サービス利用不能」と読む中立な語として使う）。Fault Point ではない（TST-GEN-006）。
    - 失敗の種類は 2 つ（`code_invalid` = 入力し直し、`code_expired` = 期限切れまたは試行回数超過で再送）。provider が両者を区別できない場合の縮退は Production gate で決める（コードと文言は有効期限・試行回数の数値を持たない。TC-PG-AUTH-003-403）。
    - コードを送る mock は実際にはメールを送らない。コードの値は比較しない（空でなければ受理する）。コードはどこにも保存・記録・表示しない（TC-SEC-AUTH-018-101 / -702）。
    - コードでの Login は email の持ち主であることの証明になる（mock の user は `emailVerified: true` になる。Q7）。初回登録（未知の email）は `displayName: null` の user を作る（`signUp` と同じ。表示名を推測しない）。
    - 要求（`requestEmailOtp`）は、登録済み・未確認・未登録の email で同じ `{ kind: "sent" }` を返し、DB・session・storage を変えない（SEC-API-027）。未登録の email で user を作るのは `signInWithEmailOtp` だけ。
    - 方式の一覧は C1 では「Email+Password」「Email OTP」の 2 つである。C2 / C3 が SPEC-050 §15.0 の 4 方式の順序へ更新する。Google と Magic Link のテストは C1 に含まれない。
    - OTP の画面は Login / Registration の同じ route の中の状態で、URL を変えない（`continue` を保つ）。
13. **【B5 C2】Google の mock の決定**（計画書 v4 の Q3 / D0。SPEC-050 §15.0、FR-CRT-012 の外部完了認証の規則）:
    - 新しい scenario 値・storage key・API は作らない。開始の成否は既存の `auth.login = "unavailable"` を再利用する（`unavailable`）。取消・失敗は scenario ではなく、stand-in で `cancel` を押すこと。
    - stand-in の操作は 3 つ（`allowDemo` / `allowNew` / `cancel`）。計画書は「許可（`unverified@example.com` として）」を TC-PG-AUTH-003-310 の例に挙げるが、操作を 3 つに固定するため、未確認 Session の戻りは seed した Session で `returned=google` の URL を直接開いて検査する（stand-in に未確認の操作を足さない）。
    - stand-in の `success` / `failure` が欠落・不正のときは、3 つの操作をすべて `disabled` にして何も辿らない（計画書は「path は再度検査する」とだけ書く。不正のときの挙動を決めた）。
    - 戻りで Session が `unavailable`、または `notice=google-failed` の戻り（Session が何であっても）は `copy.auth.google.failed` の alert とした。`notice` は `returned` と同じく、読んだ直後に `history.replaceState` で URL から除く（§6.1C）。【B5 レビュー I-10】以前の「`notice` は URL に残してよい」は §6.1C と矛盾していたので改めた。E2E は `notice` が URL に残ることを assert しない。
    - 戻りの画面でどの radio が checked かは規定しない。
    - 受領の対象は未確認 Session も含む（手順 6 は「Email未確認のSessionを含む」）。未確認 Session の戻りでも `completeExternalAuthentication()` を呼んでから `PG-AUTH-002` へ遷移する。
    - Browser storage 自体を取得できない Guest は開始できる（手順 2）。ただし stand-in の許可は Session を storage に書くため、storage が使えないまま許可しても Session は残らない。E2E（TC-FR-CRT-012-018）は、開始と記録の不作成を storage 取得不可の状態で確かめ、許可の確認は storage を使えるようにして stand-in を再読込してから行う（計画書の「Cart の機能だけが停止表示のまま」は、storage が使えない状態では Session も残らないため E2E では確かめられない）。
    - 他の Tab で成立した Session によって開いている画面の Google の開始 button が無効になる（§6.1C）ことは、`SessionProvider` の既存の購読（`storage` event）に従う。
14. **【B5 C3】Magic Link の mock の決定**（計画書 v5 の D0 / C3。SPEC-050 §15.0「Magic Link: Email入力と送信状態を示す。Linkは5分有効。…別端末でLinkを開いても元画面は自動認証済みとせず、…確認前はGuestのままとする」、FR-CRT-012 の外部完了認証の規則）。仕様が定めない点を、テスト担当が次のように決めた（実装前の mock の決定。UCR は不要）:
    - 新しい scenario 値・storage key・API は作らない。送信の成否は既存の `auth.login = "unavailable"` を再利用する（`unavailable`）。無効・期限切れは scenario ではなく、代わりの画面で `openExpired` を押すこと。
    - 代わりの画面（`/dev/mock-magic-link`）の操作は 2 つ（`openValid` / `openExpired`）と email 欄 1 つ。リンクの持ち主を email で表す（`openValid` は欄の email のリンクを開く）。実際のメールは送らず、リンクを保持しない（mock の `requestMagicLink` は何も記録しないので、「送っていない email のリンクを開く」ことも可能。送信と有効なリンクの対応を mock は検査しない）。
    - **未確認の既存 user のリンクを開くと確認済みになる**（メールボックスの証明。Email OTP の Q7 と同じ）。stored user と Session が `emailVerified: true`。テスト担当の決定であり、仕様に明文は無い。
    - 期限切れのリンクを開く操作（`openExpired`）は backend（mock-auth の関数）を何も呼ばず、状態を変えない。単体テストの対象にならない（E2E が Session・user・Cart・metadata の不変を確かめる）。
    - 代わりの画面の `openValid` は、欄が空・形式不正のとき有効のまま何もしない（遷移しない）。
    - 送信状態: 送信が `sent` になったら送信 button の名前が `copy.auth.magicLink.resend` に変わる（`send` は消える）。新しい送信を始めた時点で alert を消す（status と alert は同時に出さない）。email 欄は残り値を保つ。送信状態から別方式へ切り替えて戻したときの表示は規定しない。
    - リンクを他の Tab・他の端末で開いたとき、送信した画面は結果を受け取らず、送信状態のまま何も判定しない（FR-CRT-012「戻りで表示された画面」。元の Tab は Session の継続にすぎない）。ただし他の Tab で Session が成立したことは既存の購読で見えるため、元の画面の再送 button は無効になる（§6.1D）。
    - 戻りの画面でどの radio が checked かは規定しない。`notice=link-failed` は `returned` と同じく、読んだ直後に `history.replaceState` で URL から除く（§6.1D）。【B5 レビュー I-10】以前の「`notice` は URL に残してよい」は §6.1D と矛盾していたので改めた。E2E は `notice` が URL に残ることを assert しない。失敗の戻り（`notice=link-failed`）が Session が成立している画面に着いた場合も、失敗の alert を出し、記録を消さない（成立した Session はこの失敗したリンクの結果ではない）。
    - Browser storage 自体を取得できない Guest は送信できる（手順 2）。このときも mock の送信は `sent` になる（TC-FR-CRT-012-018）。リンクを開く側は Session を storage に書くため、storage が使えないまま開いても Session は残らない（E2E は送信と記録の不作成だけを確かめる）。
    - `MagicLinkForm` が組んで port に渡す `successPath` / `failurePath` の値は、mock の送信が何も記録しないため、E2E では観察できない。値の正しさは静的検査（`externalReturnPath("magic-link"` / `externalFailurePath("magic-link"` を使うこと。TC-PG-AUTH-003-512）と `auth-return.test.ts`（TC-PG-AUTH-003-213）、代わりの画面の URL の契約（`s2-mock-backend.md` §14.3）の組で固定する。送信から代わりの画面への経路を mock が自動で作ることはしない（代わりの画面は開発者が直接開く）。
15. **【B5 レビュー F-3 / A-1】記録がある間に Session 未確定の復旧で由来が不明になった Cart の扱い**（計画書 v6 の F-3-5 A-1。ユーザー決定。UCR は出さない）: FR-CRT-012 のセル「由来不明のCartは、Login / 新規登録後にSession成立を確認した場合にclearする」と、外部完了認証の規則の手順 6（戻りで表示された画面以外の Session の確認では、その確認を理由に Cart を clear しない）は、結果待ち記録が残っている Cart が復旧（`recover("unknown")` または `abortTransition("unknown")`）で由来不明になった場合に、食い違って読める。**セルの規則を優先する**: 由来不明の Cart は、戻りで表示された画面以外の確認（`markAuthenticated`）でも clear し、**記録は残す**（手順 7。受領と Logout でだけ解消する）。手順 6 は、手順 2 で Guest 由来と確認した Cart（とその後の確認で付いた `authenticated`）を前提にした規則と読む。TC-FR-CRT-012-019 の「with a pending record, recover("unknown") keeps it」がこの読みを固定する。
16. **【B5 レビュー F-4】Session を確認できないときの理由の文言**: SPEC-050 §25 は文言を定めない。`copy.auth.google.sessionUnavailable` / `copy.auth.magicLink.sessionUnavailable`（§1 の listing）を、テスト担当が禁止語（SPEC-000 §3.2 / §3.3）を避けて決めた。原因（ログイン状態を確認できない）と次の行動（再読み込み、または時間をおく）を述べ、「ログアウト」を含まない。理由は試行の失敗ではない状態の説明なので、`role` を付けない周辺 text とした（alert / status にしない）。`loading` は一時的なので理由を出さない。Email OTP と Email+Password の form は Session が `unavailable` のときも無効にしない（現状の挙動を変えない。開始可否を仕様は定めない）。

## 10. Issue #8 の Cart 分離回帰契約

根拠は `FR-CRT-012` と `AR-SES-007` である。削除済みRule `AR-SES-010` は参照せず、既存TC ID `TC-AR-SES-010-001/002` の識別子のみ維持する。

- `tests/unit/web/cart/cart-lifecycle.test.ts` は実CartStoreと実CartLifecycleを同じstorageへ接続する。Session復元、明示Login / Session成立登録、確認待ち登録、Login失敗、Logout、別Tab通知、metadata読込・保存とCart clear障害、停止状態の持続と明示回復を検証する。
- 内部 `beginTransition` は `{ kind: "ready", provenance } | { kind: "busy" } | { kind: "blocked" }` を返し、保護境界の `expireAuthenticatedCart` は `done | busy | blocked` を返す。AuthPortは同一Browser内のCart遷移中と復旧必要状態を `cart_busy` / `cart_blocked` としてLogin / 登録画面へ伝える。
- Web Locks対応Browserでは認証遷移をTab間で排他する。未対応Browserでは同一Tab内のメモリ状態だけを使い、認証遷移中のmetadataを永続化しない。残存metadataと有効Lockが一致しない場合は認証を開始せず、Login / 登録からCartをclearして復旧する。
- 実行時の同期・非同期エラーでは、callback開始前の `DOMException(SecurityError)` だけをLock Manager取得不能と判定する（[Web Locks request手順](https://w3c.github.io/web-locks/#dom-lockmanager-request)）。同一Coordinatorに未完了の要求や保有Leaseがなく、metadataが取得でき、欠落または有効な非遷移metadataである場合だけメモリ制御へ切り替える。正常な競合は `busy` のまま扱い、原因不明・Abort・非active Document・不正optionsのエラーを利用不能と混同しない。メモリ制御へ切替後も各取得時にmetadataを再確認する（`TC-FR-CRT-012-013/014`）。
- 遷移マーカーがある場合は、実行時フォールバックでその所有者を確認できないため、認証開始とメモリ制御によるclear復旧を許可しない。切替前ならWeb Locks復旧後の明示的操作でLockを取得してclearできる。切替後に新たなマーカーを検出した場合や、取得済みLeaseの要求が異常rejectして所有状態が不明になった場合は、再読込してWeb Locksを再評価するまで停止を維持する。単にマーカーを削除して停止を解除しない。
- metadata / Cart storageが利用できない場合、Cartだけを停止する。確立済みのAuth結果は維持し、AuthGateとCartを使わないKaraoke閲覧・認証済み購入は継続する。
- Cart キーを読めない場合は、metadata が有効でも Cart を停止し、Login / 登録の開始を `cart_blocked` にする（Guest Cart を維持したまま Login へ進まない）。復旧は Cart キーを再び読めることを確かめてから `recovered` とする（TC-FR-CRT-012-015）。
- 【Q-1。利用者決定: 止める挙動を維持する。UCR は起票しない】Cart キーの `getItem` だけが例外を投げ、lifecycle metadata が `guest` を示す場合でも、「Guest 由来の metadata だけでは、読めない Cart を安全と確認できたとみなさない」。認証へ越境する操作はすべて止め、明示的な復旧（`recover`）を出す。TC-PG-CRT-001-543（`tests/e2e/cart-failure-modes.spec.ts`）が次を固定する（Cart キーの読み取りを、ページから戻せる fault で再現し、metadata は `{ version: 1, provenance: "guest" }`）:
  1. 保護ページ（`/mypage`）へ行った Guest: AuthGate は Login へ redirect せず `CartRecovery`（`role="alert"` に `copy.cart.lifecycleBlocked.title`、復旧 button `copy.cart.lifecycleBlocked.retry`）を出す。URL は `/mypage` のまま、保護内容（`MARKER_PROTECTED_TEXT`）なし、Login 見出しなし、main frame の遷移なし。
  2. Guest の Karaoke 購入開始（`guestButton`）: Login へ handoff せず `cart_recovery` になる（`CartRecovery` を Slot 画面に出し、button は disabled、Login へ遷移しない）。Order も Hold も作られず、Slot は AVAILABLE、mock DB は不変、session は Guest のまま。
  3. Login / 登録の送信: `CartRecovery` を出し、submit button は disabled。disabled を迂回した送信（`form.requestSubmit()`）も `cart_blocked` になり、画面に留まる（Guest のまま、mock の session key への書き込み 0 回 = 認証の raw 呼び出しなし、credential / service の失敗文言なし）。
  4. Cart キーが再び読めるようになった後の復旧操作: 停止が解ける。保護ページは `/account/login?continue=mypage` へ redirect し、Karaoke の次の操作は `/account/login?continue=karaoke-slot...` へ handoff し（Order は作られない）、Login はサインインして `/mypage` に着く。
  5. 【B5 C1】Email OTP も同じ規則で止まる（§6.1B）。Cart キーを読めないとき、コード要求の button（`copy.auth.otp.send`）は disabled、`form.requestSubmit()` による迂回も `cart_blocked` で `sent` の status もコード入力も出さず、mock の session key への書き込みは 0 回。コード要求の後で Cart キーが読めなくなった場合も、コード送信（`submitLogin`）は disabled で、迂回しても `cart_blocked`。復旧操作のあとは OTP Login が成功する。Email OTP による登録（§6.2A）も同様に止まる。単体では `TC-FR-CRT-012-016`（`tests/unit/web/auth/cart-lifecycle-auth-port.test.ts`）が、`signInWithEmailOtp` の成功（Guest Cart 維持と由来 `authenticated` の記録、由来が `authenticated` / 不明の Cart の clear）、失敗（Cart 不変）、`cart_busy`（遷移中、他 Tab の Web Lock、自身の実行中）、`cart_blocked`（Cart キー不読）と、`requestEmailOtp` が Cart に書かないことを固定する。
  6. 【B5 C2】Google も同じ規則で止まる（§6.1C、§6.2B、§10A の手順 2）。Cart キーを読めないとき、Google の開始 button は disabled、disabled を外して押されても `cart_blocked` で、`/dev/mock-google` へ移らず、mock の session key への書き込みは 0 回、metadata に `external` を作らない。復旧操作のあとは開始でき、stand-in に着いた時点で `external: "pending"` がある。Browser storage 自体を取得できない場合は、開始を妨げず記録を作らない。TC-FR-CRT-012-018（`cart-failure-modes.spec.ts`）が固定する。
  7. 【B5 C3】Magic Link も同じ規則で止まる（§6.1D、§6.2C、§10A の手順 2）。Cart キーを読めないとき、送信 button は disabled、disabled を外して押されても `cart_blocked` で、`sent` の status を出さず、`/dev/*` へ移らず、mock の session key への書き込みは 0 回、metadata に `external` を作らない。復旧操作のあとは送信でき、`sent` の status と `external: "pending"` が現れる。Browser storage 自体を取得できない場合は、送信を妨げず記録を作らない。TC-FR-CRT-012-018（`cart-failure-modes.spec.ts` の Magic Link の describe）が固定する。
  - 読めるが壊れた Cart 本体は停止ではなく `corrupted`（s5-cart.md §2.3）で、この規則の対象外。
- `tests/e2e/auth-gate-logout.spec.ts` の既存Issue再現は、公開Login画面と失敗Loginで旧Cartの保存値が維持され、成功時に初めてclearされる順序をassertする。
- `tests/e2e/cart-session-isolation.spec.ts` はAuthGateとCart / Guest KaraokeのLogin handoffで、必要なCart clear失敗中は遷移しないこと、AuthGateのstorage取得不可時はLoginへ進むことを検証する。Karaoke Slotは表示を保ち、Authenticated Userの購入開始がCart停止中も進むことを検証する。ActionはAPIで初めて期限切れが分かる場合と、UIが既にGuestを認識している場合の双方を検証する。【B4c】Karaoke Slotは購入開始の前に本人向け判定（`API-PUR-ELG-001`）を読むため、Karaokeの `api_expiry` ケース（TC-FR-CRT-012-006）は、期限切れにする前に購入 button が有効になる（事前判定の完了）ことを待つ。事前判定を期限切れ後のSessionで読むと、このケースが検証する「APIで初めて期限切れが分かる」前提が崩れるためである。期待値は変えない。
- 既存Cart fixtureはGuest / authenticatedの非識別由来を明示する。由来不明・legacy Cartは専用Unitで検証し、通常の購入ケースに紛れ込ませない。
- 初回のlocalStorage取得不能からの回復成功時はPageを再読込し、AuthPortのlifecycle連携とHeader / Cartの購読を再初期化する。通常のstorage障害からの回復は同じPage内で完了する。
- 初回取得不能はPage内で固定し、storageだけが復旧した場合や、その間にLoginしてclient navigationした場合もCartの内容・件数・編集・購入を再表示しない。明示的回復だけがstorageを再取得し、Cart clearとmetadata更新を行う。いずれかが失敗した場合は停止を維持し、成功後も再読込まではLifecycleを公開しない（`TC-FR-CRT-012-012` と `TC-FR-CRT-012-007`）。
- 同じTabのLogin / Logoutが重なっても、それぞれのcleanupを順に完了してからSession照会・通知を公開する。認証成立後のmetadata保存失敗は、確認済みUserのMypage表示と未確認UserのEmail Verificationへの遷移を妨げず、Cartだけを停止する。

これらはBrowser storage境界のUnitおよび補助UI mock suiteであり、production G8、API / DB / Provider coverageではない。mock業務データがclear前後で同一であることはBrowser suite内で比較する。runner retryは0のままとする。

## 10A. 外部完了認証と Cart lifecycle（B5 C2。FR-CRT-012 の外部完了認証の規則 手順 1〜10）

根拠は `FR-CRT-012` の表の直後の「FR-CRT-012 の外部完了認証の規則」（SPEC-020 2.1.0）と `SPEC-050` §15.0（2.2.0）である。UCR を参照しない。Google が最初の外部完了認証、【B5 C3】Magic Link が 2 つ目で、**同じ 2 つの lifecycle method**（`beginExternalAuthentication` / `completeExternalAuthentication`）を使う（lifecycle は方式を区別しない。decorator が `startGoogleSignIn` と `requestMagicLink` の両方で呼ぶ）。表の「decorator の `startGoogleSignIn`」は「`startGoogleSignIn` / `requestMagicLink`」と読み替える。unit は `cart-lifecycle-external.test.ts` が Google と Magic Link の両方の starter で同じ journey を回し（TC-FR-CRT-012-019）、`cart-lifecycle-auth-port.test.ts` が `requestMagicLink` の decorator を固定する（TC-FR-CRT-012-019）。**外部完了認証の戻りで表示された画面** = `returned=…` を付けた URL を**文書の読み込み**で開いた PG-AUTH 画面（読んだ直後に URL から外す。§6.1C）。再読込、戻る・進む、開始した元の画面、他の Tab の画面、`returned` を持たない通常の訪問は、これに当たらない。

### CartLifecycle の追加 method（`features/cart/cart-lifecycle.ts`）

```ts
beginExternalAuthentication(lockAcquired?: boolean): { kind: "ready" } | { kind: "busy" } | { kind: "blocked" };
completeExternalAuthentication(): void;
```

metadata に任意 field `external?: "pending" | "superseded"` を 1 つ足す（storage key は `r39x.cart-lifecycle.v1` のまま。`external` の無い既存の保存値 `{ version: 1, provenance }` はそのまま有効）。metadata が持つのは `version` / `provenance`（と、認証遷移中の識別）/ `external` だけで、email・Account・Role・credential・それらの hash を持たない。値が `pending` / `superseded` 以外、または未知の field があれば不正（由来不明）。【B5 レビュー F-3】由来不明の Cart に記録がある場合だけ、非遷移の `{ version: 1, provenance: "unknown", external }`（`external` は必須で `"pending"` / `"superseded"`）を書く。記録が無い由来不明は、従来どおり metadata key を持たない（`write("unknown")` は key を消す）。`{ version: 1, provenance: "unknown" }`（`external` 無し）、`external` が `pending` / `superseded` 以外、未知の field を持つ値は不正（由来不明で記録も無い）である。この形を読む処理は、key が無い場合と同じ由来の判定をする（`initializeGuestIfEmpty` は Cart key が無ければ空の Cart を Guest 由来にして記録を保ち、Cart があれば何もしない。`markAuthenticated` は Cart を clear して `{ authenticated, external }` にする。手順 6 の判定は `external` で行う）。どの処理も記録を保つ。storage key・`version`・`CartProvenance`・`CartLifecycleSnapshot` は変えない。

| 手順 | 内容 | 担当 | 検査 |
|---|---|---|---|
| 1 | Guest だけが開始できる（Email 未確認の Session を持つ利用者は Guest ではない） | decorator の `startGoogleSignIn`（`already_signed_in`。raw を呼ばない） | TC-FR-CRT-012-017（unit）、TC-PG-AUTH-003-313（E2E） |
| 2 | 開始は認証遷移。要求の前に由来不明・`authenticated` の Cart を clear し、Guest 由来は保持。clear 後の Cart は Guest 由来。Cart / metadata を読み書き・clear できなければ開始しない（`blocked`）。storage 自体を取得できなければ開始を妨げず、記録を作らない | `beginExternalAuthentication`（`ready` / `busy` / `blocked`）。storage 取得不可は decorator を通らない | TC-FR-CRT-012-017、TC-FR-CRT-012-018（E2E） |
| 3 | clear と metadata 更新が成功した後、**raw を呼ぶ前**に `external: "pending"` を作る。既にあれば置き換える。raw が `unavailable` でも reject しても残す | `beginExternalAuthentication` と decorator | TC-FR-CRT-012-017、-019 |
| 4 | 要求を終えた時点で遷移記録を解消し、Lock を残さない。記録は Cart を停止しない（他の Tab から見ても `orphanedTransition` にならない） | `beginExternalAuthentication` | TC-FR-CRT-012-017 |
| 5 | 記録がある間に別の方式（Email+Password、新規登録、Email OTP）で Session が成立したら（Email 未確認を含む）`external` を `"superseded"` にする。`confirmation_required` / `credential_failure` / `unavailable` / 誤ったコードは成立ではない。【B5 レビュー F-2】**必要な Cart の clear（由来が Guest 以外）が失敗しても、`superseded` の記録は残す**（認証は成立のまま、Cart だけが停止する。復旧は記録を保つので、その後の受領が手順 6 で Cart を clear する） | `finishLogin`（decorator の `signIn` / `signUp` / `signInWithEmailOtp` の成功） | TC-FR-CRT-012-019（Google と Magic Link の両方） |
| 6 | 受領 = 記録がある Browser で、戻りで表示された画面が成立した Session を確認した時点（Email 未確認を含む）。1 回の戻りにつき 1 回。開始時点の由来（Guest 由来）と手順 5 の有無だけで判定: `pending` → Cart を保持、`superseded` → Cart を clear。記録後に Session の確認で付いた `authenticated` の由来は判定に使わない。戻りで表示された画面以外の確認は受領でも手順 9 でもなく、`external` を消さず Cart を clear しない | `completeExternalAuthentication`（戻りの画面だけが呼ぶ）。判定は lifecycle の作成時の metadata の写し（`initialMetadata`）で行う | TC-FR-CRT-012-017、-019、TC-PG-AUTH-003-310、TC-FR-CRT-012-020 |
| 7 | 記録は受領と Logout でだけ解消する。中止・失敗・期限切れの戻り（`completeExternalAuthentication()` を呼ばない）では解消せず、開始時に clear した Cart も戻さない | 受領: `completeExternalAuthentication`。Logout: `finishLogout`。`expireAuthenticatedCart` / `recover` / `abortTransition` は記録を残す。Session 未確定の復旧（`CartRecovery` が `recover("unknown")` を呼ぶ場合）と、メモリー制御の遷移の中止（`abortTransition("unknown")`）でも残す（由来不明の形 `{ version: 1, provenance: "unknown", external }`。【B5 レビュー F-3】） | TC-FR-CRT-012-017（`abortTransition`、保存形）、-019（Session 未確定の復旧）、TC-PG-AUTH-003-310 |
| 8 | 開始時に clear した Cart を失敗の戻りで復元しない | （clear は戻さない） | TC-FR-CRT-012-017 |
| 9 | 記録が無い Browser で戻りで表示された画面が成立した Session を確認した場合（Link を別端末で開いた場合を含む）は、確認の直前の Cart の由来に従う: Guest 由来は保持、由来不明・`authenticated` は clear。1 回の戻りにつき 1 回。2 回目の戻り（受領の後は由来が `authenticated`）は有効 Session 中の再 Login と同じ扱い（clear） | `completeExternalAuthentication`（記録が無いとき）。`initialMetadata` の由来で判定 | TC-FR-CRT-012-017、-019 |
| 10 | 有効な Session があり、別の Session が成立したが、戻りで表示された画面による確認（手順 6・9）が行われない場合は、記録の有無にかかわらず元の Session と区別できない。他者の Cart を表示しないことは、次の戻りで表示された画面による確認か Logout まで保証しない（**限界**） | （lifecycle は何も clear しない） | TC-FR-CRT-012-019 (10)(11)。限界の挙動を固定するだけで、他者の Cart を出さないことの証明ではない |

- 「戻りの文書」は unit では、同じ storage の上に**新しい lifecycle instance を作る**ことで表す（作成時に `initialMetadata` を取る）。「元の Tab」は送信に使った instance、「他の Tab」は別の instance。`completeExternalAuthentication()` を呼ぶのは戻りの文書の instance だけ。
- `completeExternalAuthentication()` は throw しない（storage の失敗は Cart の機能だけを停止し、認証は成立のまま。FR-CRT-012 の「認証処理自体は成立結果を維持」）。同じ instance で 2 回目に呼んでも metadata・Cart を変えない（1 回の戻りにつき 1 回）。
- 受領後の metadata は `external` を持たず、provenance は `authenticated`。受領しない戻り（中止・失敗・Guest のままの戻り）の metadata は変わらない。
- **R11（前提）**: 手順 6・9 の判定は文書の作成時の写しに結び付くので、`returned=…` を持つ URL は文書の読み込みで開くことを前提にする。SPA 内の遷移（`router.push` / `Link`）で `returned=…` を開く経路を作ると写しが古くなり判定を誤る。TC-PG-AUTH-003-310 の「再読込」「戻る・進む」と、TC-PG-AUTH-003-512 の静的検査（`completeExternalAuthentication` を auth 画面だけが呼ぶ）が、この前提を固定する。
- Cart lifecycle decorator（§3B）の他の規則は §3A の `signIn` と同じ: 遷移中は `cart_busy`、Cart キーを読めない（Q-1）・停止中・孤立した遷移記録は `cart_blocked`。mock の stand-in が Session を直接書いても、結果の受領は戻った画面の仕事である。

### Magic Link の journey（B5 C3。TC-FR-CRT-012-019 / -020、TC-PG-AUTH-003-310）

- リンクは送信した Tab・他の Tab・他の端末のどれでも開かれうる。**戻りで表示された画面**は、リンクを開く操作で `returned=magic-link` / `notice=link-failed` の URL を文書の読み込みで表示した PG-AUTH 画面だけ。送信した画面は、送信状態のまま Session が成立しても受領でも手順 9 でもない（`external` を消さず Cart を clear しない）。
- 他の Tab でリンクを開いた場合: その Tab が受領する（`pending` → Cart 保持、`superseded` → clear）。送信した Tab は遷移も失敗表示もせず、再読込しても判定しない。Cart は storage を共有するので、受領した Tab の結果が送信した Tab の Cart に現れる。E2E は受領した Tab の metadata（`external` 無し、由来 `authenticated`）と Cart が送信前と byte 一致すること、送信した Tab の送信状態と URL が不変であることを確かめる。
- 他の方式（Email+Password）が送信と受領の間に成立した場合（手順 5）: 受領で Cart を clear する。失敗の戻り（期限切れのリンク）は記録を `superseded` のまま残し、Cart も戻さない。続く有効なリンクの受領が clear する（TC-FR-CRT-012-020）。
- 記録の無い Browser（Logout で記録を消した、または別の Browser でリンクを送った）でリンクを開いた場合は手順 9: 確認の直前の Cart の由来に従う（`authenticated` → clear）。
- 計画書 v4 の R12（手順 9 の安全側の過剰な clear）: 記録が無い Browser で、他の Tab が戻りより先に Session を確認すると、確認の直前の由来が `authenticated` になり Guest の Cart も clear されうる。仕様の文に従う挙動であり、E2E は記録がある経路（手順 6）と、記録の無い経路を 1 つの Tab で作る場合（Logout で記録を消してから別アカウントでログインし直し、そのアカウントの Cart を持ったままリンクを開く）だけを確かめる。記録の無い経路で 2 つの page を開いたままリンクを開く E2E は作らない（順序依存。unit の TC-FR-CRT-012-019 で固定する）。

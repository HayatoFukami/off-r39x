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
```

- 既存 `copy.test.ts` の制約（全 leaf は trim 済みの非空 string か関数）を守る。上記の文字列は**そのまま**使う（`s6-copy.test.ts` が固定する）。
- `copy.auth.login.credentialFailure` は「どの要素が一致したか」を示さない（SPEC-050 §15.3、SEC-API-027）。`copy.auth.reset.accepted` は Account の有無を断定せず「場合」を含む。`copy.auth.verify.invalid` は `copy.auth.verify.verified` の文字列を**含まない**（確認済みと誤読させない）。
- `copy.pageState.unavailable` / `retry`（S1）は AuthGate の unavailable 表示で再利用する。
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
export type AuthMethod = "password" | "email-otp";
export const AUTH_METHODS: readonly AuthMethod[];        // C1: ["password", "email-otp"]（この順）
export const DEFAULT_AUTH_METHOD: AuthMethod;            // "password"（AUTH_METHODS[0]）
export function authMethodLabel(method: AuthMethod): string;
```

- `authMethodLabel("password")` = `copy.auth.method.password`、`"email-otp"` = `copy.auth.method.emailOtp`。ラベルは互いに異なる。GitHub / Discord / LINE / Apple の方式を持たない（SPEC-050 §15.0）。
- 仕様の順序は Email+Password、Google、Email OTP、Magic Link（SPEC-050 §15.0）。C1 は画面内で完結する 2 方式だけを提供し、C2（Google）・C3（Magic Link）が一覧とこのテスト（TC-PG-AUTH-003-212）を 4 方式の順序へ更新する。
- `features/auth/method-selector.tsx`（client。`MethodSelector`）: `<fieldset>` + `<legend>`（props で受ける）+ `AUTH_METHODS` を `type="radio"` の `<input>` と `<label>` で描画する。`useId` で id を作る。focus を動かさない（`autoFocus` / `.focus()` を使わない）。port・`fetch`・storage・`console` を使わない。`features/auth/email-otp-form.tsx`（client。`EmailOtpForm`）は §6.1B の OTP 2 step を担い、port は `useAuth()` 経由だけで呼ぶ。

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

- `h1` の下（Continuation の案内の下）、フォームの上に、`role="group"` の `<fieldset>`（accessible name = `copy.auth.method.legendLogin`）を描画する。中に `role="radio"` が 2 つ、この順: `copy.auth.method.password`、`copy.auth.method.emailOtp`（accessible name は exact）。初期は `password` が checked。GitHub / Discord の語は出さない。
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
- 未確認 User も、コードで Login すると確認済みになる（mailbox の証明。stored user と Session が `emailVerified: true`）。

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
- 認証フローの前後で、localStorage / sessionStorage の全内容（key と value）、URL、`main` のテキストに、入力した Password（テストの sentinel）と verification / reset の context が現れない（SEC-AUTH-018）。【B5 C1】Email OTP のコード（sentinel）も同様に、誤り・期限切れ・サービス失敗・成功のどの後でも、URL・storage・DOM のテキスト・console に現れず、コード欄は送信のたびに空になる（TC-SEC-AUTH-018-702）。390px 幅では方式の radio group、OTP の email step、コード step（欄・送信・再送・メール変更）が viewport 内に収まり横 scroll が無い（Login と登録。TC-PG-AUTH-003-504）。root layout の `<ScrollRestoration />` は `getKey` を渡さず既定の location key を使うので、sessionStorage の保存値に URL・query（`context` など）が入らない（`tests/e2e/static-hosting.spec.ts` TC-STACK-008-306）。

## 7. E2E の共通条件

- 時刻は `page.clock.setFixedTime(NOW_ISO)`（`fixClock`）。状態の仕込みは `seedLocalStorage`（`KEYS.session` / `KEYS.scenario` / `KEYS.cart`）。ナビゲーションは `gotoHydrated` / `reloadHydrated`（`HydrationMarker` は S5 で実装済み）。
- Seed の User: `demo@example.com`（確認済み）、`new@example.com`（確認済み）、`unverified@example.com`（未確認）、`other@example.com`（確認済み）。Password は mock が形だけ検査する（空でなければよい。`TEST_PASSWORD`）。メールアドレスは `example.com` だけ（TST-DAT-002）。
- scenario の auth 切替（`scenarioJson({ auth: {...} })`、`tests/harness/browser/auth.ts` の `authScenario(patch)` が既定値へ合成する）: `login` / `signup` / `verify` / `reset` / `resetContext` / `session`。scenario の失敗は mock 内の切替であり SPEC-170 の Fault Point ではない（TST-GEN-006）。【B5 C1】Email OTP は新しい値を作らず、`login`（`unavailable` / `credential_failure`）と `verify`（`invalid_or_expired`）を再利用する（§9 の 12）。E2E は `auth.ts` の `setAuthScenario(page, patch)` で、画面を開いたまま scenario を切り替えられる（mock は呼び出しごとに scenario を読む）。コードの sentinel は `SENTINEL_OTP_CODE`、通常のコードは `OTP_CODE`。

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
| `tests/e2e/cart-failure-modes.spec.ts` | §10 の Q-1（OTP を含む。TC-PG-CRT-001-543） |

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
  - 読めるが壊れた Cart 本体は停止ではなく `corrupted`（s5-cart.md §2.3）で、この規則の対象外。
- `tests/e2e/auth-gate-logout.spec.ts` の既存Issue再現は、公開Login画面と失敗Loginで旧Cartの保存値が維持され、成功時に初めてclearされる順序をassertする。
- `tests/e2e/cart-session-isolation.spec.ts` はAuthGateとCart / Guest KaraokeのLogin handoffで、必要なCart clear失敗中は遷移しないこと、AuthGateのstorage取得不可時はLoginへ進むことを検証する。Karaoke Slotは表示を保ち、Authenticated Userの購入開始がCart停止中も進むことを検証する。ActionはAPIで初めて期限切れが分かる場合と、UIが既にGuestを認識している場合の双方を検証する。【B4c】Karaoke Slotは購入開始の前に本人向け判定（`API-PUR-ELG-001`）を読むため、Karaokeの `api_expiry` ケース（TC-FR-CRT-012-006）は、期限切れにする前に購入 button が有効になる（事前判定の完了）ことを待つ。事前判定を期限切れ後のSessionで読むと、このケースが検証する「APIで初めて期限切れが分かる」前提が崩れるためである。期待値は変えない。
- 既存Cart fixtureはGuest / authenticatedの非識別由来を明示する。由来不明・legacy Cartは専用Unitで検証し、通常の購入ケースに紛れ込ませない。
- 初回のlocalStorage取得不能からの回復成功時はPageを再読込し、AuthPortのlifecycle連携とHeader / Cartの購読を再初期化する。通常のstorage障害からの回復は同じPage内で完了する。
- 初回取得不能はPage内で固定し、storageだけが復旧した場合や、その間にLoginしてclient navigationした場合もCartの内容・件数・編集・購入を再表示しない。明示的回復だけがstorageを再取得し、Cart clearとmetadata更新を行う。いずれかが失敗した場合は停止を維持し、成功後も再読込まではLifecycleを公開しない（`TC-FR-CRT-012-012` と `TC-FR-CRT-012-007`）。
- 同じTabのLogin / Logoutが重なっても、それぞれのcleanupを順に完了してからSession照会・通知を公開する。認証成立後のmetadata保存失敗は、確認済みUserのMypage表示と未確認UserのEmail Verificationへの遷移を妨げず、Cartだけを停止する。

これらはBrowser storage境界のUnitおよび補助UI mock suiteであり、production G8、API / DB / Provider coverageではない。mock業務データがclear前後で同一であることはBrowser suite内で比較する。runner retryは0のままとする。

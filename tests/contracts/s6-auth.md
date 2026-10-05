# S6 認証 契約書（PG-AUTH-001〜005 / Continuation Intent / AuthGate / Logout / no-store）

テスト担当が定義した S6 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/auth/*.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/auth-*.spec.ts`
- ハーネス: `tests/harness/browser/auth.ts`

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §3 AuthPort、§6、§7 Continuation、S6 行、Test plan U9 / U13 / E2E 3 / 24 後半 / Logout 後の back / header / no-store）、SPEC-050 v1.1.0 §7 / §8.2 / §8.3 / §9 / §10 / §15 / §22 / §25 / §26 / §31（3, 22, 24）/ §33、SPEC-060 §29（AR-CONT-001〜004）、AR-AUTH-006〜008、AR-SES-007 / 009、SPEC-140 SEC-WEB-009 / 013 / SEC-AUTH-016〜018 / SEC-API-027、SPEC-190 DEV-WEB-001〜013、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`。S1〜S5 の契約は**変更しない**（S2 の `AuthPort` / `mock-auth` / `session-store` / `password-policy`、S3 の `SessionProvider` / Header / `AccountMenu` は拡張のみ。既存 export の名前・シグネチャは変えない）。

共通の約束（S4 / S5 の約束を引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。`features/auth/**`、`src/auth/**` の新規ファイル、新規 `presentation/components/**` に**日本語の直書き・色の直書きを置かない**。
- page.tsx は Server Component の薄い殻（`metadata` だけ。route param は無い）。画面は `"use client"` の container が `useAuth()`（下記 §3）経由の `AuthPort` だけを呼ぶ。`mock/**` を import しない（import してよいのは `src/auth/index.ts` だけ。DEV-WEB-012）。`mock-auth` を直接呼ばない。
- パスワード・reset context・verification context は**どこにも保存・記録・表示しない**（SEC-AUTH-018）: URL（成功後・失敗後とも）、DOM のテキスト、localStorage / sessionStorage、console、Cookie に出さない。`console.*` を使わない。パスワードは **trim しない**（SEC-AUTH-016）。`maxLength` 属性を付けない（付けると 129 文字目以降が黙って切り捨てられ、検証エラーが見えなくなる）。
- 各ページの `h1` は 1 つだけ。`main` 内の `role="alert"` は同時に 1 つだけ（Next.js の route announcer は `main` の外）。
- 認証 UI は Guest / Authenticated のどちらでも閲覧できる（Actor は SPEC-050 §7 のとおり）。**既に Authenticated でも自動 redirect はしない**（login 成功後の自身の遷移と競合するため。曖昧さ 3）。

## 0. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/auth/continuation.ts` | 純粋（react / next を import しない） | `CONTINUATION_PARAM`, `ContinuationKey`, `ContinuationIntent`, `CONTINUATION_KEYS`, `parseContinuation`, `serializeContinuation`, `continuationPath`, `continuationCancelPath`, `continuationForPath`, `isSafeRelativePath`, `accountPath`, `PROTECTED_PATH_PREFIXES` |
| `apps/web/src/auth/gate-decision.ts` | 純粋 | `GateDecision`, `decideGate` |
| `apps/web/src/auth/auth-gate.tsx` | client | `AuthGate`（props `{ children: ReactNode }`） |
| `apps/web/src/auth/use-auth.ts` | client hook | `useAuth(): AuthPort`（`SessionProvider` が保持する同じ `AuthPort` instance を返す。`SessionContextValue` に `auth: AuthPort` を**追加**する拡張。既存の `state` / `signOut` は変えない） |
| `apps/web/src/features/auth/form-validation.ts` | 純粋 | `FieldName`, `FieldErrorCode`, `FieldError`, `FormValidation`, `normalizeEmail`, `validateLoginForm`, `validateRegisterForm`, `validateResetRequestForm`, `validateResetCompleteForm`, `fieldErrorMessage` |
| `apps/web/src/features/auth/continuation-view.ts` | 純粋 | `ContinuationNotice`, `describeContinuation` |
| `apps/web/src/features/auth/login-page.tsx` | client container | `LoginPage` |
| `apps/web/src/features/auth/register-page.tsx` | client container | `RegisterPage` |
| `apps/web/src/features/auth/email-verification-page.tsx` | client container | `EmailVerificationPage` |
| `apps/web/src/features/auth/password-reset-request-page.tsx` | client container | `PasswordResetRequestPage` |
| `apps/web/src/features/auth/password-reset-complete-page.tsx` | client container | `PasswordResetCompletePage` |
| `apps/web/src/presentation/components/form-field.tsx` | 純粋な表示部品 | `FormField` |
| `apps/web/src/presentation/components/error-summary.tsx` | 純粋な表示部品 | `ErrorSummary` |
| `apps/web/app/account/register/page.tsx` | route | PG-AUTH-001。`metadata.title = copy.auth.register.pageTitle` |
| `apps/web/app/account/email-verification/page.tsx` | route | PG-AUTH-002。`copy.auth.verify.pageTitle` |
| `apps/web/app/account/login/page.tsx` | route | PG-AUTH-003。`copy.auth.login.pageTitle` |
| `apps/web/app/account/password-reset/page.tsx` | route | PG-AUTH-004。`copy.auth.reset.pageTitle` |
| `apps/web/app/account/password-reset/complete/page.tsx` | route | PG-AUTH-005。`copy.auth.resetComplete.pageTitle` |
| `apps/web/app/(self)/layout.tsx` | route layout | `AuthGate` で `children` を包む（Design §3 の `(self)/layout.tsx`）。`/mypage/*` と `/purchase/*` を覆う |
| `apps/web/app/(self)/mypage/page.tsx` | route | **S6 の最小 placeholder**（S8 が PG-MYP-001 に置き換える。`h1` と AuthGate の配下を保つ）。`metadata.title = copy.mypage.pageTitle` |

route 用ファイルは `app/<path>/page.tsx` でも `app/(auth)/<path>/page.tsx` でもよい（`(self)` だけは上記の位置に固定）。title は `copy.<...>.pageTitle` に置き、`copy.pageTitle` へ足さない（S4 の `s4-copy.test.ts` が全 key を固定している）。`next.config.ts` の no-store ヘッダ（`/mypage/:path*`、`/purchase/:path*`、`/account/:path*`）は S0 で設定済みであり、変更しない。

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

`AuthGate`（`"use client"`。`app/(self)/layout.tsx` が `children` を包む）:

- `useSession()` と `usePathname()` から `decideGate` を求める。**`allow` のときだけ `children` を描画する**。`loading` / `redirect` / `unavailable` の間は保護 Content を DOM に出さない（最初の描画は常に `loading`。SSR を含む）。
- `loading`: `role="status"` + `copy.pageState.loading`。`redirect`: `role="status"` + `copy.auth.gate.redirecting` を描画し、`useEffect` で `router.replace(to)`。`unavailable`: `role="alert"` + `copy.pageState.unavailable(copy.auth.gate.subject)` + `<button type="button">` `copy.pageState.retry`（`window.location.reload()`。Login へ redirect しない）。
- Session が変わったとき（同じ tab の Logout、他 tab の変更 = `storage` event）に再評価される（`SessionProvider` が既に購読している。AuthGate は state の変化に従う）。
- `pageshow` イベントで `event.persisted === true`（bfcache 復帰）のとき、`window.location.reload()` で Session を確かめ直す（SPEC-050 §15.6、Design §7）。
- **Logout との競合**: Account menu の Logout（`SessionProvider.signOut`）は `PG-PUB-001`（`/`）へ遷移して終わる。AuthGate が authenticated → guest の変化を見て `router.replace(login)` を後から行い、`/` への遷移を上書きしてはならない（Logout 後の最終 URL は `/`）。実装方法は任意（coder 判断）。

`useAuth()`: `SessionContext` の値に `auth: AuthPort` を足し、画面 container は `useAuth()` だけで port を得る。画面 container が `createAuthPort()` を直接呼ばない（`SessionProvider` と同じ instance を使う。`onSessionChange` が同じ listener 集合に届くため）。

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

## 5. Continuation 表示（`features/auth/continuation-view.ts`。純粋）

```ts
export type ContinuationNotice = {
  notice: string; purposeLabel: string; returnAfter: string; revalidate: string;
};
export function describeContinuation(intent: ContinuationIntent | null): ContinuationNotice | null;
```

- `null` → `null`（通常の Login / 登録。案内を出さない）。
- それ以外 → `notice = copy.auth.continuation.notice`、`returnAfter = copy.auth.continuation.returnAfter`、`revalidate = copy.auth.continuation.revalidate`、`purposeLabel` は key で決める: `cart` → `purpose.cart`、`karaoke-slot` → `purpose.karaokeSlot`、`purchase-order` → `purpose.purchaseOrder`、`mypage*`（`mypage` で始まる 8 つ）→ `purpose.mypage`。価格・数量・Slot の日時など key 以外の情報を含めない（SPEC-050 §15.3「安全な一般名称」）。

## 6. DOM 契約（E2E が検査する）

共通: 本体は layout の `<main>` の中。`<form noValidate>`（ブラウザの組み込み検証を使わず、独自の error summary を使う）。入力は `<label>` で名前が付く（`getByLabel(…, { exact: true })`）。email は `type="email"`、`autoComplete="email"`、password は `type="password"`（Login は `autoComplete="current-password"`、Register / ResetComplete は `new-password`）。

**検証エラー**（クライアント側、Port を呼ぶ前）: 該当 field に `aria-invalid="true"` と、エラー文を含む要素への `aria-describedby`（hint がある field は hint と error の両方の id を空白区切りで含める）。`role="alert"` の error summary を form の**直前**に描画し、`copy.auth.form.errorSummaryTitle` と、エラーごとの `<a href="#<field id>">`（text = `fieldErrorMessage`）を含み、**送信後に focus を移す**（`tabindex="-1"`）。エラーが無い field に `aria-invalid="true"` を付けない。入力し直して再送信し、すべて通れば error summary は消える。検証エラーのとき Port を呼ばない（Session も storage も変わらない）。

**送信中**: submit button はネイティブ `disabled`、文字は `copy.auth.form.submitting`、form に `aria-busy="true"`（SPEC-050 §9.1）。二重送信しない。

**サービス失敗の表示**: 該当 container ごとに `main` 内の `role="alert"` 1 つ（error summary と同時に出さない）。Credential は保持しない（Port へ渡した後、state へ保存しない）。

### 6.1 `/account/login`（PG-AUTH-003）

- `h1` = `copy.auth.login.heading`。Continuation Intent（`?continue=`。`parseContinuation`。**不正な値は mypage の intent として案内を出す**）があるとき、`h1` の下に `describeContinuation` の 4 文（`notice` / `purposeLabel` / `returnAfter` / `revalidate`）を表示する。intent が無ければ案内を出さない。
- `?notice=password-updated`（これだけを認める。他の値は無視）のとき `role="status"` + `copy.auth.login.passwordUpdated`。それ以外では `main` に `role="status"` を出さない。
- Fields: `copy.auth.field.email.label`、`copy.auth.field.password.label`（hint なし）。submit `<button type="submit">` name = `copy.auth.login.submit`（exact）。
- Links（`main` 内）: `copy.auth.login.toPasswordReset` → `accountPath("password-reset", intent)`（intent があれば `continue` を引き継ぐ。**ただし不正値は `mypage` へ正規化した intent を使う**）、`copy.auth.login.toRegister` → `accountPath("register", intent)`、`copy.auth.login.cancel` → `continuationCancelPath(intent)`（intent が無ければ `/`）。
- 結果（`signIn`）:
  - `signed_in` + `emailVerified: true` → `continuationPath(intent)`（intent が無ければ `/mypage`）へ遷移。遷移先は現在状態を再取得する（Continuation は値を運ばない）。
  - `signed_in` + `emailVerified: false` → `accountPath("email-verification", intent)` へ遷移（Authenticated として購入等へ進めない）。
  - `credential_failure` → `role="alert"` + `copy.auth.login.credentialFailure`（email / password のどちらかを示さない。Session は guest のまま。Password 欄の値を URL・storage・DOM テキストへ出さない）。
  - `unavailable` → `role="alert"` + `copy.auth.login.unavailable`（未検証 User を Authenticated として扱わない。Session は guest のまま）。
- 検証: `validateLoginForm`。

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

- Account menu の `copy.layout.account.logout` button → 同じ tab で `/` へ遷移して終わる（Home。Login や `/mypage` ではない）。Session は guest（`r39x.mock.session.v1`）。Cart（`r39x.cart.v1`）と mock DB は**変更しない**（FR-CRT-012。既存 Order 等を削除・取消したように見せない）。
- Logout 後の Browser back で `/mypage` へ戻る → 保護 Content（`copy.mypage.heading` / `protectedMarker`）を一度も表示せず、`/account/login?continue=mypage` へ遷移する。
- Header（S3 の挙動を変えない）: Guest は `copy.layout.account.login` Link があり、`copy.layout.account.mypage` / Account menu button が無い。Authenticated は逆。Login / Logout の直後に追加の reload なしで切り替わる。Login / Logout で Header の Cart 数は変わらない。

### 6.8 no-store と共通（`/account/*`、`/mypage`）

- `/account/login`、`/account/register`、`/account/email-verification`、`/account/password-reset`、`/account/password-reset/complete`、`/mypage` の GET が **HTTP 200** で、`Cache-Control` が `no-store` と `private` を含み、`Pragma: no-cache`（SEC-WEB-009。S0 の `next.config.ts` で設定済み。route が実在して初めて 200 になる）。`/`、`/cart`、`/entry` は `private` を含まない（S4 / S5 のまま）。
- 各ページは title = `${copy.<…>.pageTitle} | ${SITE_NAME}`、`h1` が 1 つ、`pageerror` / `console.error`（resource load 失敗を除く）が無く、外部 origin へ要求せず、`/admin` / `/staff` への href が無く、390px 幅で横 scroll が無い。
- 認証フローの前後で、localStorage / sessionStorage の全内容（key と value）、URL、`main` のテキストに、入力した Password（テストの sentinel）と verification / reset の context が現れない（SEC-AUTH-018）。

## 7. E2E の共通条件

- 時刻は `page.clock.setFixedTime(NOW_ISO)`（`fixClock`）。状態の仕込みは `seedLocalStorage`（`KEYS.session` / `KEYS.scenario` / `KEYS.cart`）。ナビゲーションは `gotoHydrated` / `reloadHydrated`（`HydrationMarker` は S5 で実装済み）。
- Seed の User: `demo@example.com`（確認済み）、`new@example.com`（確認済み）、`unverified@example.com`（未確認）、`other@example.com`（確認済み）。Password は mock が形だけ検査する（空でなければよい。`TEST_PASSWORD`）。メールアドレスは `example.com` だけ（TST-DAT-002）。
- scenario の auth 切替（`scenarioJson({ auth: {...} })`、`tests/harness/browser/auth.ts` の `authScenario(patch)` が既定値へ合成する）: `login` / `signup` / `verify` / `reset` / `resetContext` / `session`。scenario の失敗は mock 内の切替であり SPEC-170 の Fault Point ではない（TST-GEN-006）。

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
| `tests/e2e/auth-common.spec.ts` | §6.8 |

## 9. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **Continuation key の一覧**: Design §7 は「cart, karaoke-slot, purchase-order, mypage と mypage 配下の各 key」とだけ書く。→ §2 の 13 個に固定した（SPEC-060 §29.1 の許可例と SPEC-050 §17.2 の Mypage 構成から導いた）。Entry / Goods の販売 Page への key は、Cart 導入後は不要（SPEC-060 §29.1 / SPEC-050 の例が Cart 導入前の記述。OI-6 と同じ性質）なので作らない。
2. **QR ページは復帰先にしない**: QR は保護 path だが key を持たず、AuthGate の逆引きは `mypage` へ寄せる。QR 提示は直前の認証・Owner 再検証を要するため（SEC-QR-012 / 013 の趣旨）。
3. **既に Authenticated で Login / 登録を開いたとき**: SPEC-050 に規定がない。自動 redirect は、login 成功直後の自身の遷移と競合するため行わない（フォームをそのまま出す）。
4. **verification / reset context の運び方**: Design / SPEC-050 は context の運び方を定めない。mock では `?context=<opaque>` の query とし、読み取り後に URL から除去する（SEC-AUTH-018 の趣旨: token を URL に残さない）。実 Supabase Auth では provider の redirect 規約に従う（UCR 不要。実装前の mock の決定）。
5. **Logout と AuthGate の競合**: §3 のとおり、Logout 後の最終 URL は `/`（SPEC-050 §15.6）。back で保護 Page に戻ったときだけ Login へ遷移する。
6. **email の trim**: SPEC-140 は Password だけ trim を禁じる。email は前後の空白を除いて検証・送信する（利用者の貼り付け誤りに寛容）。
7. **不正な `continue` の扱い**: Design §7 の「不正な値は mypage 扱い」に従い、Login 後は `/mypage`、案内は「マイページの利用」。silent に捨てて通常 Login（案内なし）にはしない。
8. **S6 の placeholder `/mypage`**: PG-MYP-001 は S8 の範囲だが、Login 成功の既定の遷移先（SPEC-050 §15.3）と AuthGate / Logout back の E2E に実在する保護 route が要る。S6 は h1 と固定の一文だけの placeholder とし、S8 が置き換える。`/purchase/orders/{ref}` の route は S7a の範囲（S6 では作らない。key と gate の純粋ロジックだけ検証する）。
10. **`?notice=password-updated`**: Password reset 完了後の通知のための、このモックの内部 query である（Secret を含まない固定値。SPEC-050 §15.5 は成功後に PG-AUTH-003 へ遷移するとだけ定める）。
9. **pageshow**: bfcache 復帰時の再確認は `window.location.reload()` とする（再取得を確実にするため）。E2E は `PageTransitionEvent("pageshow", { persisted: true })` を dispatch して検証する（Chromium は headless で bfcache を無効にするため、実際の bfcache 復帰は再現できない）。
11. **検証 round 1 の訂正**: `email-verification-page.tsx`（PG-AUTH-002、SPEC-050 §15.2）は入力欄を持たないため、`noValidate` / `ErrorSummary` / `aria-busy` の form 要件（TC-PG-AUTH-003-511）の対象外とする（テスト側の誤りだった。対象は login / register / password-reset の2ページ）。

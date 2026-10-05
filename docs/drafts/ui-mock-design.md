# 画面モック 設計書（承認済み）

> 状態: ユーザー承認済み（2026-10-04）。planner の出力を原文のまま保存し、承認時の決定を先頭に追記した。
> 正式仕様ではない。仕様は `docs/specs/` が正である。

## 承認時の決定（ユーザー回答）

- 設計の方針を承認し、仕様改訂から着手する。OI-1 は SPEC-190 1.2.0（DEV-WEB-010〜013）、OI-2 は SPEC-170 1.2.0（TST-UNT-004 / TST-E2E-003 / TST-E2E-004）で反映済み。OI-3 / OI-4 は UCR-110-001 / UCR-100-001 として SPEC-110 / SPEC-100 に記録済み。
- OI-5: ルート直下ファイル（package.json、pnpm-workspace.yaml、biome.json、tsconfig.base.json、.gitignore。lockfile は S0 の `pnpm install` で生成）はオーケストレーターが作成する（作成済み）。coder は `apps/**`、`packages/**`、`scripts/**`、`traceability/rule-code-map.json` のみ扱う。
- OI-7: `packages/shared` ではなく `packages/domain` を使う。

## 以下、planner 出力（原文）

Task scope:
- 要求: SPEC-050 v1.1.0が定める一般利用者向け画面のUIモック（実バックエンドなし）を作る。対象は PG-PUB-001〜003、PG-TKT-001、PG-KRK-001〜003、PG-GDS-001〜002、PG-CRT-001、PG-AUTH-001〜005とLogout、PG-XFN-001〜003、PG-MYP-001〜012、Global Header / Footer（Sponsor Logo領域を含む §8.5）。あわせて §20のDomain State→UI対応、§21のPending/Failure/Retry、§22のreload/back、§24のResponsive、§24.3の差し替え容易性、§25のAccessibilityを満たす。`ref/Dev/payment-mock` を参考にし、フォルダ構成は SPEC-010/SPEC-190 に従う。
- 変更対象: リポジトリscaffold（pnpm workspace、Biome、TypeScript base）、`apps/web`（Next.js App Router）、`packages/domain`（Canonical Stateの型だけ）、`scripts/`（import境界検査、traceability検証、secret scan）、`tests/`（Vitest / Playwright）、`traceability/rule-code-map.json`。
- 受入条件: SPEC-050 §31の1〜29のうちモックで観測できる項目を、mock modeのPlaywrightで確認できる。§20/§21の全状態を `/dev/scenarios`（開発専用で一般導線外）から再現できる。Cartは参照と数量だけを持つ（FR-CRT-003）。購入開始はall-or-nothing（BR-ORD-014）。Browser Returnだけでは成功を表示しない（PAY-BRW-001〜003）。視覚表現は tokens / copy / asset slot で差し替えられる。
- 非対象: Administrator / Staff画面（SPEC-130）、コンビニ払い（SPEC-070 §8でcardのみ）、Hono API、DB、Supabase Auth / Stripe / Resendの実連携、CI（GitHub Actions）とdeploy（SPEC-180）、本番のCSP nonce / セキュリティヘッダ一式（no-storeは対象に含める）、hololive等の外部素材（画像・文言・ロゴは一切使わず、gradientとテキストのplaceholderにする）。

Change classification:
- UI-only（主分類。必読: SPEC-050, SPEC-140, SPEC-170。最低限のテスト: Unit + 影響するE2E）
- Security-sensitive（部分的）: Continuation Intentのsanitize（SEC-WEB-013 / AR-CONT-001〜003）、protected routeのno-store（SEC-WEB-009）、公開コンテンツのplain-text描画（SEC-WEB-017〜020）、QR表示の制限（SEC-QR-012/013）。APIが存在しないため、Security TestはUnit levelとmock E2Eで行う。
- Test-only（tests/ と manifest の新設）
- 該当しない: API contract / DB / Payment（Stripe呼び出しなし）/ QR・Check-in（Staff側なし）/ Email / Reliability / Infrastructure（CIとdeployは変更しない）。repo scaffoldは SPEC-190 Part I の範囲で扱う。

Canonical owners read:
- SPEC-000（§8 優先順位、§15.2 UCR、§21）
- SPEC-050 v1.1.0（全章。特に §5, §7〜§10, §11〜§19, §20〜§26, §31, §33）
- SPEC-050 の depends_on: SPEC-020 v1.1.0（FR-CRT-001〜012, FR-PUB-011〜015）、SPEC-030 v1.1.0（§7, §8.2〜8.4, §11.2, §11.4〜11.9, §26.1）、SPEC-040 v1.1.0（§16A UF-CRT-001）
- SPEC-010（§8.1 技術スタック、§9.1〜9.2、§19 Monorepo）
- SPEC-190（§6〜§16, §21〜§24, §26, §28, §32〜§40, §44）
- SPEC-170（§4〜§9, §10〜§13, §21, §65〜§70, §72〜§76, §80〜§81）
- SPEC-140（§14, §21〜§28, §37, §58）
- 関連として参照: SPEC-060（§10, §11〜§13, §29 Continuation）、SPEC-070（§8, §9, §13, §14）、SPEC-110（§20〜§22, §26, §28〜§31, §33〜§35）、SPEC-100 §14.1、SPEC-180（§13, §43）

Canonical rules:
- 画面・状態: SPEC-050 §8.5（Header CTA「チケットを購入する」、Cart数量を文字とaccessible nameで示す、0件なら数字非表示、Sponsorは0件・取得失敗とも領域非表示、画像失敗時は名称テキスト）、§9（Loadingで業務結果を仮表示しない、Emptyは正常0件だけ）、§9.6（Retry 4分類）、§16.3〜16.8、§20.1〜20.5、§21、§22、§24.3、§25、§26.2（他者Dataを先に描画しない）、§33の実装禁止事項
- Cart / 複合Order: FR-CRT-001〜012、BR-ORD-013〜020、DI-030-013、BR-ORD-004/005/008、BR-SAL-005
- 公開: BR-EVT-001/002/005、FR-PUB-011〜015
- Invariant（UI上の具体化は SPEC-050 §30）: INV-010-01, 02, 03, 05, 07, 08, 09, 10
- 認証: AR-AUTH-006〜008、AR-SES-007/009、AR-CONT-001〜003、AR-AZ-011
- Security: SEC-WEB-004（外部font禁止）、SEC-WEB-005、SEC-WEB-009、SEC-WEB-012、SEC-WEB-013、SEC-WEB-016〜020、SEC-WEB-024、SEC-AUTH-016〜018、SEC-API-027、SEC-QR-012/013、SPEC-110 §22（他者所有と不存在を同じ404にする）
- 決済表示: PAY-BRW-001〜003、PAY-CHK-013、SPEC-070 §8（cardのみ。Karaokeを含むcross-domain cartなし）
- 開発規約: DEV-REP-001/004/006、DEV-DEP-001〜007、DEV-TS-001〜014、DEV-WEB-001〜009（+ DEV-WEB-010〜013 は承認後に追加）、DEV-AUTH-003/005/009、DEV-SEC-004、DEV-TQR-002、DEV-REL-001、DEV-AI-002/003/005、DEV-TRC-001〜003
- テスト: TST-GEN-002/003/006、TST-DAT-002/003/005/006/010、TST-E2E-001/002（+ TST-E2E-003/004、TST-UNT-004 は承認後に追加）、TST-FLK-001、§69（runner retry 0）、§65（Browser isolation）
- インフラ: INF-VCL-004（`engines.node` 24.x）、SPEC-180 §43（`packageManager` でpnpmをexact固定）

Canonical status:
- SPEC-110 v1.1.0の一般利用者向けOperation ID（mock portの各methodに対応先として注記する）
  - 公開情報: API-PUB-001〜011
  - 認証・Profile: API-AUTH-002, API-AUTH-004
  - 購入開始とCheckout: API-PUR-KRK-001, API-CHK-001
  - Order: API-ORD-001, API-ORD-003
  - Entry Ticket: API-TKT-001〜003
  - Karaoke Reservation: API-KRK-SELF-001〜003
  - Goods: API-GDS-SELF-001〜002
- SPEC-110に対応するOperation IDが存在しないもの（SPEC-030 §26.1が「下流で整合が必要」と明記済み。UCR-110-001 として記録済み）
  - Cartからの購入開始（複数Item、all-or-nothing）
  - API-ORD-003のpurposeに `ENTRY_GOODS_PURCHASE` がない
  - Sponsor Logoの公開取得
- 新たに見つかった不足: 閲覧者別のPurchase Limit可否、API-ORD-003のNotification通知表示用field（UCR-110-001）
- 上記はいずれもportを「Operation IDなし（UCR待ち）」と明示する。新しいOperation IDは発明しない（DEV-GEN-003）。
- UCRの状況（AGENTS.md §2.1）: 反映済みUCRに依存する機能（Admin / Recovery系）は本タスクで使わない。`UCR-130-005`（index）にも依存しない。
- SPEC-070のAPI-ORD-002（支払前の取消）はSPEC-050に利用者UIの定義がないため、取消ボタンは作らない。

Existing code / tests / migrations:
- （設計時点）`apps/`, `packages/`, `tests/`, `scripts/`, `traceability/` はすべて存在しない。package.json、lockfile、Biome / TS / テストの設定もない。migrationは対象外。→ 現在はルート設定（package.json、pnpm-workspace.yaml、biome.json、tsconfig.base.json、.gitignore）のみ作成済み。
- `.gitignore` は存在し、`ref/` と `.env.*` を除外している。Playwrightの成果物（`test-results/` 等）と `generated/` は追記済み。
- `ref/Dev/payment-mock` はgit管理外の参照用プロトタイプで、正式仕様ではない。
  - 構成: Next 16.3.4 / React 19.2.8 / Tailwind v4 / shadcn style base-nova（@base-ui/react）/ ESLint / `cn` パッケージ / 状態はすべてlocalStorage。
  - 注意: Next 16の `next dev` はappディレクトリに `AGENTS.md` / `CLAUDE.md` を自動生成する（`ref/Dev/payment-mock/AGENTS.md` を参照）。

Implementation boundary:
- 依存の方向（DEV-DEP-001。`app/` は `features/`・`presentation/`・`config/`・`api-client` の `provider` を使ってよい）:
```
apps/web/app/**（route、薄い page.tsx）
  → src/features/**（container と feature固有のview。portだけを呼ぶ）
  → src/presentation/**（純粋な表示部品、state-mapping、format、copy）
  → src/api-client/port.ts・types.ts、src/auth/port.ts・continuation.ts（UI形のportとview model）
  → @off-r39x/domain（Canonical Stateの型と assertNever だけ）
src/api-client/index.ts・src/auth/index.ts（factory）
  → src/mock/**（mock modeのときだけ選ぶ実装。削除しやすいよう1ディレクトリにまとめる）
```
- `scripts/check-import-boundaries.mts` で検査する禁止edge（DEV-DEP-006）
  - `presentation` → `features` / `api-client` の実装 / `auth` の実装 / `mock`
  - `features` → `mock`
  - `src/mock/**` をimportしてよいのは次の許可リストだけ: `src/api-client/index.ts`、`src/auth/index.ts`、`app/dev/**`、`app/layout.tsx`（MockModeBadgeの差し込みに限る）
  - `packages/domain` → 外部package全般
  - production（`apps/**`, `packages/**`）→ `tests/**`
  - `apps/web` → `packages/db`、`drizzle-orm`、`pg`（将来への備え。DEV-DEP-002）
  - workspace間の循環import
- BrowserとWebからBusiness DBへは一切アクセスしない。価格・在庫・可否・状態はportの戻り値だけを権威として扱う（DEV-WEB-009）。

Design:
1. ディレクトリ構成（作成するもののみ。SPEC-190 §6 / §13 に準拠）
```
package.json            # private, packageManager "pnpm@<exact>", engines.node "24.x", scripts   [作成済み]
pnpm-workspace.yaml     # apps/*, packages/*, tests                                              [作成済み]
biome.json              # ref/, .next, docs/, generated/ を除外。noDangerouslySetInnerHtml / noConsole を error  [作成済み]
tsconfig.base.json      # DEV-TS-001 の全option                                                  [作成済み]
.gitignore              # 追記: test-results/ playwright-report/ blob-report/ generated/        [作成済み]
apps/web/  package.json(@off-r39x/web) next.config.ts postcss.config.mjs components.json tsconfig.json
  public/mock/sponsors/*.svg      # 文字だけのplaceholder SVG
  app/ layout.tsx globals.css not-found.tsx(PG-XFN-002) error.tsx(stack等を出さない SEC-WEB-012)
    (public)/ page.tsx announcements/page.tsx announcements/[announcementRef]/page.tsx entry/page.tsx
              karaoke/page.tsx karaoke/schedule/[date]/page.tsx karaoke/slots/[slotRef]/page.tsx
              goods/page.tsx goods/[goodsRef]/page.tsx cart/page.tsx
    (auth)/account/{register,email-verification,login,password-reset,password-reset/complete}/page.tsx
    (self)/layout.tsx(AuthGate) purchase/orders/[orderRef]/page.tsx
           mypage/layout.tsx(Mypage nav) mypage/page.tsx mypage/profile/page.tsx mypage/orders/page.tsx
           mypage/orders/[orderRef]/page.tsx mypage/entry-tickets/page.tsx mypage/entry-tickets/[ticketRef]/page.tsx
           mypage/entry-tickets/[ticketRef]/qr/page.tsx mypage/karaoke/page.tsx mypage/karaoke/[reservationRef]/page.tsx
           mypage/karaoke/[reservationRef]/qr/page.tsx mypage/goods/page.tsx mypage/goods/[goodsItemRef]/page.tsx
    dev/layout.tsx(mock無効時は notFound、noindex) dev/scenarios/page.tsx dev/mock-checkout/[orderRef]/page.tsx
  src/api-client/ port.ts types.ts provider.tsx index.ts
  src/auth/ port.ts continuation.ts session-provider.tsx use-session.ts auth-gate.tsx index.ts
  src/config/ site.ts assets.ts ui-mock.ts
  src/features/{public,entry,karaoke,goods,cart,purchase,account,mypage}/...
  src/presentation/ copy/ja.ts format/{money,datetime}.ts
    state-mapping/{order,purpose,entry-ticket,karaoke,goods,notification,availability}.ts
    components/ui/*  components/{status-badge,page-state,live-region,error-summary,form-field,money,date-time,
                       plain-text,external-link,qr-placeholder,disabled-reason,access-denied-view,not-found-view}.tsx
    layout/{global-header,primary-nav,mobile-nav-drawer,account-menu,cart-link,global-footer,sponsor-logos}.tsx
  src/mock/ backend/{mock-api,mock-auth,db,seed,scenario,latency,clock,purpose,karaoke-buckets}.ts
            dev-ui/{scenario-panel,mock-checkout-screen,mock-mode-badge}.tsx
packages/domain/ package.json(@off-r39x/domain) tsconfig.json src/{states.ts,assert-never.ts,index.ts}
scripts/ check-import-boundaries.mts validate-traceability.mts secret-scan.mts
tests/ package.json(@off-r39x/tests) tsconfig.json vitest.config.mts playwright.config.ts
  unit/web/** security/web/** e2e/** harness/browser/** traceability/test-manifest.json
traceability/rule-code-map.json
```
- ユーザー指示の「packages/shared」は DEV-REP-006 が禁止しているため、`packages/domain` に置き換える（承認済み）。
- `next.config.ts` の設定
  - `transpilePackages: ["@off-r39x/domain"]`
  - `/mypage/:path*`、`/purchase/:path*`、`/account/:path*` に `Cache-Control: no-store, private, max-age=0` と `Pragma: no-cache` を付ける（SEC-WEB-009。`/account` を含めるのはSEC-WEB-009の `/auth/*` 表記より厳しい側に倒すため）
  - 外部fontは使わず、system font stackにする（SEC-WEB-004）
- route paramのUUID・日付形式が不正な場合: 公開routeは `notFound()`。selfのrouteはPG-XFN-003の表示にする（存在の有無を確定させない）。

2. Route と Page ID の対応: 上の表のとおり SPEC-050 §7 と1対1。
- PG-XFN-003 は専用routeを持たない。`AccessDeniedView` をその場で描画し、redirectはしない（§19.2）。
- Logoutは専用Pageを持たず、Account menuのActionにする（§15.6）。
- `/dev/*` は SPEC-050 のPageではなく、開発専用の面である。

3. Port（UI形のview modelを返す。将来の実装は SPEC-110 のoperationを合成して同じ形を返す。containerは `useApi()` 経由でportだけを呼ぶ）
```ts
// apps/web/src/api-client/port.ts
type Ref<T extends string> = string & { readonly __ref: T };        // canonical lowercase UUID
type Money = { readonly amount: string; readonly currency: string }; // 最小単位のdecimal string（DEV-TS-006）
type UtcInstant = string & { readonly __utc: true };
type BusinessDateJst = string & { readonly __jst: true };            // YYYY-MM-DD
type Read<T> = { kind: "ok"; data: T } | { kind: "not_found" } | { kind: "unavailable" }
  | { kind: "auth_required" } | { kind: "email_unverified" };       // unavailable は Empty に変換しない
type CartLine = { kind: "ENTRY_TICKET"; offeringRef: Ref<"offering">; quantity: number }
  | { kind: "GOODS"; goodsRef: Ref<"goods">; quantity: number };    // Karaokeは型として表現できない（FR-CRT-002）
type SaleAvailability = { kind: "ON_SALE"; maxSelectableQuantity: number | null }
  | { kind: "BEFORE_SALES"; startsAt: UtcInstant } | { kind: "SALES_ENDED" } | { kind: "SUSPENDED" }
  | { kind: "SOLD_OUT" } | { kind: "INSUFFICIENT_QUANTITY"; maxSelectableQuantity: number }
  | { kind: "PURCHASE_LIMIT_EXCEEDED" };
type CartLineResolution = { lineKey: string } & ({ status: "resolved"; name: string; unitPrice: Money;
  availability: SaleAvailability } | { status: "not_public" } | { status: "unavailable" });
interface PublicApi {
  getEvent(): Promise<Read<EventInfo>>;                                   // API-PUB-001（未設定fieldはnull）
  listFaqs(): Promise<Read<readonly FaqItem[]>>;                          // API-PUB-002
  listAnnouncements(q?: { limit?: number }): Promise<Read<readonly AnnouncementSummary[]>>; // API-PUB-003
  getAnnouncement(ref: Ref<"announcement">): Promise<Read<Announcement>>; // API-PUB-004
  listSponsorLogos(): Promise<Read<readonly SponsorLogo[]>>;              // Op IDなし（UCR-110-001）。PUBLISHEDのみ、表示順
  listEntryOfferings(): Promise<Read<readonly EntryOffering[]>>;          // API-PUB-005（+閲覧者別可否 UCR-110-001）
  getKaraokeSales(): Promise<Read<KaraokeSales>>;                         // API-PUB-006
  getKaraokeDay(date: BusinessDateJst): Promise<Read<KaraokeDay>>;        // API-PUB-007 + API-PUB-008
  getKaraokeSlot(ref: Ref<"slot">): Promise<Read<KaraokeSlotDetail>>;     // API-PUB-009
  listGoods(): Promise<Read<readonly GoodsSummary[]>>;                    // API-PUB-010
  getGoods(ref: Ref<"goods">): Promise<Read<GoodsDetail>>;                // API-PUB-011
  resolveCartLines(lines: readonly CartLine[]): Promise<Read<readonly CartLineResolution[]>>; // 005/010/011の合成 + UCR-110-001
}
type CartPurchaseStart = { kind: "created"; orderRef: Ref<"order">; includedLineKeys: readonly string[] }
  | { kind: "rejected"; rejections: readonly { lineKey: string; reason: "BEFORE_SALES" | "SALES_ENDED"
      | "SUSPENDED" | "SOLD_OUT" | "INSUFFICIENT_QUANTITY" | "PURCHASE_LIMIT_EXCEEDED" | "ALLOCATION_CONFLICT"
      | "NOT_PUBLIC" }[] }                                              // Orderは作られていない
  | { kind: "auth_required" } | { kind: "email_unverified" } | { kind: "unavailable" };
type KaraokePurchaseStart = { kind: "held"; orderRef: Ref<"order"> } | { kind: "slot_unavailable" }
  | { kind: "purchase_limit_exceeded" } | { kind: "not_on_sale" }
  | { kind: "auth_required" } | { kind: "email_unverified" } | { kind: "unavailable" };
type CheckoutStart = { kind: "redirect"; url: string }    // top-level遷移のみ（SEC-WEB-005）
  | { kind: "start_failed" }                                // PREPAREDのまま。同一Orderで再試行
  | { kind: "opportunity_expired" }                         // Allocation/Hold無効 → 再読込でterminal表示
  | { kind: "state_conflict" } | { kind: "auth_required" } | { kind: "unavailable" };
interface PurchaseApi {
  startCartPurchase(lines: readonly CartLine[], o: { idempotencyKey: string }): Promise<CartPurchaseStart>; // Op IDなし
  startKaraokePurchase(slot: Ref<"slot">, o: { idempotencyKey: string }): Promise<KaraokePurchaseStart>;    // API-PUR-KRK-001
  startCheckout(order: Ref<"order">, o: { idempotencyKey: string }): Promise<CheckoutStart>;              // API-CHK-001
}
interface SelfApi {   // 他者所有でも不存在でも not_found（SPEC-110 §22）
  getProfile(): Promise<Read<Profile>>;                                                      // API-AUTH-002
  updateProfile(i: { displayName: string }): Promise<{ kind: "saved"; profile: Profile }
    | { kind: "validation_failed"; field: "displayName" } | { kind: "unavailable" }>;         // API-AUTH-004
  listOrders(): Promise<Read<readonly OrderSummary[]>>;                                      // API-ORD-001
  getOrder(r: Ref<"order">): Promise<Read<OrderDetail>>;                                     // API-ORD-003
  listEntryTickets(): Promise<Read<readonly EntryTicketSummary[]>>;                          // API-TKT-001
  getEntryTicket(r: Ref<"ticket">): Promise<Read<EntryTicketDetail>>;                        // API-TKT-002
  getEntryQr(r: Ref<"ticket">): Promise<Read<QrPresentation>>;                               // API-TKT-003
  listReservations(): Promise<Read<readonly ReservationSummary[]>>;                          // API-KRK-SELF-001
  getReservation(r: Ref<"reservation">): Promise<Read<ReservationDetail>>;                   // API-KRK-SELF-002
  getKaraokeQr(r: Ref<"reservation">): Promise<Read<QrPresentation>>;                        // API-KRK-SELF-003
  listGoodsItems(): Promise<Read<readonly GoodsItemSummary[]>>;                              // API-GDS-SELF-001
  getGoodsItem(r: Ref<"goodsItem">): Promise<Read<GoodsItemDetail>>;                         // API-GDS-SELF-002
}
export interface ApiPort { readonly public: PublicApi; readonly purchase: PurchaseApi; readonly self: SelfApi }
// OrderDetail: { orderRef; purpose: OrderPurpose(4値); state: OrderState; createdAt; total: Money;
//   items: (Entry | Goods | Karaoke の明細。購入時Snapshot); entitlements: { entryTicketRefs; reservationRef;
//   goodsItems: {ref, itemState, handoffState}[] }; receiptUrl: string | null; notice: { kind: "email_delayed" } | null }
// QrPresentation: { kind: "presentable"; purpose: "ENTRY" | "KARAOKE"; mockMatrixSeed: string }
//   | { kind: "not_presentable"; ticketState }   // VALIDのときだけ presentable（SEC-QR-012）
```
```ts
// apps/web/src/auth/port.ts — Supabase Auth連携の代替。現時点では mock 実装だけ
type Session = { kind: "guest" } | { kind: "authenticated"; email: string; emailVerified: boolean };
interface AuthPort {
  getSession(): Promise<{ kind: "ok"; session: Session } | { kind: "unavailable" }>;
  onSessionChange(cb: () => void): () => void;
  signUp(i: { email: string; password: string }): Promise<{ kind: "confirmation_required" } | { kind: "signed_in" } | { kind: "rejected" } | { kind: "unavailable" }>;
  verifyEmail(i: { context: string | null }): Promise<{ kind: "verified" } | { kind: "invalid_or_expired" } | { kind: "unavailable" }>;
  signIn(i: { email: string; password: string }): Promise<{ kind: "signed_in"; emailVerified: boolean } | { kind: "credential_failure" } | { kind: "unavailable" }>;
  signOut(): Promise<{ kind: "signed_out" }>;   // provider側が失敗しても、ローカルのsessionは必ず破棄する（AR-SES-009）
  requestPasswordReset(i: { email: string }): Promise<{ kind: "accepted" } | { kind: "unavailable" }>; // 文言は一律（SEC-API-027）
  completePasswordReset(i: { context: string | null; newPassword: string }): Promise<{ kind: "updated" } | { kind: "invalid_context" } | { kind: "unavailable" }>;
}
```
- `src/api-client/index.ts` の `createApiPort()` は `UI_MOCK_ENABLED` のときだけ mock を返す。それ以外は「実クライアント未実装」として例外を投げる（fail closed）。
- `UI_MOCK_ENABLED` は `NEXT_PUBLIC_UI_MOCK === "1"` で判定する。`next.config.ts` で既定値を与え、`next dev` では "1"、build では明示指定されたときだけ有効にする。本番deployで有効なまま build したら失敗させる（DEV-WEB-011）。
- mockはパスワードを保存・記録しない（SEC-AUTH-018）。

4. 状態モデル
- Cart（`src/features/cart/`。本番コードとして扱う）
  - localStorageの `r39x.cart.v1` に保存する。内容は `{version:1, lines: CartLine[]}`。読み込み時はZodの `.strict()` で検証し、価格など余分なfieldがあれば拒否する（FR-CRT-003、DEV-TS-004）。
  - 操作: add（同じrefなら数量を加算）、setQuantity（1以上の整数）、remove、removeLines（Order作成後に該当Itemを除去。FR-CRT-011）、addFromOrder（再購入時の再投入。§16.4）。
  - 保存内容が壊れている場合は空として扱わず、「カートを読み込めません」と表示し、リセット操作を出す。
  - `useSyncExternalStore` と storageイベントで複数タブを同期する。Login / LogoutではCartを変更しない（FR-CRT-012）。
  - Headerの表示数は数量の合計。
- 認証: AuthPortのsessionを `SessionProvider` が保持する。mockでは `r39x.mock.session.v1` に保存する。
- Order / Ticket / Slot / Goods: mock DB（`src/mock/backend/db.ts`、`r39x.mock.db.v1`）が唯一の保持場所で、UIは保持値を持たずportを読み直す。
  - seedは次の2人を含む: `demo@example.com`（全状態を網羅。7状態のOrder、複合Orderを含む）と `new@example.com`（購入0件。Empty確認用）。他者用fixtureも含む。
  - 販売種別もfixtureで全状態を同時に持つ。例: Entryは「販売中、開始前、終了、停止、売り切れ、上限到達」。
  - 日時はinjectableな mock clock を基準にした相対値で作る（DEV-REL-001）。
  - Purposeの決定（BR-ORD-013）とall-or-nothing（BR-ORD-014）は mock backend 内で模擬する。同じidempotencyKeyなら同じ結果を返す。
  - Hold TTLはUIにもmockにも定義しない。失効はscenarioで起こす。

5. Domain State→UI対応の実装
- `src/presentation/state-mapping/*.ts` に純粋関数を置く。各関数はexhaustiveなswitchと `assertNever` で書く（DEV-TS-010）。
  - `presentOrderState(state)` は `{label, category, tone, showsEntitlements, actions}` を返す。
    - labelとcategoryは §16.4 / §20.1 のとおり。
    - `showsEntitlements` は CONFIRMED のときだけ true。
    - actions: PREPARED →「支払い開始を再試行」、AWAITING_PAYMENT と REVIEW_REQUIRED →「状態を再確認」のみ、CONFIRMED →「購入内容を見る」、PAYMENT_FAILED / CANCELED / EXPIRED →「もう一度購入する」。
  - 同じ形で `presentPurpose`、`presentEntryTicket`（QR提示は VALID のみ）、`presentSlot`（AVAILABLE だけ選択可能）、`presentReservationTicket(res, ticket)` を作る。
  - `presentGoodsItem(item, handoff)`: 受け取り可能は FULFILLABLE かつ PENDING のときだけ。PENDING_PAYMENT は受け取り不可。
  - `presentNotification`: FAILED_RETRYABLE は成功表示を保ったまま非阻害の通知にする。
  - `presentAvailability`: Cartの7理由と not_public（「現在取り扱っていません」）をそれぞれ別の文言にする。
- 表示文言はすべて `copy/ja.ts` に集める。Badgeは tone（tokenで色を決める）と必ずテキストを組み合わせる（§25）。
- 複合Order: CONFIRMED のときだけ、Entry TicketとGoods（itemとhandoffの状態）を同じ画面で区別して並べる。それ以外の状態ではどちらも有効な権利として表示しない（BR-ORD-015）。
- portがentitlementsを返しても、UIは `showsEntitlements` でもう一度絞り込む（INV-010-07の多重防御）。

6. 主要なフロー
- Cart購入の流れ
  1. 購入可能かの判定は `canProceed(lines, resolutions)` で行う。対象が1件以上あり、すべて ON_SALE なら有効。それ以外は理由を周辺テキストで示して無効にする。
  2. Guestが購入手続きを選ぶと `/account/login?continue=cart` へ遷移する。
  3. Authenticated Userはidempotency keyを1つ生成し、ボタンを処理中にして「購入条件を確認しています」と表示する。
  4. 結果が `rejected` の場合: 「購入は開始されていません」とItemごとの理由を示すerror summaryを出し、そこへfocusを移す。Cartはそのまま保持する。
  5. 結果が `created` の場合: 含めたItemをCartから除去し、「支払い画面を準備中」と表示して `startCheckout` を呼ぶ。
     - `redirect` なら `location.assign(url)` で遷移する。
     - `start_failed` なら PG-XFN-001 へ遷移する。
- Karaoke購入（PG-KRK-003）
  - Guestには「ログインして購入手続きへ」を出し、`continue=karaoke-slot:<uuid>` を付ける。
  - Authenticated Userは「枠を確保しています」と表示し、結果に応じて次のようにする。
    - `held`: `startCheckout` へ進む。
    - `slot_unavailable`: 「他の利用者が先に確保したため購入を開始できません」と示し、`PG-KRK-002` への導線を出す。
    - `opportunity_expired`: 「枠の確保期限が切れたため選び直してください」と示し、`PG-KRK-002` へ戻す。
- mock Checkout（`/dev/mock-checkout/[orderRef]`）
  - 「Stripe Checkoutの代替モック。実際の決済は行われません」と大きく表示する。カード番号などの入力欄は置かない。
  - 「支払う（モック）」と「戻る」はどちらも PG-XFN-001 へ戻るだけで、それ自体ではOrderを確定しない。
  - Orderの状態は scenario の paymentOutcome（Webhookの模擬）でだけ変わる。既定は `confirm_after_recheck` で、初回表示は AWAITING_PAYMENT、「状態を再確認」で CONFIRMED になる。
- PG-XFN-001 / PG-MYP-004 は同じ `OrderOutcome` 部品を使う。
  - 再読込しても新しいOrderは作らない。
  - 前回読んだ状態と違えば、`role="status"` の領域で「購入状態が『購入確定』に更新されました」と知らせる（§25）。
  - 「もう一度購入する」の挙動: Entry / Goods / 複合OrderはItemをCartへ再投入して `/cart` へ遷移する。Karaokeは `/karaoke` へ遷移する。§18.4の文言との差はOI-6を参照。
  - Receiptはurlがあるときだけリンクを出す。外部リンクであることを明示する。
- Ownership: selfのreadが not_found を返したら、データを描画する前に AccessDeniedView を表示する（§26.2）。mock backendは、他者所有のrefと存在しないrefに同じ結果を返す。
- QR: `QrPlaceholder`（refのPseudoQrを流用）でmockのseedを描画する。tokenの文字列は画面にもURLにも出さない。「モック表示：実際のQRではありません」と注記する。
  - タイトル: Entryは「Entry Ticket / 入場受付用」、Karaokeは「Karaoke Ticket / Karaoke受付用」とし、Karaokeには日時を併記する。
  - VALID以外ではQRを描画せず、状態をテキストで主表示する。

7. Continuation（`src/auth/continuation.ts`。純粋関数）
- `continue` パラメータは `<key>` または `<key>:<uuid>` の形にする。keyは許可リスト（cart, karaoke-slot, purchase-order, mypage と mypage配下の各key）に限る（AR-CONT-001）。
- `toPath` で相対pathを組み立てたあと、`isSafeRelativePath` でもう一度検査する（SEC-WEB-013の全拒否条件）。不正な値は `mypage` 扱いにする。
- 認証をやめた場合の戻り先: cart → `/cart`、karaoke-slot → 対象のSlotページ、それ以外 → `/`。
- AuthGateは現在のpathからkeyを逆引きする。
- 認証後は対象Pageが再取得するので、Continuationには価格や在庫などの値を入れない（§10.3）。
- emailが未確認なら PG-AUTH-002 へ遷移し、continue を引き継ぐ。
- Logout後は `/` へ遷移する。AuthGateは pageshow（bfcacheからの復帰）でもsessionを確かめ直す（§15.6）。

8. Scenario切替（`/dev/scenarios`）
- Zodで検証する設定を localStorage の `r39x.mock.scenario.v1` に保存する。
- 切り替えられる項目
  - 公開情報: 取得結果（ok / fail / empty）と遅延（none / long）
  - Sponsor Logo: published / none / fail / image_broken
  - Cart: 状態取得（ok / fail / partial）、購入開始（ok / reject_one / limit / unavailable）
  - checkout: ok / start_failed / opportunity_expired
  - Karaoke Hold: ok / conflict / limit / expire_before_checkout
  - 支払い結果: confirm_after_recheck / confirm / remain_awaiting / payment_failed / review_required / expire / cancel
  - 通知: sent / failed_retryable
  - 認証: login・signup・verify・reset・reset context
  - Event field未設定、遅延の長さ
- 操作: DBリセット、他者refへのリンク一覧。
- MockModeBadgeは mock mode のときだけ画面左下に出す小さなテキストラベル（画面右下は Floating Ticket Button が使う）で、一般のナビゲーションには含めない。
- E2Eは `page.addInitScript` で同じキーを設定する。
- scenarioのfailureは mock 内の切替であり、SPEC-170のFault Pointではない（TST-GEN-006。承認済み SPEC-190 DEV-WEB-010〜013 / SPEC-170 TST-E2E-004 に従う）。

9. Accessibility / Responsive
- Header
  - md以上: ナビゲーションを横並びにする。
  - md未満: primary navをDrawer（base-ui Dialog、focus trap、Escで閉じる、閉じたらfocusを戻す）に入れる。CTA、Cart、Login / Mypageは常に外に出しておく。
  - Cartの accessible name は「カート（3点）」の形にする。
- Formの誤り表示
  - 各fieldに `aria-invalid` と `aria-describedby` を付ける。
  - 送信に失敗したら、`role="alert"` のerror summary（各fieldへのリンク付き）へfocusを移す。
- パスワードは12〜128文字とし、trimしない（SEC-AUTH-016/017）。
- 無効な操作には理由テキストを付け、`aria-describedby` で結ぶ。リンクとボタンを用途で使い分ける。見出しはh1から論理的な順に並べる。
- 状態の変化は `role="status"` で知らせる。対象はCart追加の結果と AWAITING_PAYMENT → CONFIRMED。
- 表はMobileでカード表示に変える。Karaokeは時間帯ごとに「空き n / 全 m 枠」をテキストで示す。QR領域は十分な大きさと余白をとり、状態と日時をQRのすぐ近くに置く。
- 公開コンテンツは `PlainText`（`white-space: pre-line`、HTMLとして解釈しない）で描画する。外部リンクは https のときだけリンクにする（SEC-WEB-016〜020）。

10. 差し替え容易性（§24.3）
- `app/globals.css` の `@theme` に次のtokenを置く。
  - brand
  - 状態のtone: success / pending / failure / neutral / review の背景色と文字色
  - radius
  - hero用のgradient
  - font（system stack）
- `config/site.ts` はサイト名とナビゲーション、`config/assets.ts` は logo / keyVisual の枠を持つ。値がnullならテキストとgradientで代替する。
- Sponsor Logoはportから取得するデータであり、運営が管理するデータへ置き換えられる。

11. ref から流用するもの・作り直すもの
- 流用（手直しあり）
  - `components/ui/*`（button, badge, card, alert, input, label, separator, skeleton, dialog。Drawerはdialogから作る）: `cn` パッケージは `clsx` + `tailwind-merge` に替え、strict TSとBiomeに合わせる。
  - `qr-code.tsx` の PseudoQr（mock表示用）
  - `globals.css` のtoken構造（tokenを追加して拡張する）
  - `components.json`（パスをSPEC-190の配置に合わせる）
- 考え方だけ使い、作り直すもの
  - `status-badge`: Canonicalな大文字の状態名と SPEC-050 の文言に揃え、テキスト表示を必須にする。
  - `karaoke.ts` の時間帯集計: JSTかつ半開区間にし、総数と空き数を出す。◎○△×の記号だけには頼らない。mock backend側へ移す（API-PUB-007の責務）。
  - `continuation.ts`: prefixの一致だけでは不十分なので、intent key方式とSEC-WEB-013の検査に置き換える。
- 捨てるもの（理由）
  - `store.tsx`: UI内のlocalStorageが正本になっている。Cartに価格がありKaraokeも混在する。Holdの45 / 30 / 5分をUIに持っている（§13.3違反）。
  - コンビニ払い（SPEC-070 §8）
  - `/checkout/*` のカード番号入力欄
  - `/staff` と `/admin`、およびFooterからのリンク（SPEC-050 §27）
  - 商品詳細ページからの直接購入
  - Ticket・Karaoke・Goodsの権利を1つの型にまとめたもの
  - UUIDでないID、数値型の価格
  - ESLint（Biomeを使う）

12. 存在するようになるコマンド（scaffold完了時点）
- `pnpm install`（初回だけlockfileを生成し、以後は `--frozen-lockfile`）
- `pnpm dev`（mock mode）
- `pnpm build`
- `pnpm lint`（`biome check .`）、`pnpm format`
- `pnpm typecheck`（各workspaceで `tsc --noEmit`）
- `pnpm check:boundaries`（`node scripts/check-import-boundaries.mts`）
- `pnpm test:unit`（Vitest。tests/unit と tests/security）
- `pnpm test:e2e`（Playwright。build と start に `NEXT_PUBLIC_UI_MOCK=1` を付け、port 3100）
- 初回だけ `pnpm --filter @off-r39x/tests exec playwright install chromium` が必要
- 最終slice（S9）で追加: `pnpm validate:traceability`、`pnpm secret-scan`
- それ以外のコマンドは存在しないものとして扱う。

Test plan:
- 適用するgroup
  - G1（Unit）: 実行する。
  - G5（Security）: Unit levelの `tests/security/web` と、mock E2Eでのheader確認に限る。
  - G8: 正規のG8は production相当のWeb + Hono + DB を要求する（SPEC-170 §7, §65）。今回は満たせないため「Not executed」と報告する。mock modeのPlaywrightは補助のsuite（`e2e-ui-mock`）として実行する（TST-E2E-004）。
  - G2, G3, G4, G6, G7, G9, G10: 対象外（DB / API / provider / 並行性なし）。
- テストIDの採番は TST-UNT-004 / TST-E2E-003 に従い、`TC-<SPEC-050のPage ID>-NNN` を使ってよい。
- Unit（Vitest、node環境。純粋関数だけを対象にする）
  - U1 `presentOrderState`: 7状態の文言とcategoryがすべて異なる。entitlementsを表示するのはCONFIRMEDだけ。REVIEW_REQUIREDとAWAITING_PAYMENTには「もう一度購入する」「支払い開始を再試行」がない（§16.4、§20.1、INV-010-07）。
  - U2 Entry Ticket 4状態: QR提示はVALIDだけ（§18.6、§18.7、INV-010-05）。
  - U3 Karaoke: Slot 4状態、ReservationとTicketの組み合わせ（§18.9、§20.3）。
  - U4 Goods: itemとhandoffの組み合わせ（§18.11、§18.12、§20.4）。
  - U5 Notification: FAILED_RETRYABLEで成功表示を保ち、購入をやり直す操作を出さない（§16.7）。
  - U6 availability: Cartの7理由と not_public が区別される（FR-CRT-005）。
  - U7 cart-store: 加算、数量の下限1、削除、removeLines、addFromOrder。strict schemaが価格・Karaoke・余分なfieldを拒否する。壊れた保存内容は空にならない（FR-CRT-001, 003, 011、§26.4）。
  - U8 `canProceed`: 0件、購入不可、未解決、取得失敗のいずれでも無効になる（§14A.1）。
  - U9 continuation: 許可リストの往復変換。SEC-WEB-013の拒否条件をすべて試す（scheme、`//`、backslash、userinfo、制御文字、percent-encodingされた変形、/admin、/staff）。認証をやめたときの戻り先（AR-CONT-001〜003）。
  - U10 金額のformat: bigint、大きな値でも正確な小計、浮動小数点を使わない（DEV-TS-006/007）。
  - U11 JST format: UTCの日付境界をまたぐ時刻でも正しい日付になる。前後と境界の3点で確認する（TST-DAT-007/008）。
  - U12 mock backend の忠実度（test doubleの試験であり、criticalではない）
    - Purpose決定（BR-ORD-013）
    - 1件でも拒否されたらOrderも確保も変化しない（BR-ORD-014）
    - 同じidempotencyKeyでOrderが増えない
    - 他者所有と不存在が同じ結果になる（SPEC-110 §22）
    - getOrderでOrderが増えない（PAY-BRW-002）
    - Checkoutの再試行で同じOrderを使う
    - Sponsor LogoはPUBLISHEDだけを表示順で返す（BR-EVT-005）
    - 時間帯集計がJSTの半開区間になる（§13.2）
  - U13 パスワード検証: 11 / 12 / 128 / 129文字、trimしない（SEC-AUTH-016）。
  - 事後条件: Domain = 戻り値と保存内容。DB / Provider / Audit = 対象外（mock）。
- E2E（Playwright、mock mode。desktop-chromium と mobile-chromium の2project。`timezoneId: "UTC"` にしてJST表示が端末の時刻帯に左右されないことを確かめる。retries 0、workers 4以下。traceはoff、screenshotは失敗時だけ。Browser contextは毎回新しくする）
  - SPEC-050 §31 の項目と主な事後条件
    - 1: Guestが全公開ページを閲覧できる。
    - 2: fail scenarioで「取得できません」と表示し、0件・売り切れの文言は出ない。
    - 3: Cartとslotで、Login後に元の場所へ戻る。
    - 4: Entryの6状態の文言と、Cart追加ボタンの有効・無効。
    - 5: Karaokeの日付、時間帯、4状態。
    - 6: Goodsの状態。
    - 7: start_failed のあと、PG-XFN-001 が PREPARED と「支払い開始を再試行」を表示する。Mypageの注文一覧に同じOrderがある。
    - 8: Returnの直後が AWAITING_PAYMENT で、成功の文言も権利へのリンクもない。
    - 9: CONFIRMEDのときだけ権利へのリンクが出る。
    - 10: 4つのoutcomeの文言がそれぞれ異なる。
    - 11: 再確認しても注文一覧の件数が変わらない。
    - 12: Cartへの再投入。Karaokeは `/karaoke` へ遷移する。
    - 13: Holdが失効したら選び直しへ誘導する。
    - 14: Mypageの各ページへ到達できる。
    - 15: 注文一覧が7状態を区別して表示する。
    - 16: Ticketの4状態。
    - 17: QRのタイトルがEntryとKaraokeで異なる。
    - 18: Goodsのitemとhandoffの状態。
    - 19: Email遅延の通知が出ても CONFIRMED と権利が保たれる。
    - 20: 他者のrefを開くと AccessDeniedView になり、他者のItem名がDOMにない。
    - 21: Mobile とDesktopの両方で通しのフローを完遂できる。
    - 22: Keyboardだけで操作でき、error summaryへfocusが移り、`aria-invalid` が付き、状態変化のlive regionに文言が出る。
    - 23: `/admin` や `/staff` へのhrefがない。
    - 24: Guestが追加・変更・削除し、Loginしたあとも内容が保持されている。
    - 25: 理由が表示され、購入手続きボタンが無効。
    - 26: reject_one で「購入は開始されていません」と理由が表示され、Cartは保持され、注文一覧の件数は変わらない。
    - 27: 複合OrderがCONFIRMEDのとき両方を表示し、AWAITING_PAYMENT / REVIEW_REQUIRED では両方とも出さない。
    - 28: KaraokeにCart追加の操作がなく、案内文がある。
    - 29: 全ページにCTAとCartがある。Sponsorは published / none / fail / image_broken の4通り。fail でもナビゲーションを操作できる。
  - 追加の確認
    - `/mypage`、`/purchase`、`/account` のresponseに `Cache-Control: no-store`（SEC-WEB-009）
    - Logout後にbackしても保護データが出ず、Loginへ遷移する（§15.6）
    - QRページのURLとテキストにmock seedが含まれない（SEC-QR-013、TST-DAT-010）
    - fixtureの `<script>` を含むAnnouncementが文字列のまま表示される（SEC-WEB-017〜019）
  - E2Eは、文言を `copy/ja.ts` からimportし、role / name でlocatorを組む。
- critical / concurrency / fault injection
  - 実DBやAPIの不変条件を証明するものではないため、manifestでは `critical:false` とする。根拠はTST-GEN-003とTST-E2E-002 / TST-E2E-004である。runnerのretryはどのテストでも0。
  - concurrencyとSPEC-170のFault Pointは使わない。
- manifestの各テストの記載
  - `api_operation_ids` と `db_constraint_names` は空にする（API coverageを偽装しないため）。
  - `expected_db_postconditions`、`expected_provider_postconditions`、`expected_observability` は空とし、mockのためと注記する。
  - `sensitivity_class` は synthetic とする。
  - テストデータはすべて合成データで、メールアドレスは `example.com` を使う（TST-DAT-002/003）。

Open issues（承認時点の状況を併記）:
- OI-1 mock backend と dev scenario を `apps/web` 内に置くこと → 解決済み（SPEC-190 1.2.0 DEV-WEB-010〜013）。
- OI-2 テストID規則とG8 → 解決済み（SPEC-170 1.2.0 TST-UNT-004 / TST-E2E-003 / TST-E2E-004）。
- OI-3 SPEC-110 の不足（Cart購入開始、API-ORD-003 の purpose、Sponsor Logo、Purchase Limit 可否、通知表示）→ UCR-110-001 として記録済み。portは「Operation IDなし」と明示する。
- OI-4 Display name → UCR-100-001 として記録済み。mockでは必須チェックだけを行い、最大文字数は定めない。
- OI-5 ルート直下ファイルの書込権限 → オーケストレーターが作成（作成済み）。
- OI-6（止める理由にはならない。後日PATCHでの整合を推奨）次の3点は仕様書間で表記がずれている。SPEC-050 §18.4「販売Pageへ戻り」と §16.4「Cartへ再投入」（設計では §16.4 に統一）／SPEC-060 §29.1 の例（Entry → PG-TKT-001）はCart導入前の記述／SEC-WEB-009 は `/auth/*` と書いているが SPEC-050 のrouteは `/account/*`。
- OI-7（DEV-AI-003 の範囲での決定）
  - `packages/shared` ではなく `packages/domain`（状態の型と assertNever だけ）を使う（承認済み）。
  - package名を `@off-r39x/*` とし、tests を workspace に含める。fontは system stack、`cn` パッケージをやめて clsx と tailwind-merge、E2E は build と start で実行、mock state のキーにはversionを付ける。
  - Next 16 の `next dev` は `apps/web/AGENTS.md` / `CLAUDE.md` を自動生成する。入れ子のAGENTS.mdは apps/web で作業するagentに読み込まれるため、オーケストレーターがdiffで扱いを判断する。
  - Next 16 は破壊的変更がある（例: params が Promise になる）。コーディング担当は `node_modules/next/dist/docs` を先に読む。

実装の分割（1回のcoder実行ごとに1 slice。各sliceで「テストを先に書く → 実装 → 検証」を回し、testとfeatのcommitをこの順で行う）
- S0 scaffold: packages/domain、apps/webの最小骨格、ui-mock設定、portの雛形、check-import-boundaries。tests workspaceにはsmokeを置く。
- S1 state-mapping、format、copy: U1〜U6、U10、U11。
- S2 mock backend core と `/dev/scenarios`: 公開read、mock auth、ApiProvider。U12の一部。
- S3 tokens、shadcn primitive、Header / Footer / Drawer / Sponsor、not-found / error、MockModeBadge。E2E 23、29。
- S4 公開ページ: PUB-001〜003、KRK-001〜002、GDS-001。E2E 1、2、5。
- S5 Cart と Cartへの追加: TKT-001、GDS-002、CRT-001（購入開始は除く）。U7、U8。E2E 4、6、24（前半）、25、28。
- S6 認証: AUTH-001〜005、Continuation、AuthGate、Logout、no-store。U9、U13。E2E 3、24（後半）、Logout後のback、header確認。
- S7a Cart購入、Checkout、mock Checkout、XFN-001、再購入。E2E 7〜12、19（XFN部分）、26、27。
- S7b Karaoke購入とHold系のscenario。E2E 13、およびKaraoke側の7〜9。
- S8 Mypage: MYP-001〜012、PG-XFN-003、QR。E2E 14〜20、22。
- S9 validate-traceability、secret-scan、rule-code-map、Mobile / Desktopの全通し。E2E 21。

コミット単位の案: `chore(repo): scaffold` → `test(scaffold)` → `feat(domain)` → `test/feat(web): state mapping` → `feat(web): mock backend` → `feat(web): layout` → `feat(web): public pages` → `feat(web): cart` → `feat(web): auth` → `feat(web): purchase` → `feat(web): karaoke purchase` → `feat(web): mypage` → `chore(scripts): traceability/secret scan`。

実行できない検証（完了報告に例外として書く項目）: 正規のG8、G2〜G4、G6、G7、G9、G10。SPEC-170 §73 のcoverage閾値。本番のCSP nonce。いずれも mock のためで、本番リリースはこのタスクの範囲外のため、リリースへの影響はない。

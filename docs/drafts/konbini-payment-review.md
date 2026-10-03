# コンビニ払い導入に関する検討状況（開発チーム判断用）

> 状態: **検討資料（正式仕様ではない）**。`docs/specs/` は変更していない。
> 作成日: 2026-10-04 / 対象仕様のHEAD: `385127c` 時点の内容 + 以降のdevブランチ
> 目的: コンビニ払い導入の可否・方式を開発チームが判断するための、現時点の整理と論点の保存。結論は出していない。

## 1. 背景と前提

- 想定利用者は学生が多く、クレジットカードを持たない人がいる。支払い方法としてカードとコンビニ払いの2本を提供したい。
- 1 Order = 1 Domain のままだと、コンビニ払いでは Domain の数だけ支払番号が発行され、店頭での支払いが複数回になる。
- そのため購入モデルを次のとおり変更する方針（ユーザー決定済み）。
  - **Entry と Goods は同一 Order、Karaoke は別 Order**（最大 2 回の支払い）。
  - コンビニ払いの期限は Karaoke の Hold とは別に定義し、Stripe 公式情報を参考に長めに設定する。
  - 既存の Hold（45 分）は**カード支払いの場合**としたい。この場合の他仕様との競合は §4 に整理した。
- **コンビニ払いを採用するか、採用する場合の範囲（特に Karaoke）は未決定。開発チームで検討する。**

## 2. Stripe 公式情報（2026-10-04 確認）

出典: Stripe Docs「Konbini payments」（Checkout 版 `docs.stripe.com/payments/konbini/accept-a-payment`）。

| 項目 | 公式の記載 |
|---|---|
| 利用条件 | 事業所在地 JP、通貨 JPY のみ。全 line item が JPY。one-time の line item のみ（サブスク不可）。Payment mode のみ対応 |
| 有効化 | Stripe ダッシュボードでコンビニ決済を有効化する必要がある |
| 期限 | `payment_method_options[konbini][expires_after_days]`。**1〜60 日、デフォルト 3 日**。指定日の **23:59:59 JST** に失効 |
| 短期限 | 本番では設定できない。分単位の失効はテスト用確認番号の挙動のみ |
| 失効後の支払い | 期限前に払込票を発行済みなら、`expires_at` 後でもレジで支払える場合がある。誤って失敗扱いしないよう buffer 期間が設けられている |
| 取消 | 確定後〜`expires_at` までは取消可能。店頭で支払い手続き中は取消が失敗する。取消すると元の払込票は無効になる |
| 遷移 | `success_url` には遷移せず、`hosted_voucher_url`（支払い手順ページ）へ遷移する |
| Webhook | `checkout.session.completed`（払込票の発行）、`checkout.session.async_payment_succeeded`（入金）、`checkout.session.async_payment_failed`（失効・失敗）。払込票作成時に `payment_intent.requires_action` |
| 返金 | ダッシュボード / API から可能。顧客が返金先の銀行口座を入力する必要がある。状態は `requires_action → pending → succeeded`。**45 日以内に入力がないと `failed`**（その場合は Stripe 外で返金）。返金ごとに手数料が発生する場合がある |
| テスト | 特殊な確認番号（即時入金 `22222222220`、3 分後入金 `11111111110`、即時失効 `33333333330`、3 分後失効 `44444444440`、入金なし `55555555550`）で各シナリオを再現できる |

**未確認（仕様化の前に Stripe の API リファレンス等で確認が必要）**
- Checkout Session 自体の最大有効期間と、Session 失効後の払込票との関係
- コンビニ払いの金額の上限・下限、手数料体系
- Entry + Goods の複数 line item での表示・挙動の実機確認

## 3. 現行仕様の関連ルール

| 領域 | 現行の規定 | 参照 |
|---|---|---|
| Order の Purpose | 3 値のいずれか 1 つ。作成後不変 | SPEC-030 §11.2、BR-ORD-012、SPEC-070 PAY-ORD-004 |
| 支払い方法 | カードのみ。追加は仕様変更として扱う | SPEC-070 §3、§8 |
| Payment Deadline | Session 作成 + 30 分 | SPEC-070 §210〜214 |
| Karaoke Hold | 取得から 45 分。Payment Deadline（30 分）+ 5 分の Safety Buffer。`payment_deadline <= usage_end` | SPEC-090 KRK-HLD-007、§12、KRK-PAY-001〜003 |
| DB | `payment_deadline_at`（30 分）と `hold_expires_at`（45 分）は generated column | SPEC-100 約 811 行、約 1145 行、DB-KRK-006 |
| 返金 | Full Refund。自動 lookup は 30 分〜6 時間で停止 | SPEC-070 PAY-RFD、SPEC-150 / 170 / 180 |

## 4. 「Hold はカード支払いのみ」とした場合の他仕様との競合

### 4.1 SPEC-090

| ルール | 競合 |
|---|---|
| KRK-HLD-006 / 007 | 45 分固定。「カードの場合のみ」という限定がない |
| §12.1〜12.2、KRK-PAY-001 / 002 | `payment_deadline <= hold_expires_at − 5 分` をコンビニ（日単位）では満たせない |
| KRK-PAY-003、§12.3 | `payment_deadline <= usage_end`。コンビニの期限（23:59:59）は利用終了より後になりうる |
| KRK-PAY-008 | リトライ時の時間条件も同様 |
| KRK-HLD-013 | `COMMITTED` の Hold に遅れて届く失敗通知の扱いを、コンビニの遅延通知と整理する必要がある |

### 4.2 SPEC-070

| 箇所 | 競合 |
|---|---|
| §3 / §8 | card のみ |
| §210〜214 | Session lifetime 30 分固定 |
| PAY-CHK-005 / 006 | Allocation / Hold は Payment Deadline まで有効でなければならない。コンビニでは保持期間の定義が必要 |
| PAY-FLR-003 | Payment Deadline 到達で Stripe 照合後に `EXPIRED`。コンビニでは buffer の考慮が必要 |
| PAY-WHK 系 | `checkout.session.completed` を支払い成功の候補として扱っている。コンビニでは `async_payment_*` が権威になる |
| PAY-RFD 系 | 返金の状態遷移がコンビニ返金（`requires_action`、顧客の銀行口座入力、45 日で `failed`）と合わない |

### 4.3 SPEC-100 / 110

| 箇所 | 競合 |
|---|---|
| SPEC-100 | generated column（30 分 / 45 分）、DB-KRK-006、クロステーブル条件（約 1215 行）、不変条件（約 2147〜2149 行） |
| SPEC-110 `API-PUR-KRK-001` | Hold は acquired + 45m。payment deadline は Session success + 30m |
| SPEC-110 `API-CHK-001` | 30 分の再検証。応答に `hosted_voucher_url` の返却がない |
| SPEC-110 末尾の不変条件 | 「Karaoke Hold は 45 分、Payment 30 分、Safety Buffer 5 分を変更しない」 |
| SPEC-110 購入開始 API | Entry + Goods を同時に受ける API が必要（現行は別々） |

### 4.4 SPEC-150 / 160 / 170 / 180

| 仕様 | 競合 |
|---|---|
| SPEC-150 REL-TMO-001 | 30 分 / 45 分 / 5 分を上流値として固定 |
| SPEC-150 REL-KRK-004 | Hold 期限切れスイーパー（1 分ごと） |
| SPEC-150 約 664 行 | `AWAITING_PAYMENT` の照合は Payment Deadline + 5 分、5 分ごと |
| Refund cadence（SPEC-150 / 170 / 180） | 30 分〜6 時間で自動 lookup 停止。コンビニ返金は最長 45 日 |
| SPEC-160 `OBS-ALT-009` | Refund Unknown aging の閾値 30 分（要確認） |
| SPEC-170 | TST-KRK、受入観点 22 が「45 分 / 30 分 / 5 分を上流値のまま」。コンビニ払いのテスト追加が必要 |

### 4.5 SPEC-050 / 020 / 030 / 040 / 120 / 140 / 200

- SPEC-050: PG-XFN-001 に、コンビニの入金待ち（`hosted_voucher_url` の案内、期限表示）の表現が必要。Browser Return が `success_url` ではなく voucher ページになる。
- SPEC-020 / 030 / 040 / 200: カート的な複数 Domain 購入（Entry + Goods）、支払い方法に関する FR / BR / UF / 受入基準の追加。
- SPEC-120: 支払番号（voucher リンク）の通知メールを追加するか。
- SPEC-140: voucher URL / 支払番号を機微情報として扱うか（ログ・URL への出力禁止など）。

## 5. 判断が必要な論点

### 5.1 Karaoke のコンビニ払い

| 案 | 内容 | 競合・リスク |
|---|---|---|
| H1 | Karaoke はカード払いのみ。Hold の規則は現行のまま | 仕様変更が最小。カードを持たない人は Karaoke を買えない |
| H2 | Hold の期限を支払い方法ごとに持つ（カード 45 分、コンビニは日単位） | §4 の競合を全て解消する必要がある。Slot の長期占有リスク。コンビニは利用日の十分前までしか選べない条件が要る |
| H3 | コンビニ払いの Karaoke は Hold なし。入金時に枠が空いていれば確定 | 入金時に他者へ販売済みだと、コンビニ返金が必要になる。INV-010-04（二重販売の防止）との整合が難しい。**推奨しない** |

作成時点の見解: **H1 を第一候補**（カード側の仕様をほぼ変えずに済み、時間枠と日単位期限の衝突を避けられる）。

### 5.2 Entry + Goods のコンビニ期限

- 基準案は 3 日（Stripe のデフォルト）。「長め」なら 7 日程度。販売期間の終了日を超えない。
- 期限は日単位、23:59:59 JST。失効の確定は `async_payment_failed` の受信を権威とする（buffer 中は入金されうる）。
- 未払いの在庫・容量占有が最大でこの日数続く。**未払いコンビニ Order の同時保有数の上限**を設けることを提案。

### 5.3 Entry + Goods 同一 Order の表現

- 新しい Purpose 値（Entry と Goods の複合）を追加するか、複数 Purpose の Order Item の混在を許可するか。
- SPEC-100 の `UNIQUE(id, purpose)` 系の制約と SPEC-030 の BR-ORD-012 が変わる。
- Entry と Goods はどちらも DB 内の Allocation で確保でき、Karaoke のような時間枠の競争がないため、部分失敗のリスクは小さい。

### 5.4 コンビニ返金の運用

- 顧客の銀行口座入力が必要、45 日で失効、返金ごとに手数料の可能性。
- Full Refund のみ、失敗時は Stripe 外で返金する運用を受け入れられるか。
- 自動 lookup の停止（6 時間）の見直しが必要。

### 5.5 その他

- コンビニ払いを採用しない場合は、カードのみのままとし、Entry + Goods 同一 Order の変更だけを行う選択肢もある。
- Stripe アカウントでコンビニ決済を有効化できること（本番審査を含む）の確認。

## 6. 採用する場合の仕様改訂範囲（概算）

上流から順に改訂する（SPEC-000 §11.3）。判断が出た後に、改めて範囲を確定する。

| 仕様 | 内容 |
|---|---|
| SPEC-020 / 040 | Entry + Goods の同一購入、コンビニ払いの FR・UF |
| SPEC-030 | BR-ORD-012 の変更、Order Purpose の表現、Allocation の保持期間 |
| SPEC-070 | 支払い方法の追加、期限、非同期入金の Webhook、返金（MAJOR 推奨） |
| SPEC-090 | Karaoke の扱い（5.1 の結論による） |
| SPEC-100 / 110 | 期限の列、Order 構造、購入開始 API、voucher URL の返却 |
| SPEC-120 / 140 | 支払番号の通知、機微情報の扱い |
| SPEC-130 / 150 / 160 / 170 / 180 / 200 | 運用画面、Recovery cadence、Audit、テスト、受入基準 |
| SPEC-050 | 支払い方法の選択、voucher 案内、入金待ち表示 |

## 7. フロントエンド側の前提（決定済み）

- 画面は SPEC-050 の PG-XFN-001 を基本とし、コンビニの `AWAITING_PAYMENT` では voucher 案内と期限を表示する。
- カードとコンビニの切り替えは Stripe Checkout 側で行う想定（独自の入力画面は作らない）。
- 仕様改訂が済むまで、`/cart`、コンビニ払いの実装には着手しない。

## 8. 次のステップ

1. 開発チームが §5 の論点を判断し、結果を共有する。
2. 判断を受けて、改訂範囲を確定し、上流の SPEC-020 / 030 / 040 から仕様を改訂する（仕様変更のコミットを実装より先に行う）。
3. 通常のワークフローで実装に進む。

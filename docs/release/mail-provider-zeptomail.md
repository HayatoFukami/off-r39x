# メール配信 Provider の変更: Resend → Zoho ZeptoMail

- 作成日: 2026-11-17
- 位置づけ: **仕様ではない**（正式仕様は `docs/specs/`）。Provider 変更の影響範囲、設計判断、技術確認（spike）、作業への反映をまとめた作業文書。
- 関連: [全体スケジュール](release-schedule.md)、[手順書](release-runbook.md)
- 根拠: プロジェクト所有者の指示（2026-11-17）、`docs/specs/` の記述（`origin/dev` `9b86851`）、Zoho ZeptoMail の公式ドキュメント（2026-11-17 に閲覧。**実機では未確認**）。

---

## 0. 要点

1. **メール配信 Provider を Resend から Zoho ZeptoMail に変える**（プロジェクト所有者の決定）。`SPEC-000 §8` により、**実装より先に Canonical Owner（`SPEC-120` ほか）を改訂する**。仕様 PR を 1 本追加する（**PR-SPEC-MAIL**）。
2. 単純な差し替えでは済まない。**Resend の機能を前提にした仕様の核が、ZeptoMail の公式ドキュメントでは確認できない。**
   - **Provider 側の冪等性（Idempotency Key）:** `SPEC-120 §25` は必須利用としているが、ZeptoMail には記載がない。
   - **送信結果の照会（同一キーでの再照合）:** Email Logs API（`GET /v1.1/email`）があり、公式資料に `client_reference` と `request_id` の検索条件が明記されている。ただし認証は OAuth 2.0 で、送信用の API キーとは別の資格情報になる。実環境の権限・反映の遅延・応答の解釈は S-7 で確認する。
   - **Webhook の署名と秘密の重なり期間:** Svix 方式ではなく独自方式（`producer-signature`）。Authentication Key は Agent 単位で 1 つで、**利用者が Agent に設定する**。ローテーション手順と猶予は記載がない。`SPEC-180 §29` の「現行と旧の 24 時間重なり」は、受信側に新旧の鍵を持たせる形で実現できる見込み（§3 の M-6）。切替直後の配信の挙動は S-6 で確認する。
   - **Webhook の event 種別:** `sent` / `failed` / `delayed` / `suppressed` に相当する event が確認できない。
3. 影響は **Notification の送信・結果不明の照合・Webhook・設定・Secret・Rate Limit class・テスト**に及ぶ。Business Notification の生成（`SPEC-120 Part II〜VI`）や Template は Provider に依存しない。
4. **仕様 PR の期限は W5 末（12/18）。** 通知の Provider 依存テーブル（`email_delivery_jobs`、`email_delivery_attempts`、`email_provider_webhook_receipts`）は L3-1（W6）で作るため、それまでに仕様が決まっていればよい。そのために **W2〜W3 に ZeptoMail の技術確認（spike）を行う**。
5. 外部申請は**今週から**。ZeptoMail はアカウントの審査に 2 営業日、ドメイン認証の DNS 反映に 24〜48 時間かかる。Neon Auth の確認メール（staging）も ZeptoMail の SMTP で送るため、W2 までに使える状態にする。

---

## 1. ZeptoMail について確認できたこと（公式ドキュメントの読取り）

出典は Zoho の公式ヘルプ（ZeptoMail、および同じ内容が掲載されている Zoho CPaaS のページ）。**ドキュメント上で確認できなかった項目は「未記載」とし、推測で埋めない。** 実機での確認は §4 の spike で行う。

### 1.1 送信 API

| 項目 | 確認できた内容 | Resend 前提の仕様との関係 |
|---|---|---|
| Endpoint | `POST /v1.1/email`。ホストは資料により `api.zeptomail.com` と `cpaas.zoho.com` が混在 | **要確認（S-1）。** Data Center ごとのホストが違う可能性 |
| 認証 | `Authorization: Zoho-enczapikey <token>`。**token は Agent 単位**（チャンネルごとにも別） | 環境ごと・用途ごとに Agent を分ければ Secret を分離できる（`INF-ENV-002`） |
| 必須項目 | `from`、`to`（`email_address` の配列）、`subject`。`htmlbody` / `textbody` は任意（少なくとも 1 つが要るかは未記載） | `SPEC-120 §24.2`（HTML と plain text の両方）は満たせる見込み |
| `client_reference` | 「自システムでメールを識別するための任意の文字列」。**最大長は未記載**。応答には含まれない（Webhook には含まれる） | Provider Idempotency Key の代わりに相関キーとして使う案（§3 の M-1） |
| 応答 | 成功: `data[]`（`code`、`additional_info`、`message`）、`message`、**`request_id`**。**message ID は無い** | `provider_message_id` は `request_id` で代用する案（§3 の M-2） |
| エラー | 400 は `data.error_code`（例 `TM_3004`）と `message`。401 は認証。**全 error code と再試行の可否は未記載** | `SPEC-120 §26` の応答分類表は作り直しが必要 |
| 冪等性 | **未記載。** 重複送信の抑止機能は確認できない | `SPEC-120 §25`、`EML-IDM-001/002`、23 時間の安全 cutoff が成立しない |
| timeout / retry の指針 | 未記載 | 結果不明（Unknown）の扱いを仕様で決める必要がある |
| 上限 | API の rate limit、受信者数の上限、request size は未記載（SMTP の合計 15 MB のみ記載） | 通知は 1 通知 1 受信者のため影響は小さい。上限は spike で確認 |
| 追跡 | `track_opens` / `track_clicks` は任意 | **無効にする**（個人情報と到達性のため。仕様で明示する） |

### 1.2 送信結果の照会

- 公式の **Get All Email Logs**（2026-11-17 閲覧）: `GET https://cpaas.zoho.com/v1.1/email`。**認証は OAuth 2.0**（`Authorization: Zoho-oauthtoken <token>`、scope は `Zeptomail.email.READ` または `Zeptomail.email.ALL`）。
- **検索条件**（すべて任意）: `request_id`、**`client_reference`**、`mailagent_key`、`recipient`（To / CC / BCC のいずれか）、`from`、`to`、`subject`、`date_from` / `date_to`（形式 `dd/MM/yyyy, hh:mm a`）、`is_delivered` / `is_hb` / `is_sb` / `is_mailfailure`、ページングは `offset` と `limit`。
- **応答**（200）: `data[]` に `email_reference`、`sent_time`、`subject`、`from`、`to`、`request_id`、`mailagent_key`、`status`（例 `delivered`）。**`client_reference` は検索条件にあるが、応答項目としては記載がない。**
- **未記載（S-7 で実環境を確認）:** 送信からログに現れるまでの遅延、検索が完全一致か部分一致か、`limit` の上限、Data Center ごとのホスト、OAuth の取得手順と scope の実在、`status` の取りうる値と「受理済み・配送中」の区別。
- ログの保持は既定で **60 日**。
- **Suppression（配信停止リスト）** の API 群もある。hard bounce の自動 suppress は未記載。

### 1.3 Webhook

| 項目 | 確認できた内容 |
|---|---|
| 設定場所 | Agent ごと。Webhook ごとに URL、説明、任意の Authorization header、event の選択 |
| Event | `Open`、`Click`、`Soft bounce`、`Hard bounce`、`Feedback loop`、`Delivered`。**`sent` / `failed` / `delayed` / `suppressed` に相当するものは未記載** |
| Payload | 最上位に `event_name`、`event_message`、`mailagent_key`、`webhook_request_id`。`event_message.email_info` に `email_reference`、`client_reference`、`bounce_address`、`from`、`to`、`processed_time` など。bounce は `event_data.details` に `reason`、`time`、`diagnostic_message`。**Delivered の payload は未記載** |
| 相関キー | `client_reference`（自システムの値）が Webhook に載る。`request_id` が送信 API の `request_id` と同じかは**未記載** |
| 認証 | 署名 header `producer-signature`（形式 `ts=<ミリ秒>;s=<base64 url-encoded>;s-algorithm=HmacSHA256`）。**Agent 単位の Authentication Key** を HMAC-SHA256 の鍵にする。サンプルでは body が form-encoded の 1 パラメータで、`=` 以降を URL decode して署名対象にする |
| 署名の弱点（サンプルからの推測） | サンプルの MAC は body だけを対象にし、`ts` を含まない。`ts` の許容範囲の検査はあるが、`ts` が署名に束縛されていない可能性がある。**`webhook_request_id` の dedupe を必須にする** |
| 配信保証 | retry、timeout、重複、順序、送信元 IP は**未記載** |
| 鍵のローテーション | **手順・猶予は未記載。** Agent に Authentication Key は 1 つ（**利用者が入力して設定する**。Zoho が生成する形ではない）。変更の可否は画面で確認する（S-6）。受信側で新旧の鍵を併用することは、Provider の仕様に依存せず**こちらの実装で可能**（§3 の M-6） |
| 検証 | 疎通確認（Verify）は 200 を返す。Delivered と Feedback loop は**模擬送信ができない**（実メールで確認） |

> 注意: Webhook の資料は「Zoho CPaaS / Agent」のページで、**ZeptoMail の製品ページとの対応が明記されていない。** 同じ仕様か、spike の S-5 で確認する。

### 1.4 アカウント・ドメイン・料金

| 項目 | 内容 |
|---|---|
| アカウント審査 | **新規アカウントは審査あり。** 「Customer validation form」を送り、**審査は 2 営業日**。審査前は購入ボタンが無効 |
| 用途の制限 | **トランザクションメールのみ。** 一括・宣伝メールは不可。本システムの購入確認、返金通知、認証メールは範囲内 |
| ドメイン認証 | **送信前に必須。** DKIM（TXT）と、返送先（bounce）用の CNAME。**SPF レコードは不要**（CNAME が兼ねる）。DNS 反映に 24〜48 時間。DNS を変更・削除すると送信が停止される。ドメインは最大 100 |
| Data Center | 公式の Data Hosting 表（Zoho CPaaS の GDPR ページ）に **US / EU / CN / IN / AU / JP**（日本は `cpaas.zoho.jp`）が載っている。地域は「アカウントを登録した Zoho のドメイン」で決まる。**ただし、その表は Zoho CPaaS 全体のもので、ZeptoMail のメール送信で日本を選べるか、契約・申請の画面で実際に選べるかは未確認。** 地域の選択はアカウント作成時（§3 の M-3） |
| SMTP | `smtp.zeptomail.com`、port 465（SSL）/ 587（TLS 1.2）。username は `emailapikey`、password は Agent の SMTP password。**Agent 単位** |
| 料金 | 従量のクレジット制。1 クレジット = 10,000 通、有効期間 6 か月、「最初の 1 クレジットは無料」。最低購入額は未記載。**審査前は購入できない** |
| Sandbox | 資料では未確認（サイトマップに sandbox の項目はある） |
| ログ | 既定で 60 日保持 |

### 1.5 Neon Auth の SMTP

Neon の資料では、本番の Neon Auth は**自前の SMTP**が要る（共有 sender は開発用で、確認リンクを送れない）。設定は管理画面・CLI（`neon neon-auth config email-provider update`）・API のいずれかで、**host、port、username、password、sender の完全な設定を毎回渡す**（部分更新は不可）。テンプレートは Neon 標準のまま。ZeptoMail の SMTP は標準的な SMTP なので使える見込みだが、**Neon 側との組合せは spike の S-2 で確認する。**

---

## 2. 仕様への影響（Canonical Owner 別）

件数は `docs/specs/` 内の `Resend` の出現数（grep）。**章番号は改訂候補であり、確定ではない。** 実際の改訂箇所は PR-SPEC-MAIL の planner が全文を読んで確定する。

| 仕様 | 件数 | 影響する箇所 | 改訂の内容 |
|---|---|---|---|
| `SPEC-120` | 70 | `§24` Provider 境界・設定、`§25` Provider idempotency、`§26` 応答分類、`§27〜28` Webhook（`API-WHK-EML-001`）、`§40〜41` 表、`EML-IDM-*`、`EML-WHK-*`、`EML-RSD-*`、Part Ⅸ 以降の Acceptance | **最大。** 冪等性の代替（相関キー）、結果不明の照合手段、Webhook の署名・dedupe・event の対応、23 時間 cutoff の削除、`provider` の CHECK（`'RESEND'`）の置換 |
| `SPEC-180` | 44 | `§8.1` Environment 表、`§9`（`EXPECTED_RESEND_ENV_ID`）、`§29` 秘密のローテーション、`§31` Resend environment、Secret 配布表、`§18.1` Neon Auth SMTP、`§58` alert、`INF-PRV-*`、`§71` 以降の Test group | env 変数名（`ZEPTOMAIL_*`）、Agent の分離、秘密の重なり期間（鍵が 1 つの場合の扱い）、Neon Auth SMTP |
| `SPEC-140` | 33 | `SEC-EML-005/012/016`、`§62〜64`、Rate Limit class `resend_webhook`（100 / 300 / global 3,000 per min）、body 上限 256 KiB | 署名検証、Secret 分類、class 名と値、`UNKNOWN_RESULT` の扱い |
| `SPEC-160` | 41 | log / metric の provider ラベル、Audit の項目 | `provider` の値（`RESEND` → `ZEPTOMAIL`）、metric 名があれば追随 |
| `SPEC-170` | 35 | Provider Contract Smoke（G9）、`TC-EML-*`、provider double の契約 | テストの契約を書き換える |
| `SPEC-150` | 41 | Retry Policy、`UNKNOWN_RESULT` 照合、外部呼出しの timeout | Resend 固有の記述の置換 |
| `SPEC-010` | 17 | System Boundary、構成図、`INV-010-06` | Provider 名 |
| `SPEC-190` | 14 | 例示・禁止事項の Provider 名 | 名前のみ |
| `SPEC-200` | 12 | `ACC-EML-*`、`ACC-INF-*` | 受入基準の Provider 名と、冪等性・照合の基準 |
| `SPEC-130` | 9 | `API-ADM-REC-006`（同一キー照合）、`ADM-EML-*` | 照合の手段 |
| `SPEC-110` | 5 | `API-WHK-EML-001` の path、`API-ADM-REC-006`、`§56.1` の class 表 | **`§56.1` の表は既存テストが実装と完全一致で照合する**（§3 の M-5）。class 名と値は維持する（M-5 の決定）ので、path と説明の文言だけ改訂する。変える場合は仕様と registry・テストを同じ PR で直す |
| `SPEC-100` | 2 | `email_provider_webhook_receipts` ほかの CHECK | `provider` の許可値 |
| `SPEC-020`、`040`、`050`、`060`、`000` | 各 1〜3 | 機能要件、画面、Neon Auth SMTP の記述 | 名前の置換が中心 |

Web の「再送（resend）」は一般語であり、Provider とは無関係（`apps/web` の `resend` はこの変更の対象外）。

### 2.1 改訂の区分（追加調査 2026-11-17）

プロジェクト所有者から提供された、現行 `origin/dev` の調査結果に基づく区分。PR-SPEC-MAIL の planner はこの区分で作業量を見積もる。

| 区分 | 仕様 | 内容 |
|---|---|---|
| **再設計級** | `SPEC-120` | 冪等モデル、Webhook、`tags`（相関）、DB 契約。**UCR が必要** |
| | `SPEC-150` | 結果不明の**再照合（probe）の設計**。Provider の同一キー lookup 前提を作り直す |
| | `SPEC-170` | テストケース、**署名 fixture**（署名方式が変わるため）、provider double の契約 |
| **実質改定** | `SPEC-140`、`SPEC-180`、`SPEC-160`、`SPEC-110`、`SPEC-010`、`SPEC-130`、`SPEC-190`、`SPEC-200` | 署名・replay、Secret・DNS・Runbook、metric と指紋ドメイン、Operation ID と path、境界図、管理の照合手段、受入基準 |
| **名称置換のみ** | `SPEC-000`、`020`、`040`、`050`、`060`、`100`、README | `Resend` → `ZeptoMail` |

- §2 の表で「名前のみ」と書いた `SPEC-150`、`SPEC-170` は、**再設計級に格上げ**する（上の表の「改訂の内容」より、本節の区分を優先）。
- `validate:traceability` の**スクリプト自体は修正不要**。`traceability/rule-code-map.json` と `tests/traceability/test-manifest.json` の追随だけでよい。
- レート制限は、Operation ID と class の構成が変わらないため、**ID を維持すれば既存の構造は変更なし**。**class 名は維持する（M-5 の決定、2026-11-17、運営者承認）。** 契約テストと E2E は変更不要。

### 2.2 実装（コード）の変更箇所

`origin/dev`（`9b86851`）で確認。Webhook 受信、送信ジョブ、メール用 DB は**未実装**のため、これらは**最初から ZeptoMail 前提で実装でき、差分は出ない**。

| 場所 | 変更 | 規模 | 備考 |
|---|---|---|---|
| `packages/providers/resend` → **新規 `packages/providers/zeptomail`** | 書き直し | 現行は 1 ファイル 169 行（`fetch` の薄い client） | **冪等キー前提を外す再設計が必要**（M-1）。`Idempotency-Key` header を送り、409 を冪等性の衝突として扱うコード（`index.ts` の送信部）と、その検証テストを作り直す |
| `packages/application` | `EmailRequest.key` の意味、`EmailLookup` の照合キーの見直し | 小〜中 | **M-1 の決定（案 A）に従い、S-3〜S-7 の結果で確定**。現行は Provider の冪等キーを前提にした型 |
| `packages/config` | 環境変数の置換 | 中 | `RESEND_API_KEY` → `ZEPTOMAIL_*`、Webhook 用 secret → Agent の Authentication Key、`EXPECTED_RESEND_ENV_ID` → `EXPECTED_*`。**Logs API（OAuth）を使う場合は client id / secret / refresh token を追加**（M-1 案 A、S-7） |
| `apps/email-worker`、`apps/reconciliation-worker` | import と生成の置換のみ | 各 1〜2 行 | `package.json` の依存名も変わる（`pnpm-lock.yaml` が更新される） |
| `packages/reliability`、`packages/observability`、`packages/security` | 名称置換のみ（**`resend_webhook` class は維持**。M-5） | 小 | `RECON.RESEND_*`、metric ラベルなど。`packages/security` の class・path の定義には触れない |
| `scripts/secret-scan.mts`、`scripts/check-import-boundaries.mts` | 名称置換 | 小 | パターンと許可パスの Provider 名 |
| `README.md`、`docs/backend-foundation*.md` | 名称置換 | 小 | |

**担当の割り当て:** 上の変更は**すべて L3-1a（W6、担当2）にまとめる**。M-5 で class 名を維持すると決めたため、**L3-1a は `packages/security` の class 名・path に触れない**（M-RL は不要）。

### 2.3 テスト・トレーサビリティの変更箇所

| 対象 | 変更 |
|---|---|
| provider の unit テスト（`tests/unit/foundation-runtime-providers.test.ts`） | 書き直し |
| config の合成値を持つテスト（**4 ファイル**） | 設定名の置換 |
| `tests/unit/scripts/secret-scan.test.ts` | パターンの置換 |
| tooling のパス固定（`tests/unit/foundation-tooling.test.ts` が `packages/providers/resend/src/index.ts` を固定）、secret-scan の fixture（`tests/harness/script-fixtures.ts` の `resendKey`、`re_` で始まる鍵の形式） | パスの置換。fixture は ZeptoMail の token 形式（`Zoho-enczapikey`）に合わせて作り直す |
| `traceability/rule-code-map.json` | **map 6 件**を更新 |
| `tests/traceability/test-manifest.json` | **manifest 2 件**を更新 |
| Rate Limit のテスト（`tests/unit/foundation-rate-limit-*.test.ts`、`tests/api/*`、`tests/security/*`） | **変更なし**（class 名と値を維持する。M-5 の決定） |
| 契約テスト、E2E | **変更不要** |

変更後は `pnpm validate:traceability`、`pnpm test:unit`、`pnpm check:boundaries`、`pnpm secret-scan` を通す（CI が正）。

### 2.4 設定・外部作業の変更箇所

| 作業 | 担当 | 時期 | 備考 |
|---|---|---|---|
| Zoho アカウントと、環境ごとの Agent の作成 | 運営者 | W1〜W2 | §3 の M-4 の 4 Agent |
| DNS に DKIM（TXT）と CNAME を追加 | 運営者 | 審査後 | 反映 24〜48 時間。**SPF の要否は要確認**（公式資料は不要としているが、spike S-1 で到達性とあわせて確認） |
| Railway の各サービスへ API キーを配置 | 運営者 | W6 前後 | **Webhook 用の鍵は `api` のみ**。`email-worker`・`reconciliation-worker` には送信用 token（と必要なら OAuth）だけを渡す |
| **Neon Auth の SMTP を ZeptoMail に切り替え** | 運営者 + 担当2 | W2 | 認証メール用。**業務用の Agent と分離**（`SPEC-180 §18.1`） |
| Resend 側のドメイン認証（DNS）の撤去 | 運営者 | 実施済みの場合のみ | **本計画では Resend の申請はまだ行っていない**ため、通常は不要。すでにレコードを入れた場合だけ、ZeptoMail の認証が通った後に削除する |

---

## 3. 設計判断（プロジェクト所有者が決める）

仕様 PR の前に決める。**推奨は付けるが、決定は所有者。** 決定済みの項目には「決定（日付、運営者承認）」と書く。M-1、M-5、M-6 は 2026-11-17 に決定。M-3 は未確定。

### M-1: 送信結果が不明なときの扱い（最重要）

背景: ZeptoMail には冪等性が確認できない。ネットワーク切断や 5xx で「送られたか分からない」とき、**同じ内容をもう一度送ると二重に届くおそれ**がある。現行仕様は「別の key で盲目的に再送しない」（`SEC-EML-016`、`EML-RSD-002`）。

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| **A（決定）** | `client_reference` に自システムの相関キー（`r39x-email/<job_public_ref>/<attempt_no>`）を入れる。不明時は**再送せず**、① Webhook（Delivered / bounce）の `client_reference` 一致、② Email logs API（`GET /v1.1/email`、`client_reference` / `request_id` で検索可と公式に明記。実環境での可否は S-7）の照会で確定する。**確定できなければ未解決のまま保持し、Consistency Review に流す**（再送しない） | 現行の方針（盲目的再送の禁止）を維持。二重送信を作らない。照会が使えない・遅れる場合も、A の中に未解決を保持する経路がある | 照会が使えないと、未確定が Review に流れる量が増える。Logs API の資格情報（OAuth）が追加で要る |
| B | 不明時の**再送を許可**する（二重に届く可能性を受け入れる）。再送の回数と間隔を決める | 実装が単純。メールが届かない事故が減る | 購入確認が 2 通届く可能性。`SEC-EML-016`、`ADM-EML-001` などの方針を変える（受入基準にも波及）。**照会の可否とは別の、独立した方針変更** |

**決定（2026-11-17、運営者承認）: 案 A。** 本文書の作業計画は A を前提にする。案 B（再送許可）は、二重送信を許容する**独立した方針変更**であり、運営者が別途判断する場合に限り検討する（本決定には含まれない）。

- Logs API が使えるかどうか（S-7）は、**A が成立するかではなく、Review に流れる量の見積り**に使う。S-7 の結果が悪くても、A のまま「未解決を保持して Review」で成立する。B への移行は、その運用負荷と二重送信の許容を比べて運営者が決める別の判断で、**spike の結果から自動で決まるものではない**（「照会できなければ B」と機械的には決めない）。
- 判断の時期は W4（spike の記録を受けて）。S-7 が遅れた場合は W4 前半に延ばす（スケジュール §6）。

> 追加調査（§2.2）でも、**二重送信を防ぐ代替設計が唯一の設計判断**で、残りは機械的な置換と追随とされている。したがって M-1 が決まれば、`EmailRequest.key`・`EmailLookup`・`SPEC-150` の probe・`SPEC-120` の冪等モデルが連動して確定する。

### M-2: Provider message ID と Webhook の dedupe key

- `provider_message_id`（partial UNIQUE）は、送信 API の `request_id` を使う案を推奨。ただし**Webhook の `request_id` が送信 API の `request_id` と同じか**を S-5 で確認する。同じでなければ、`client_reference` で Attempt と結びつける。
- Webhook の dedupe key（`provider_event_key`）は `webhook_request_id` にする。

### M-3: ZeptoMail の Data Center（地域）

公式の Data Hosting 表（Zoho CPaaS の GDPR ページ）には **JP（`cpaas.zoho.jp`）が載っている**（§1.4）。したがって「日本がないので国外 Data Center を前提にする」とは書かない。ただし、(1) その表は CPaaS 全体のもので、**ZeptoMail のメール送信で日本を選べるか**、(2) 契約・申請の画面で**実際に選べるか**、(3) 地域を後から変えられるか、は**未確認**。**受信者のメールアドレス・氏名・購入内容が国外の Data Center を通る可能性**は、日本を選べない場合に限って残り、その場合はプライバシーポリシー（法務表示。作業計画 O-10）と整合させる。

- **初回の決定は W1（アカウント作成時）。** 地域は登録に使う Zoho のドメインで決まり、後から変えられない可能性があるため、W1 の申請画面で日本を選べるかを確認して決める。
- **W4 は確認・整理の時期。** W1 の決定が spike（S-1）の実測（API ホスト、到達性）と整合しているか、法務表示（W8）への反映内容をそろえる。W4 で地域を変えるのは、W1 に決められなかった場合に限る。
- 日本を選べない場合の判断（国外 Data Center を許容するか、別の Provider を検討するか）は**要判断（運営者）。未確定**（W1 の申請画面で選べるかを確認してから決める）。

### M-4: 環境と用途ごとの Agent 分離

Token・SMTP password・Webhook の Authentication Key がすべて **Agent 単位**。したがって Agent を次のように分ける（`INF-ENV-002`、`SPEC-180 §18.1` の Neon Auth SMTP 分離）。

| Agent | 用途 | 使う側 |
|---|---|---|
| `production-business` | 本番の業務通知（API 送信 + Webhook） | `email-worker`、`api`（照会）、`reconciliation-worker` |
| `production-neon-auth` | 本番の Neon Auth の確認メール（SMTP のみ） | Neon Auth の保護設定のみ |
| `staging-business` | staging の業務通知 | staging の同上 |
| `staging-neon-auth` | staging の Neon Auth | staging の Neon Auth のみ |

Agent 名は例。実名は運営者が決める。**アラート通知（Better Stack 側）に ZeptoMail の業務キーを使わない**（`SPEC-180 §58`）。

### M-5: path と class の名前（CI との関係）

**決定（2026-11-17、運営者承認）: 案 A。Rate Limit の class ID `resend_webhook` を維持する。M-RL は不要。**

- Webhook の path は `/api/v1/webhooks/zeptomail` を推奨する。**path はどのテストも読まない**（`tests/` と `scripts/` に `webhooks/resend` の参照はない。確認済み）ので、仕様だけを先に改訂しても CI は落ちない。
- **Rate Limit の class 名は、仕様と実装が完全一致で照合される。**
  - `TC-RLM-007-001`（`tests/api/foundation-rate-limit-registry-api.test.ts`）は `SPEC-110 §56.1` の「class → Operation ID」を `packages/security` の `OPERATION_CLASS_ASSIGNMENT` と**完全一致**で比べ、class の集合を `RATE_LIMIT_CLASS_IDS` と比べる。
  - `TC-RLM-006-001`（`tests/unit/foundation-rate-limit-registry.test.ts`）は `SPEC-140 §68` の行（Class ID、per-IP の値、追加ルール）を registry と**完全一致**で比べる。
  - したがって、**仕様だけを `zeptomail_webhook` に改名した時点で CI が落ちる**。逆に registry だけを先に改名しても落ちる。class 名と、per-IP・global の**値**を変えるときも同じ。
- **採用: 案 A。** PR-SPEC-MAIL は、path・説明・Provider 名の文言だけを改訂し、`SPEC-110 §56.1`・`SPEC-140 §68` の **Class ID と値は変えない**。「歴史的な識別子であり、Provider 名の意味を持たない」と注記する。registry・operations・テストは変更なし。各 PR で CI が通る。
  - **残る負債:** 名前が実態と合わない。metric・log の class ラベルに `resend_webhook` が出る。公開後に整理する場合は、仕様と registry・テストを同じ PR で改名する（その時点で改めて判断）。
  - 値（per-IP 100 / 300、global 3,000/分）は、Provider が変わっても妥当かを PR-SPEC-MAIL で再評価する。**再評価の結果、値を変える必要が出た場合は、仕様と registry・テストを同じ PR で直す**（この場合は本決定の範囲外なので、運営者の承認を取り直す）。
- 不採用: 案 B（`zeptomail_webhook` に改名し、仕様・registry・テストを同じ PR で直す）。runbook §0.1 の「仕様の改訂は別の PR」の例外が要り、担当1の W4〜W5 の負荷が増えるため。段階的な別名（旧名と新名を同時に許す）は、テストが集合の完全一致を要求するため使えない。

### M-6: Webhook の署名鍵のローテーション

公式資料では、Authentication Key は**利用者が Agent に入力して設定する**（Zoho が生成する形ではない）。Agent に 1 つで、変更手順・猶予・旧鍵の扱いは記載がない（§1.3）。したがって「Provider 側に旧鍵が残る間だけ新旧を併用できる」という前提は取らない。**受信側（こちらの verifier）が新旧の両方を持つことは、Provider の仕様に依存せず実装できる。** Provider が同時に使う鍵が 1 つでも、受信側へ新旧を先に配置してから Provider の鍵を切り替えれば、切替の前後で検証できる。これは `SPEC-180 §29` の手順（sealed へ current / previous を両方配置 → verifier が両方で検証 → Provider の配信を新へ切替 → 最大 24 時間以内に旧を削除）と同じ形で、Provider が鍵を生成する前提ではない点だけが異なる。

| 案 | 内容 | 長所 | 短所・条件 |
|---|---|---|---|
| ① | 新しい Agent を作り、Webhook を付け替える | 旧 Agent の鍵をそのまま捨てられる | Agent が増える（M-4 の 4 つに加える）。Token・SMTP password も別になるので、Secret の入れ替え範囲が大きい |
| **② （決定）** | **受信側で新旧の鍵を併用する。** 新鍵を `api` に配置（verifier は current / previous の両方で検証、timestamp と `webhook_request_id` の dedupe は維持）→ Provider の Authentication Key を新へ変更 → 最大 24 時間後に旧を削除。侵害時は併用せず旧を即時 revoke（`SPEC-180 §29`） | 停止なし。`SPEC-180 §29` と同じ運用で、仕様の改訂が小さい | S-6 で確認が要る: (a) 鍵を変えた直後に、変更前に生成された配信が旧鍵の署名で届くか、(b) Provider が失敗した配信を再送するか（再送があれば旧鍵の期間を長めに取る）。(a)(b) が不明のままなら、旧鍵の削除を (a)(b) の確認後にする |
| ③ | 短い停止を許容し、取りこぼしを照合で補う | 実装が最も単純 | **条件つきで許容する**（下記） |

**決定（2026-11-17、運営者承認）: ② 受信側の新旧鍵併用。** 停止を許容する ③ は、②が S-6 で成立しないと分かった場合の代替とする（その場合は、③ を許容する範囲を運営者が改めて決める）。

③ を選ぶ場合の条件（`SPEC-120 §28.3`: 署名検証済みの Webhook は、`PENDING` / `FAILED_RETRYABLE` で Attempt が Unknown のときに結果を確立する**証拠**になる）:
1. **停止の時間窓を記録し、上限を決める**（例: 分単位。運営者が決める）。窓の間に Unknown の Attempt があったかを、窓の後に必ず調べる。
2. **窓の間の取りこぼしを補える手段があること。** Email logs API（S-7）で、`client_reference` / `request_id` により Attempt の結果を引ける場合に限る。S-7 で使えないと分かったら ③ は選べない。
3. **照合で補えるのは「Provider が受理した事実」まで。** bounce・failed などの配信後の event は、窓の間に落ちた場合に照合では補えない可能性がある（Logs API の `status` の粒度は S-7 で確認）。補えない event は、通知の Domain State を変えない範囲（`SPEC-120 §28.4` の receipt 履歴）なら欠落を許容し、補えない場合の扱いを PR-SPEC-MAIL に書く。
4. **未解決のまま残った Attempt の扱い:** 再送せず（M-1 の A）、Consistency Review に流して管理者が確定する。窓の後に未解決が残る可能性があるので、窓は Unknown の Attempt が出にくい時間帯（深夜・低トラフィック）に置く。

`SPEC-180 §29` の「24 時間の重なり」は Stripe の秘密にも適用する。

---

## 4. 技術確認（spike）

**目的:** M-1 と M-6 の判断材料を、実機で得る。**担当2が実施**し、担当1が結果を仕様 PR に反映する。staging 用の Agent と**合成の受信先**だけを使う（本番の受信者・実在のメールアドレスをリポジトリや記録に書かない）。

**Webhook の spike（S-5・S-6）は業務 API に登録しない。** 業務 API の受信口（`/api/v1/webhooks/<決定した path>`）は PR-SPEC-MAIL のマージ後（W6 前後）に作るため、W3 の spike には使えない。W2 に **spike 専用の検証用受信先（S-0）**を用意し、W6 以降の業務 API への登録（runbook §1.2 手順 10b）と区別する。

| # | 確認すること | 合格の基準 | 期限 |
|---|---|---|---|
| S-0 | **検証用 Webhook 受信先の準備**（業務 API とは別）。使い捨ての HTTPS の受信口（staging の Agent の Webhook にだけ登録）。raw body と header を記録でき、個人情報を伏せて保存する。公開インターネットから到達でき、HTTP 200 を返す。**Webhook の Verify（疎通確認）が通ることまで確認する** | Agent の Webhook 設定で Verify が 200 になる。受信した header と raw body を取り出せる | W2（S-5 の前提） |
| S-1 | API のホストと Data Center、`Authorization` の形式、最小の送信 | 合成の宛先へ送信でき、`request_id` が返る | W2 |
| S-2 | **Neon Auth の SMTP 設定**（staging）。確認メール・Email OTP・Magic Link の到達 | Neon の送信テストと実際の登録で届く | W2 |
| S-3 | `client_reference` の最大長、使える文字、`r39x-email/<uuid>/<n>` の形式 | 採用予定の形式で送れる | W3 |
| S-4 | 同じ内容を 2 回送ったときの挙動（重複の抑止があるか）、5xx・timeout の実測 | 二重に届くかを記録（M-1 の判断材料） | W3 |
| S-5 | **Webhook**（S-0 の受信先に登録）: 登録、event の一覧、payload（特に Delivered）、`client_reference` と `request_id` の対応、`webhook_request_id`、retry の有無と間隔、HTTP 応答コード | event ごとのサンプルを（個人情報を伏せて）記録 | W3 |
| S-6 | **署名検証**（S-0 の受信先）: `producer-signature` の署名対象（body のどの部分か、`ts` が署名に含まれるか）、**鍵の入れ替え**（Authentication Key を変えた直後に、変更前に生成された配信が旧鍵で署名されて届くか。M-6 の ②/③ の判断材料） | `node:crypto` で検証でき、改ざんを拒否できる。鍵入れ替えの前後の挙動を記録 | W3 |
| S-7 | **Email logs API**（`GET /v1.1/email`）: 認証（OAuth の取得方法と scope `Zeptomail.email.READ`）、`client_reference` / `request_id` での検索（公式資料に明記。実環境の権限・完全一致か部分一致か・`limit` の上限）、送信から現れるまでの**遅延**、応答の `status` の粒度 | 不明な送信を 1 件照会できる。結果を M-1 の Review 量の見積りと M-6 ③ の条件に反映 | W3 |
| S-8 | bounce / complaint の実挙動（受信拒否の宛先に送る）、suppression の自動登録 | `Hard bounce` の webhook と suppress の有無を記録 | W3 |
| S-9 | 送信量・API の制限（rate limit）、非本番の送信先の制約、sandbox の有無 | 数値を記録（なければ「未記載」と記録） | W3 |

結果は spike の記録（日付、環境、確認した値の範囲。Secret と実在のアドレスは書かない）にまとめ、W3 末（12/4）に担当1へ渡す。**S-0 の受信先は、spike の終了後に Webhook の登録を削除して廃止する**（W6 に業務 API へ登録する前に、Authentication Key も新しい値へ入れ替えて spike 用の鍵を無効にする）。

---

## 5. 作業への反映

| WP / PR | 内容 | 担当 | 時期 | 依存 |
|---|---|---|---|---|
| **外部申請（M-APP）** | ZeptoMail アカウント作成、審査申請、Data Center の決定（M-3）、ドメイン（DKIM + CNAME）、Agent 4 つ | **運営者** | W1〜W2 | ドメイン取得 |
| **M-SPK** | §4 の spike（S-0〜S-9）と記録。**S-0（検証用 Webhook 受信先）は W2 に用意し、到達性を確認する** | 担当2 | W2〜W3 | M-APP の審査 |
| **PR-SPEC-MAIL**（仕様） | `UCR-120-xxx`（番号は Canonical Owner の採番表で確認）。`SPEC-120` を中心に、§2 の仕様を改訂。M-1〜M-6 の決定を反映。**Rate Limit の class ID（`resend_webhook`）と値は変えない（M-5 の決定）。仕様の文言だけで、コードに触れない** | 担当1（planner が下書き、所有者が決定） | 起票 W4、**マージ目標 W5 末（12/18）** | M-SPK の結果、決定 M-1〜M-6 |
| **L3-1a** | §2.2〜2.3 の実装・テストの変更を 1 つにまとめる（`packages/security` の class 名・path には触れない。M-5）: Provider adapter（`packages/providers/zeptomail`）の新設、`packages/providers/resend` の撤去、`EmailRequest.key` と `EmailLookup` の見直し、設定名の変更、secret-scan・tooling・traceability（map 6 件 + manifest 2 件）の追随、`SPEC-120 §40` の表の migration（担当2が草案、担当1が採番）。PR が 600 行を超える場合は「adapter + application の型」と「名称置換 + テスト追随」に分ける | 担当2 | W6 | PR-SPEC-MAIL |
| L3-1b / L3-2 | Email Worker、Webhook 取込み、通知の管理参照、`API-ADM-REC-006` | 担当2 | W7〜W8 | L3-1a |
| G9 | Provider Contract Smoke を ZeptoMail の非本番 Agent で実施 | 担当2 | W11 | 非本番 credential |

**PR-SPEC-MAIL が遅れた場合:** L3-1 の Provider 依存部分だけが待つ。それ以外（通知の生成 `PR-L1-1c`、Webhook 以外の Worker 基盤、L3-3 スケジューラ）は進められる。**W11 に余白はない**（G9、staging 総合検証、本番環境構築、migration 予行が既に入っている。[スケジュール](release-schedule.md) §3）ので、W11 で吸収する前提は取らない。W5 末に未マージなら、[スケジュール](release-schedule.md) §6.1 の手順で、担当2の再配分と機能凍結日（1/23）を**再判定**する（**未確定。要判断: 運営者**）。

---

## 6. 注意点・未確認

- **ZeptoMail は 2026 年 9 月に Zoho CPaaS へ改称された**（公式の更新情報。既存の Agent・ドメイン・設定は変わらないと記載）。ただし資料は混在しており（ホストが `api.zeptomail.com` と `cpaas.zoho.com`、scope 名は `Zeptomail.*`、Webhook・Data Hosting の資料は CPaaS 名義）、画面名・ホスト・API のパスが変わる可能性がある。申請・設定の時点の公式案内を優先する。
- 本書の ZeptoMail に関する事実は**ドキュメントの読取り**で、**実機では何も確認していない。** 特に Webhook の署名・Email logs API・Delivered event は spike で確かめる。
- 費用（クレジット、必要通数）は未見積り。想定の通数（購入確認・認証メール・再発行）から、運営者が購入量を決める。
- Neon Auth の標準メールの本文は Neon 側のテンプレート。**送信元（From）と Provider のドメイン認証だけがこちらの責任範囲。**

# リリースに向けた手順書（運営者・担当1・担当2）

- 作成日: 2026-11-17（v2）
- 位置づけ: **仕様ではない**（正式仕様は `docs/specs/`。食い違ったら仕様が正）。[全体スケジュール](release-schedule.md) の各作業を、**誰が・どの順で・何をもって完了とするか**に落とした手順書。
- 関連: [メール Provider の変更（Resend → ZeptoMail）](mail-provider-zeptomail.md)
- 書かないもの: Secret の値、実在のメールアドレス、口座・本人確認情報、実際のドメイン名・会場名・価格。これらはリポジトリに置かない（`AGENTS.md §5`、`SPEC-180 §69`）。ドメインの例は `example.com`。

---

## 0. 共通ルール

### 0.1 リポジトリの運用（承認済み: 2026-11-17）

| 項目           | 規則                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ブランチ       | mainはリリースブランチ、起点は常に最新の `origin/dev`。名前は `<種別>/<WP-ID 小文字>-<slug>`（例 `feat/l1-2c-entry-allocation-repo`、`fix/s0-0c-db-retry-55p03-http-errors`）。1 ブランチ = 1 PR、base は `dev`                                                                                                                                                                                                                                                                                   |
| スタック PR    | 1 段まで。`backend-foundation.yml` の `pull_request.branches` は `[dev, main]` なので、base がそれ以外（作業ブランチ）の PR は CI が動かない。前の PR のマージ後に base を `dev` へ付け替えて CI を通す                                                                                                                                                                                                                                                                                           |
| `dev` の取込み | `git merge origin/dev`。rebase と force-push は原則使わない。やむを得ない force-push は `--force-with-lease=<ref>:<SHA>` と 4 項目の説明、利用者の承認（`~/.claude/rules/git-force-push.md`）                                                                                                                                                                                                                                                                                                     |
| コミットの型   | C1 `test(...)`（失敗するテスト）→ C2 `feat(db)` migration → C3 repository → C4 `feat(api)` → C5 `chore(traceability)`。レビュー対応は追加コミット（amend しない）。末尾に指定の `Co-Authored-By` 行                                                                                                                                                                                                                                                                                               |
| PR の大きさ    | テストと生成物を除いて 600 行以内、Operation は 1 PR に 1〜3 本。migration の PR と、それを使うコードの PR は分ける                                                                                                                                                                                                                                                                                                                                                                               |
| 仕様の改訂     | **別の PR で先にマージ。** 実装 PR に `docs/specs/**` の変更を混ぜない。**注意:** 仕様と実装が既存テストで完全一致照合される項目（Rate Limit の class ID・値、`SPEC-110 §56.1`、`SPEC-140 §68`）は、仕様だけ先にマージすると CI が落ちる。PR-SPEC-MAIL では **class ID `resend_webhook` と値を変えない**（[mail-provider-zeptomail.md](mail-provider-zeptomail.md) §3 の M-5、2026-11-17 決定）。今後これらを変える場合は、同じ PR（仕様のコミット → コードのコミット）で直し、運営者の承認を取る |
| GitHub 操作    | `gh` CLI で行い、`-R off-r39x/website`（現在の `origin`）を明示。旧名 `HayatoFukami/off-r39x` は GitHub が同じリポジトリへ転送しており（`gh repo view` で同一の `off-r39x/website` が返る）、`.claude/rules/github-cli.md` はまだ旧名で書かれている。新名の方が、転送の解除（旧名で別のリポジトリが作られた場合）の影響を受けない。ルールファイルの表記の更新は利用者が判断する。**PR・Issue の作成、コメント、マージは利用者の承認後**（`.claude/rules/github-cli.md`）                          |
| レビュー       | 1〜2 往復を前提にする。3 往復目に入ったら理由（範囲 / 仕様の曖昧さ / テスト不足）を記録する。仕様の解釈が割れたら PR を止めて UCR（`SPEC-000 §15.2` 形式）に切り出す                                                                                                                                                                                                                                                                                                                              |

### 0.2 1 つの PR を作る手順（agent の回し方）

1. `git fetch` → `origin/dev` からブランチを作る。
2. **planner**: WP 計画書（`ref/planning/<日付>-<WP-ID>-<slug>.md`）を作る。→ **承認 G-a**（Rule ID、テスト方針、未決事項を利用者が確認）。
3. **tester**: 失敗するテストを先に作る（意図した理由で失敗することを確認）。
4. **coder**: 最小の準拠実装。仕様と食い違ったら止めて **G-d**（UCR 案）。
5. 検証（§0.3）。最初の gating failure と修正後の clean run を区別して記録（`DEV-TST-010`）。
6. **reviewer**: 計画書・仕様・diff だけを根拠にレビュー。指摘は担当別に戻す。クリティカル領域（購入・決済・Ticket・入場確認）は担当外の人が reviewer の結果を確認。
7. 完了報告（`SPEC-190 §39` の固定見出し）→ **G-b**（PR 作成の承認）→ CI → **G-c**（マージの承認）。
8. マージ後、`dev` で `pnpm validate:traceability` が通ることを確認して次へ。

> `.claude/agents/*.md` に「ソースが存在しない」という古い記述が残っている。agent を起動するプロンプトで `AGENTS.md` と WP 計画書を優先するよう指定する。

### 0.3 検証コマンド（PR ごと、ルートから）

```sh
pnpm lint
pnpm typecheck
pnpm check:boundaries
pnpm validate:traceability
pnpm validate:migrations
pnpm test:unit
pnpm test:backend      # 実 PG17（TLS）と実 Redis が必要。未設定なら skip ではなく失敗
pnpm build:backend
pnpm secret-scan --build-dir dist --require-build
```

- Web を変える PR は `pnpm --filter @off-r39x/web typecheck` と `pnpm test:e2e`（直列。`127.0.0.1:3100` を専有）を追加する。
- **実行できない検証は「未実行・理由・公開への影響」を PR に書く。** 成功として扱わない。Windows の手元では Docker が使えず `test:backend` を流せない場合がある。**CI（Linux、`backend-foundation.yml`）を正とする。**
- テストの skip / quarantine、retries の追加、仕様違反の実装に合わせた期待値の書換えをしない。

---

## 1. 運営者（プロジェクト所有者）の手順

外部サービスの申請・契約・本人確認は**運営者本人**が行う。AI エージェントは申請フォームへの入力、決済情報・本人確認書類・パスワード・API キーを扱わない。値を受け取ってもリポジトリ・Issue・チャット・ログに書かない。全アカウントに 2 要素認証を設定し、2 人目の運営者をメンバーに追加する。

### 1.1 W1（今週）にやること

| #   | 作業                                                                                                                                                       | 完了条件                       | 備考                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| O-1 | 運営主体・名義、公開する運営者情報、問い合わせ用の受信メール窓口を決める                                                                                   | 申請フォームの入力元が確定     | 全申請の前提。Stripe は名義で開設できる形が要る                                   |
| O-2 | 本番ドメインの取得、DNS を Cloudflare で管理                                                                                                               | ゾーンが有効                   | Web と API / Auth は同一親ドメイン配下（`SPEC-180 §10`）。wildcard DNS は作らない |
| O-3 | **ZeptoMail の申請**（§1.2）                                                                                                                               | アカウント作成・審査申請を提出 | **審査 2 営業日。ここが Neon Auth の確認メール（W2）の前提**                      |
| O-4 | **Stripe**: staging 用のテスト環境、本番アカウントの開設・審査申請                                                                                         | テストキー発行、審査申請を提出 | 支払方法はカードのみ（仮定）。審査の日数が読めないため最優先                      |
| O-5 | Cloudflare（Pages プロジェクト、Access）、Google OAuth（環境別 credential）、Neon・Railway・Better Stack・Healthchecks.io・GitHub Environment のアカウント | アカウントとメンバー           | 実機確認（Neon Auth、#42〜#45）の前提                                             |
| O-6 | 仕様 PR の決定: **D-2（RELSCOPE の R-1〜R-8）、D-3（SEED、IDM）**                                                                                          | 選択肢を選ぶ                   | planner の下書きを見て決める。RELSCOPE が最優先                                   |

### 1.2 ZeptoMail の申請手順

画面名・要件は変わる可能性がある。**申請時点の公式案内を優先し、差異を記録する。** 詳細な根拠と未確認事項は [mail-provider-zeptomail.md](mail-provider-zeptomail.md)。

1. **アカウントを作成する。** Data Center（地域）を選ぶ（M-3 の**初回決定。W1**）。公式の Data Hosting 表には JP（日本）が載っているが、ZeptoMail のメール送信で選べるか、画面で実際に選べるかは**未確認**。日本を選べるかを申請画面で確認し、選べない場合は、受信者情報が国外の Data Center を通ることを承知のうえで地域を決める（プライバシーポリシーに反映）。地域は後から変えられない可能性がある。**決定を記録する。**
2. **アカウントの審査を申請する**（Customer validation form）。用途は「本システムのトランザクションメール（購入確認、返金通知、認証メール）に限る」と書く。一括・宣伝メールは不可。審査は 2 営業日が目安。
3. **Agent を 4 つ作る**（名前は運営者が決める）。Token、SMTP password、Webhook の Authentication Key が Agent 単位のため、これで環境と用途を分離する。

   | Agent                | 用途                                       |
   | -------------------- | ------------------------------------------ |
   | production-business  | 本番の業務通知（API 送信、Webhook）        |
   | production-neon-auth | 本番の Neon Auth の確認メール（SMTP のみ） |
   | staging-business     | staging の業務通知                         |
   | staging-neon-auth    | staging の Neon Auth の確認メール          |

4. **送信ドメインを追加して認証する**（送信前に必須）。本番はサブドメイン（例 `mail.example.com`）を推奨。表示される **DKIM（TXT）と返送用の CNAME** を Cloudflare の DNS に登録する。SPF レコードは不要（CNAME が兼ねる）。DNS 反映に 24〜48 時間。**DNS を後から変更・削除すると送信が止まる**ので、レコードを台帳に記録して触らない。staging は別の送信元（別サブドメイン）にする。
5. **認証後に到達性を確認する**（Gmail・Outlook・携帯キャリア宛。合成の受信先を使う）。
6. **Secret を保管する。** 各 Agent の Send Mail Token、SMTP password、Webhook の Authentication Key は、**発行時に保管庫（運営者管理）へ移し、チャット・Issue・ログに貼らない。** 本番の Secret は Railway の Sealed Variables、Neon Auth 用の SMTP は Neon の保護設定へ（担当2が設定。値は運営者が直接入力）。
7. **担当2へ渡す情報（Secret でない識別子のみ）:** Agent 名、Data Center、送信ドメイン、`EMAIL_FROM` に使う送信元の形式、承認済みの非本番送信先の一覧（運営者のテスト用アドレス。リポジトリには書かない）。
8. **Railway への配置:** Webhook 用の Authentication Key は `api` のみ。`email-worker`・`reconciliation-worker` には送信 token（と、Logs API を使う場合の OAuth 値）だけを渡す。
9. **（Resend の DNS を入れていた場合のみ）** ZeptoMail の認証が通った後に Resend 側のレコードを撤去する。本計画では Resend の申請は未実施のため、通常は不要。
10. **Webhook の登録は 2 段階に分ける。**
    - **10a（spike 用。W2〜W3）:** 担当2が用意した**検証用受信先**（runbook §3.1 の S-0。業務 API とは別）を staging-business に登録し、Authentication Key を運営者が設定する（担当2は Verify で 200 を確認する）。spike（S-5・S-6）の間だけ使い、終わったら登録を削除する。
    - **10b（業務 API 用。W6 前後）:** API が staging で到達可能になり、PR-SPEC-MAIL がマージされた後に、`/api/v1/webhooks/<決定した path>` を staging-business に登録する。**登録の前に、Authentication Key を 10a とは別の新しい値へ入れ替える**（spike 用の鍵を無効にする）。
11. **クレジットを購入する**（審査通過後）。必要通数を見積る。有効期間は 6 か月、最初の 1 クレジット（10,000 通）は無料。**本番公開日から逆算して購入する。**

### 1.3 以降の運営者の作業

| 時期 | 作業                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W2   | ZeptoMail の審査結果と DNS の反映を確認。**R-7、SEED、IDM を決定**。M1 の扱いは**決定済み**（schedule §2.1、案 A）                                                                                                            |
| W3   | spike の結果（M-SPK）を確認                                                                                                                                                                                                   |
| W4   | **M-1（案 A）、M-5（案 A）、M-6（②）は 2026-11-17 に決定済み**（PR-SPEC-MAIL に反映）。**M-3 は未確定**で、W1 の決定の確認と W1 の決定の確認と法務表示への反映（[mail-provider-zeptomail.md](mail-provider-zeptomail.md) §3） |
| W5   | PR-SPEC-MAIL のレビュー・承認                                                                                                                                                                                                 |
| W8   | 法務表示（特定商取引法に基づく表記、利用規約、プライバシーポリシー）を確定。**専門家の確認を推奨。** 仕様と UI mock に画面がない（作業計画 O-10）ため、置き場所を決める                                                       |
| W11  | Stripe 本番審査の完了、本番の ZeptoMail Agent・ドメインを確認                                                                                                                                                                 |
| W12  | 本番の Secret の投入を承認。**`production-business` の Authentication Key（staging とは別の値）を `api` にのみ配置**                                                                                                          |
| W13  | **公開の承認**。本番 API のデプロイ後、公開の承認の前に、**`production-business` の Webhook を登録して受信を確認**（§4.3）                                                                                                    |

---

## 2. 担当1（バックエンド）の手順

詳細（PR ごとのコミット列、承認時の確認点）は担当1の手順書（WP 計画書の入力）にある。ここでは順序と完了条件を示す。**用語:** WP = 作業パッケージ、冪等性 = 同じ操作を 2 回送っても結果が 1 回分になること、hot concurrency（G10）= 同時に多数のリクエストを当てて過販売・二重使用が起きないことを実 PostgreSQL で確かめる試験。

### 2.1 W1〜W2: 基盤と共通部品（S0）

| 順  | PR                            | 内容                                                                                                                       | 完了条件                                                           |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | **PR-S0-0c**                  | DB の lock timeout（`55P03`）を `SPEC-150` どおり retry。405 / 415 のエラーコード追加。`docs/backend-foundation.md` の更新 | CI 緑。既存テストの期待値を変えるのは `55P03` の行だけ             |
| 2   | PR-SPEC-RELSCOPE / SEED / IDM | 仕様 PR（§4 の順）。planner が下書きし、運営者が決定                                                                       | 仕様が Canonical Owner の本文に反映されてマージ                    |
| 3   | PR-S0-2                       | `packages/db` の schema / transactions の骨組みと採番ルール                                                                | `0001` と `schema-contract.json` が 1 文字も変わらない             |
| 4   | PR-S0-4                       | `audit_events`（`0002`）と writer                                                                                          | 実行時 role は INSERT のみ。UPDATE / DELETE が拒否される           |
| 5   | **PR-S0-1a / 1b**             | `api-contract` と `apps/api` のファイル分割（挙動不変）                                                                    | 既存テストが**修正なし**で通る。以降の PR が共通ファイルを触らない |
| 6   | PR-S0-3a〜3c                  | エラー封筒、ページング、冪等性の入力                                                                                       | 判定できないときは拒否（fail-closed）。内部情報がエラーに出ない    |
| 7   | PR-S0-5                       | 通知の enqueue と Review 起票の**型**                                                                                      | 担当2が型をレビューして合意                                        |
| 8   | PR-S0-3d                      | 冪等性の replay 記録（PR-SPEC-IDM のマージ後）                                                                             | 同じ key・別内容は `409`                                           |

### 2.2 W2〜W4: 公開・販売系と Identity

> M1（W2 末）に公開 API の実接続を含めるか: **決定（2026-11-17、運営者承認）: 案 A**（M1 には含めず M2、W3 末。schedule §2.1）。PR-L2-2、L2-3、PR-SEED は W3 のままとする。

| 順  | PR                             | 内容                                                 | 完了条件                                                  |
| --- | ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| 1   | PR-L2-2                        | 公開・販売系の 8 表（RELSCOPE のマージ後）           | 空の DB に順に適用できる。定員の CHECK がある             |
| 2   | PR-L2-3、PR-SEED               | 公開読取 API 6 本、初期データ（SEED のマージ後）     | 公開状態のものだけが返る                                  |
| 3   | PR-L2-1a / 1b / 1c             | Profile の参照・更新・作成、実 Neon の差異修正       | staging で 登録 → ログイン → `GET /api/v1/self/principal` |
| 4   | PR-GK-1〜3、PR-L1-1a / 1b / 1c | Goods / Karaoke の表、orders・決済・Ticket・通知の表 | **checkpoint 1: PR-L1-1a が W3 末に `dev` へ**            |

### 2.3 W4〜W6: 購入・決済・Ticket（クリティカルパス）

| 順  | PR            | 内容                                                                                                            | 完了条件                                                                                   |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | PR-L1-2a〜2e  | 購入の判定、在庫確保と注文作成、購入開始、注文参照・取消                                                        | **hot concurrency:** 定員を超えない。同一の Business Cause で重複しない                    |
| 2   | PR-L1-3a〜3d  | Stripe Checkout Session、Checkout Attempt、結果不明、`reconcileCheckoutAttempt()`                               | transaction の中で Stripe を呼ばない。結果不明で新しい key を作らない                      |
| 3   | PR-L1-4a〜4d  | Webhook 受信、**確定 transaction**（Order 確定 → Ticket 発行 → 通知 enqueue）、`reconcilePaymentConfirmation()` | 重複・順不同でも Ticket は 1 回分。署名不正は何も書かない。**M3: staging で決済 → Ticket** |
| 4   | PR-L1-5a〜5d  | QR 鍵、Ticket 参照、QR 表示、整合の読み出し                                                                     | DB に QR の平文がない。再読込みで token を作り直さない                                     |
| 5   | PR-L1-6a / 6b | 入場確認                                                                                                        | 同じ Ticket に並列でも成功は 1 回。権限確認が QR 評価より先                                |
| 6   | PR-L1-7a〜7d  | 全額返金、`refund.*` Webhook、`reconcileRefundResult()`                                                         | 二重返金なし。結果不明は read-only で照合。**checkpoint 2（W6 末）**                       |

担当2への受け渡し: `reconcile*` の引数・戻り値の型は PR-L1-3d のレビューで合意（合意前に担当2は L3-4 に入らない）。`releaseOrderResources()` の型は PR-L1-2e で合意。

### 2.4 W6〜W9: 管理 API と観測性

| 順  | PR                    | 内容                                                      | 完了条件                                                                                                 |
| --- | --------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | PR-L2-4a / 4b         | Role 管理                                                 | 最後の管理者の解除を 2 人が同時に試みても 1 人は残る                                                     |
| 2   | PR-L2-7a / 7b         | 注文・Ticket の管理参照                                   | 固定 query、未知の query は `400`                                                                        |
| 3   | PR-L2-5a〜5d、PR-L2-6 | 公開情報・販売設定の管理（AI 主導）                       | 楽観ロック（`expected_updated_at`）、Audit が同じ transaction。調整 C を発動した場合は担当2が API も担当 |
| 4   | PR-GK-4 / 5           | Goods・Karaoke の公開読取                                 | 販売停止（`SUSPENDED`）のまま                                                                            |
| 5   | L2-8                  | Rate Limit の仕上げ、観測性（#42・#44・#45 の結果を反映） | **#42・#44・#45 は Production promotion をブロック**（`SPEC-180 §17.2`、`INF-RLS-008`）                  |

### 2.5 W10〜W12: 検証

- G1〜G8・G10 を clean pass にする（最初の gating failure と修正後の clean run を記録）。
- staging 総合検証、セキュリティ確認、本番 promotion 判定（`SPEC-200 §39`）。G9 の Stripe 部分。

---

## 3. 担当2（フロントエンド + L3）の手順

### 3.1 W1〜W2: 環境とデプロイ CI（L3-8）

| 順  | 作業                                                                                                                                                                                                                                    | 完了条件                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Cloudflare Pages（staging / production、Direct Upload）、Railway（api、email-worker、reconciliation-worker、Redis）、Neon（staging）の枠を作る                                                                                          | staging にデプロイ可能                                                                                 |
| 2   | **#42〜#45 の外部事実の確認**（Railway ingress の forwarded header と `TRUSTED_PROXY_HOPS`、Redis の TLS・バージョン・`noeviction` / `maxmemory`）                                                                                      | **#42・#44・#45 は Production promotion をブロック**（#43 の TLS は非ブロッカー）。結果を Issue に記録 |
| 3   | デプロイ CI（`release-manifest.json`、migration 順序、Pages Direct Upload、artifact identity 検証）                                                                                                                                     | `SPEC-180 §45.1` の順序で staging に流せる                                                             |
| 4   | Cloudflare Access で staging と preview を保護（全到達経路を検証）。保護 header の実機確認（#31）                                                                                                                                       | 未ログインで全経路が遮断。production の公開ドメインは保護しない                                        |
| 5   | **Neon Auth の実機確認（ブラウザ側）**: 登録・ログイン・reset・Logout、Cookie、CSRF、Origin / CORS、Safari、4 認証方式。Issue #47〜#49                                                                                                  | 観測結果を記録。差異があれば担当1が UCR と中継の修正                                                   |
| 6   | **ZeptoMail staging の Agent を準備**し、Neon Auth の SMTP を設定（`neon neon-auth config email-provider update` または管理画面）。送信テスト                                                                                           | 確認メール・Email OTP・Magic Link が合成の受信先に届く（S-2）                                          |
| 7   | **S-0: Webhook の検証用受信先を準備**（業務 API とは別。使い捨ての HTTPS の受信口で、staging の Agent の Webhook にだけ登録する）。raw body と header を記録でき、個人情報を伏せて保存。公開インターネットから到達でき、HTTP 200 を返す | **Webhook の Verify（疎通確認）が 200 になる。** W2 末まで（S-5・S-6 の前提）                          |

### 3.2 W2〜W3: ZeptoMail の技術確認（M-SPK）

staging の Agent と**合成の宛先**だけを使う。**Webhook の spike（S-5・S-6）は、W2 に用意する検証用受信先（S-0）にだけ登録し、業務 API には登録しない**（業務 API の受信口は W6 以降。運営者の手順 §1.2 の 10a / 10b）。結果は spike の記録（日付、環境、確認した値の範囲。Secret と実在のアドレスは書かない）にまとめ、**W3 末（12/4）に担当1へ渡す。** 確認項目と合格基準は [mail-provider-zeptomail.md §4](mail-provider-zeptomail.md)（S-0〜S-9）。特に次の 3 点が判断を左右する。

1. **重複の抑止があるか**（同じ内容を 2 回送る。S-4）。
2. **Webhook の署名の仕組み**、Delivered event の payload、**鍵を入れ替えた直後の配信の署名**（S-5、S-6。M-6 の ② / ③ の判断材料）。
3. **Email logs API で `client_reference` / `request_id` を使って照会できるか**（公式資料に検索条件は明記。実環境の権限・遅延・結果の解釈を S-7 で確認）。

### 3.3 W2〜W6: Web の接続

| 順  | WP   | 内容                                                                                          | 完了条件                                                                            |
| --- | ---- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | W-2  | API client（Hono RPC の型共有）と Auth port を実 API / Neon Auth に接続（非 mock の factory） | staging で登録 → ログイン。**fail-closed を維持**                                   |
| 2   | W-3  | 公開ページを実 API へ（**PR-L2-3・PR-SEED のマージ後。W3。schedule §2.1 の案 A（決定）**）    | 公開ページが実データ                                                                |
| 3   | W-4  | 購入導線（Cart → Checkout → 購入状況）                                                        | **Checkout の戻りを確定として扱わず**、状態を権威として読む（`PAY-BRW-002`、`003`） |
| 4   | W-5  | マイページ（Order / Ticket / QR 表示）                                                        | E2E（mock と実 API 向け）                                                           |
| 5   | L3-3 | スケジューラ基盤（15 秒 tick、advisory lock、due 判定、last-success metric）                  | drain 中は新 batch を開始しない                                                     |

mock と real は環境変数で切り替えられる状態を維持し、`e2e-ui-mock` を残す。

### 3.4 W6〜W10: 通知・照合・管理画面・運用

| 順  | WP                                   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 完了条件                                                                                                                             |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **L3-1a**（PR-SPEC-MAIL のマージ後） | `packages/providers/zeptomail` の新設（現行 `resend` は 169 行。`Idempotency-Key` 前提を外した再設計）、`packages/providers/resend` の撤去、`EmailRequest.key`・`EmailLookup` の見直し（M-1 の決定に従う）、`packages/config` の環境変数置換（`ZEPTOMAIL_*`、Authentication Key、Logs API を使うなら OAuth の 3 値）、secret-scan・tooling・traceability（map 6 件 + manifest 2 件）の追随、`SPEC-120 §40` の表の草案（担当1が採番）。詳細は [mail-provider-zeptomail.md](mail-provider-zeptomail.md) §2.2〜2.3 | Provider の fault（timeout、5xx）を provider double で再現できる                                                                     |
| 2   | L3-1b                                | Email Worker（claim / lease 120 秒、リトライ、購入確認メール、`reconcileNotificationUnknownResult()`）                                                                                                                                                                                                                                                                                                                                                                                                          | Provider 呼出し中に DB transaction を開かない。`FOR UPDATE SKIP LOCKED`                                                              |
| 3   | L3-2                                 | Webhook 取込み（署名検証、dedupe）、通知の管理参照、`API-ADM-REC-006`                                                                                                                                                                                                                                                                                                                                                                                                                                           | raw body のまま署名を検証（URL decode するのは header の `s` だけ。S-6 の確認結果に従う）。同じ `webhook_request_id` を 1 回だけ処理 |
| 4   | W-6                                  | 管理画面（注文・Ticket・返金・公開情報・販売設定・Role・通知・Consistency Review）、スタッフ入場確認画面                                                                                                                                                                                                                                                                                                                                                                                                        | 管理者が操作できる（R5）。Capability に応じた表示                                                                                    |
| 5   | L3-4 / L3-5                          | 照合ジョブ（決済系、権利・整合系）                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | cadence を丸めない。advisory lock は最終防御ではない（担当1の repository 側が担保）                                                  |
| 6   | L3-6                                 | Consistency Review と Recovery の画面                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `recovery.exception.execute` を任意 SQL にしない                                                                                     |
| 7   | L3-7                                 | バックアップ（`backup-export`、R2、age 暗号化）、`audit-retention-purge`、`alert-canary`、restore リハーサル                                                                                                                                                                                                                                                                                                                                                                                                    | private identity を CI・Railway に置かない                                                                                           |
| 8   | W-7                                  | 実 API 向け E2E、Pages の本番設定、CSP・保護 header                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 該当 journey が通る                                                                                                                  |

調整 C（W3 末に PR-L1-1a が未マージなら L2-4・L2-5・L2-6 を担当2へ移す）の判定を、W3 末のチェックポイントで行う。

---

## 4. 結合・検証・リリース

### 4.1 staging での確認項目（M3 以降、W5〜W11）

1. 登録 → 確認メール（ZeptoMail SMTP）→ ログイン → `GET /api/v1/self/principal`。
2. Entry 購入 → Stripe（テストモード）決済 → Ticket / QR 発行 → 購入確認メール → 入場確認。
3. 全額返金（管理画面）→ 返金通知。
4. 管理画面: 注文、Ticket、公開情報、販売設定、Role、Consistency Review の操作。
5. 障害系: Webhook の重複・順不同、結果不明（Checkout、返金、通知）の照合、Hold 失効時の Allocation 解放、Worker の drain と crash 復旧。

### 4.2 品質ゲート

- **G1〜G8・G10:** merge と staging で必須 group が clean pass。**G9（Provider Contract Smoke）:** 非本番の Stripe と ZeptoMail の credential が使える時点で、保護された CI で実施。
- **Production promotion のブロッカー（`SPEC-180 §17.2`、`INF-RLS-008`）:** **#42・#44・#45**（Railway: forwarded header と `TRUSTED_PROXY_HOPS`、Redis の実バージョンと CI の Redis major の一致、`noeviction` / `maxmemory`）、**#48**（Neon Auth の provider-side 保護）、**#49**（Google OAuth callback の経路。全 4 認証方式の互換性 gate は Google を無効化しても省略できない）、Stripe の本番審査、法務表示。**#43（Redis の TLS）と #47（email の同値性）は非ブロッカーの追跡項目**（差分があれば正規化手順を拡張する）。
- 実行できない検証を成功として扱わない。

### 4.3 本番公開の手順（`SPEC-180 §45.2`。順序は固定）

| 順      | 作業                                                                                                                                                                                                                                                                                                                                                                                          | 主な担当                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1       | 同じ commit の staging の事前証跡を確認                                                                                                                                                                                                                                                                                                                                                       | 担当1                         |
| 2       | 本番 backup の新しさと復旧点を確認                                                                                                                                                                                                                                                                                                                                                            | 担当2                         |
| 3       | 本番の設定・Secret・環境 identity を dry validation                                                                                                                                                                                                                                                                                                                                           | 担当2                         |
| 4〜6    | migration lock を取得し、**expand-only の migration** を実行、schema readiness を確認                                                                                                                                                                                                                                                                                                         | 担当1（承認: 運営者）         |
| 7〜10   | Railway: API（同じ OCI digest）→ Email Worker → Reconciliation Worker。全 readiness が成功                                                                                                                                                                                                                                                                                                    | 担当2                         |
| 10 の後 | **`production-business` の Webhook を登録して確認する**（本番 URL `/api/v1/webhooks/<決定した path>`、購読 event、`api` にのみ配置した本番専用の Authentication Key）。Verify が 200 になることに加え、**本番の合成宛先へ送って署名検証済みの受信を確認する**（Verify 200 だけでは署名・event の処理を実証したことにならない。Delivered と Feedback loop は模擬送信ができず、実メールが要る） | 運営者（登録）・担当2（確認） |
| 11〜12  | 本番用 Web artifact を Access 保護の preview branch へ Direct Upload。静的配信・routing・header・Secret の非混入・output hash を検証                                                                                                                                                                                                                                                          | 担当2                         |
| 13      | **運営者の承認後**、検査済みの同一 output を production branch へ Direct Upload（deployment ID と hash を記録）                                                                                                                                                                                                                                                                               | 担当2                         |
| 14〜16  | post-deploy smoke、**観察 10 分**、Critical・High の alert・readiness 失敗・schema 不一致がなければ release accepted                                                                                                                                                                                                                                                                          | 担当1・担当2                  |
| 追加    | 少額の実決済と返金で疎通を確認（Stripe 本番）                                                                                                                                                                                                                                                                                                                                                 | 運営者・担当1                 |

- **Web を先に切り替えて新 API の契約だけを要求しない**（`INF-DEP-003`）。destructive な contract migration は同じ cutover に含めない（`INF-DEP-004`）。
- ロールバックは `SPEC-180 §48〜§51`。**Provider の副作用（Stripe の決済・返金、ZeptoMail の受理、入場確認）は「なかったこと」にしない。**現在の Provider の状態と照合する。

### 4.4 リリース可否チェックリスト

- [ ] 仕様 PR（RELSCOPE、SEED、IDM、MAIL）がマージ済み
- [ ] G1〜G8・G10 が clean pass、G9 が実施済み
- [ ] **#42・#44・#45・#48・#49** の外部事実を確認し、全 4 認証方式の互換性 gate を満たす（Production promotion の条件。#43・#47 は非ブロッカーの追跡項目）
- [ ] Stripe の本番審査が完了。ZeptoMail の本番 Agent・本番ドメインが Verified。Resend は撤去済みで、本番の設定に残っていない
- [ ] 業務キーと Neon Auth 用の SMTP が別の Agent
- [ ] **`production-business` の Webhook（本番 URL、購読 event、本番専用の Authentication Key）を登録し、Verify に加えて署名検証済みの受信を確認済み**（staging の登録では本番をカバーできない。§4.3）
- [ ] バックアップと restore リハーサルを実施
- [ ] 法務表示が公開できる状態
- [ ] 管理者の初期 Role の付与手順が確定（`SPEC-150 §20` の bootstrap）
- [ ] 本番 Secret が Sealed Variables にあり、リポジトリ・ログ・build 出力に実値がない（`secret-scan --require-build`）
- [ ] ロールバックの対象（Pages の deployment、Railway の digest）を識別できる

---

## 5. 記録するもの（運営者・担当2）

Secret でない識別子は、起動時の環境 identity 検証（`EXPECTED_*`）と運用の台帳に使う。**実値の台帳は保管庫に置き、リポジトリには書かない。**

| 項目                        | 内容                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ZeptoMail                   | Data Center、Agent 名と用途、送信ドメイン、DNS レコードの台帳（DKIM・CNAME）、認証完了日、審査の提出日・完了日、クレジットの購入日と期限 |
| Stripe                      | 環境ごとのアカウント、Webhook の endpoint、API バージョン、本番審査の提出日・完了日                                                      |
| ドメイン                    | ホスト名の一覧（Web、API / Auth、staging）、更新期限                                                                                     |
| Cloudflare / Railway / Neon | プロジェクト名と ID、Access の対象、保護の検証結果                                                                                       |
| 決定                        | D-2、D-3、R-7、M-1〜M-6 の決定日と選択                                                                                                   |

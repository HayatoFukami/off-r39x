# リリースに向けた全体スケジュール（v2）

- 作成日: 2026-11-17（v2。v1 は 2026-11-12 の「リリース計画ノート」）
- 位置づけ: **仕様ではない**（正式仕様は `docs/specs/`）。週ごとの作業、担当、依存、チェックポイントをまとめた作業文書。
- 関連: [手順書](release-runbook.md)、[メール Provider の変更（Resend → ZeptoMail）](mail-provider-zeptomail.md)
- 体制: **担当1 = バックエンド**、**担当2 = フロントエンド中心（Web、環境、Worker、通知、管理画面）**、**運営者 = プロジェクト所有者（外部申請、決定、承認）**。2 名 + AI エージェント（planner → tester → coder → reviewer）。
- 目標: **機能フリーズ 2027-01-23、本番公開 2027-02-08 の週。** 週は目安で、確定した見積りではない（§7）。

## v1 からの変更点

| # | 変更 | 影響 |
|---|---|---|
| 1 | **メール配信を Resend から Zoho ZeptoMail に変更**（2026-11-17 決定） | 仕様 PR を 1 本追加（PR-SPEC-MAIL、W5 末マージ目標）。技術確認 spike を W2〜W3 に追加。通知の Provider 依存部分（L3-1・L3-2）は W6 以降に着手。**調査結果では、二重送信防止の代替設計（M-1）が唯一の設計判断で、残りは Provider adapter の書き直し（169 行相当）と機械的な置換・追随。**外部申請に ZeptoMail の審査（2 営業日）を追加 |
| 2 | #41・#46 は **11/15 にマージ済み** | 基盤の PR は完了。S0-1（構成分割）が着手可能 |
| 3 | PR-S0-0c は取込みではなく**再実装**（実装ブランチが存在しない） | W1 の作業に含める |
| 4 | Goods / Karaoke は**簡易スコープ内**（2026-11-13 決定）。表は仕様どおり全部作り、公開読取と購入可否の照会だけ出す | 仕様 PR（RELSCOPE）が先行。PR-GK-1〜6 を追加 |
| 5 | 仕様 PR は 4 本（RELSCOPE、SEED、IDM、MAIL） | 優先順は §4 |

---

## 1. カレンダー

| 週 | 開始日 | 備考 |
|---|---|---|
| W1 | 11/16 | 今週。11/17 時点で稼働中 |
| W2 | 11/23 | 11/23 祝日 |
| W3 | 11/30 | |
| W4 | 12/7 | |
| W5 | 12/14 | |
| W6 | 12/21 | 12/25 を実質の最終日にする |
| W7 | 12/28 | 年末休止（実質半週） |
| W8 | 1/4 | |
| W9 | 1/11 | 1/12 祝日 |
| W10 | 1/18 | **機能フリーズ 1/23** |
| W11 | 1/25 | |
| W12 | 2/1 | |
| W13 | 2/8 | **本番公開（目標）** |

---

## 2. マイルストーン

| # | 時期 | 到達点 | 証拠 |
|---|---|---|---|
| M0 | W1 末（11/20） | 基盤の整理（#41 / #46 済み、PR-S0-0c）。外部申請の提出（ZeptoMail、Stripe、ドメイン） | PR の状態、申請の提出記録 |
| M1 | W2 末（11/27） | S0 完了（構成分割、共通ミドルウェア）、公開読取 API、公開ページが実 API。Neon Auth の確認メールが ZeptoMail SMTP で届く | `dev` の CI、staging |
| M-SPK | W3 末（12/4） | ZeptoMail の技術確認（S-1〜S-9）の記録。**M-1（結果不明の扱い）の判断材料がそろう** | spike の記録 |
| M2 / checkpoint 1 | W3 末（12/4） | 登録 → ログイン → `/self/principal` が staging で通る。PR-L1-1a（orders 系の表）が `dev` にマージ | 互換性結果、migration |
| M3 | W5 末（12/18） | **staging で Stripe テスト決済 → Ticket 発行。PR-SPEC-MAIL がマージ** | L1-4 の結合テスト、仕様のマージ |
| M4 / checkpoint 2 | W6 末（12/25） | Ticket / QR 表示、入場確認、全額返金。ZeptoMail adapter の新設 | hot concurrency の結果 |
| M5 / checkpoint 3 | W9 末（1/15） | 通知・照合・Consistency Review が結合。管理画面が操作できる | Reliability / Recovery suite |
| M6 | W10 末（1/23） | **機能フリーズ。** G1〜G8・G10 が clean pass | CI の最初の gating failure と修正後の clean run |
| M7 | W11〜W12 | staging 総合検証、G9（ZeptoMail・Stripe の非本番）、本番環境、migration 予行 | `release-manifest.json`、予行の記録 |
| M8 | W13（2/8 週） | 本番公開、release accepted | `SPEC-180 §45.2`、`SPEC-200 §40` |

---

## 3. 週次スケジュール

凡例: ★ 節目、⚠ 判断・外部待ち。PR の記号（PR-S0-2 など）は担当1の手順書での呼び名。WP（L1-2、L3-1 など）は作業計画書の呼び名。

| 週 | 運営者 | 担当1（バックエンド） | 担当2（フロントエンド + L3） | 節目 |
|---|---|---|---|---|
| **W1**<br>11/16 | ⚠ **ZeptoMail 申請**（アカウント作成、審査、Data Center の決定、Agent 4 つ）。Stripe 本番審査の申請。ドメイン取得、Cloudflare / Access。Google OAuth。**決定: D-2（RELSCOPE）、D-3（SEED、IDM）** | 作業ブランチを `origin/dev` に同期。**PR-S0-0c**（`55P03` の retry、405 / 415、文書更新）。仕様 PR の下書き（RELSCOPE を最優先）。PR-S0-2（DB の骨組み）、PR-S0-4（`audit_events`） | 環境の枠（Pages / Railway / Redis の staging、Neon の staging）。L3-8（デプロイ CI）に着手。#42〜#45 の確認。Neon Auth の実機確認（ブラウザ側）。ZeptoMail の **staging 用 Agent 2 つ**（業務 / Neon Auth）の準備 | M0 |
| **W2**<br>11/23 | ZeptoMail の審査結果、ドメインの DKIM + CNAME を DNS へ。⚠ **決定: R-7（受入の扱い）、SEED、IDM** | PR-S0-0c のマージ。**PR-S0-1a / 1b**（契約と route の分割）。PR-S0-3a〜3c（エラー、ページング、冪等性入力）。PR-S0-5（通知の型）。仕様 PR（RELSCOPE、SEED、IDM）の起票 | **ZeptoMail spike S-1〜S-2**（送信、Neon Auth の SMTP 設定）。W-2・W-3（API client と Auth port、公開ページを実 API へ）。L3-8 の続き | M1（11/27） |
| **W3**<br>11/30 | spike の確認（実機の合否を共有） | RELSCOPE のマージ後に **PR-L2-2**（8 表）、PR-GK-1、**PR-L1-1a**（orders 系）。PR-L2-3（公開読取）。PR-L2-1a / 1b（Profile）。PR-SEED | **spike S-3〜S-9**（`client_reference`、重複、Webhook、署名、Email logs、bounce、制限）。W-4（購入導線）。L3-3（スケジューラ基盤） | **M-SPK、M2（12/4）** |
| **W4**<br>12/7 | **決定: M-1（結果不明の扱い）、M-3、M-5、M-6** | PR-GK-2・3、PR-L1-1b・1c。**PR-L1-2a〜2e**（購入開始）。PR-L2-1c（実 Neon の差異）。**PR-SPEC-MAIL の起票**（spike の結果を反映） | W-5（マイページ）。管理画面の枠（W-6 開始）。spike の記録の整理、Stripe のテスト準備 | |
| **W5**<br>12/14 | PR-SPEC-MAIL のレビュー・承認 | **PR-L1-3a〜3d**（Stripe Checkout）、**PR-L1-4a〜4d**（Webhook、確定）。PR-SPEC-MAIL のレビュー対応・**マージ** | W-4・W-5 の接続。staging で決済 → Ticket の結合。管理画面（注文） | **M3（12/18）、PR-SPEC-MAIL** |
| **W6**<br>12/21 | Stripe 本番審査の状況確認 | PR-L1-5a〜5d（Ticket / QR）、PR-L1-6a・6b（入場確認）、PR-L1-7a〜7d（返金）。**M-RL**（class と path の改名） | **L3-1a**（ZeptoMail adapter、`SPEC-120 §40` の表の草案）。W-6（管理画面: 注文・返金・Ticket） | **M4（12/25）** |
| **W7**<br>12/28<br>半週 | （年末休止） | PR-L2-4（Role）、PR-L2-7（注文・Ticket の管理参照） | L3-1b（Email Worker）、L3-2（Webhook 取込み）。管理画面の続き | |
| **W8**<br>1/4 | 法務表示（特商法、規約、プライバシー）の確定 | PR-L2-5（公開情報管理）、PR-L2-6（販売設定）、PR-GK-4 | **L3-4・L3-5**（照合ジョブ）。スタッフ入場確認画面、Role 管理画面 | |
| **W9**<br>1/11 | | PR-GK-5、**L2-8**（Rate Limit の仕上げ、観測性、#42・#45 の反映） | L3-6（Consistency Review と画面）、残りの管理画面 | **M5（1/15）** |
| **W10**<br>1/18 | | **G1〜G8・G10 の消化**、不足テストの補充 | **L3-7**（バックアップ、restore）、実 API 向け E2E、Pages の本番設定、保護 header（#31） | **M6（1/23）** |
| **W11**<br>1/25 | Stripe 本番審査の完了確認。本番の ZeptoMail Agent・本番ドメインの確認 | staging 総合検証、セキュリティ確認。**G9 の Stripe 部分** | **G9 の ZeptoMail 部分**、staging 総合、本番環境構築、migration 予行 | M7 |
| **W12**<br>2/1 | 本番の Secret の投入承認 | 本番 promotion 判定（`SPEC-200 §39`）、approval | 本番の Secret（Railway Sealed Variables）、手順書、ロールバックの確認 | |
| **W13**<br>2/8 | **公開の承認** | 本番 migration、少額の実決済と返金の疎通 | 本番デプロイ、監視、観察 10 分 | **M8** |

> W4〜W5 は担当1の負荷が最も高い（購入・決済・仕様 PR の同時進行）。W7 は半週で、L3-1b・L3-2 は ZeptoMail の仕様確定後の実装になるため、**W5 末の PR-SPEC-MAIL が遅れると W6〜W8 の担当2が詰まる。**

---

## 4. 仕様 PR（実装より先にマージするもの）

`AGENTS.md §7`、`SPEC-000 §8` のとおり、仕様の変更は実装より先に Canonical Owner を改訂する。実装 PR に仕様の改訂を混ぜない。

| 順 | PR | 内容 | 決定者 | マージ目標 | 待たせる作業 |
|---|---|---|---|---|---|
| 1 | **PR-SPEC-RELSCOPE** | Goods / Karaoke を簡易スコープ内にする（出さない Operation の一覧、受入の扱い、Cart の `GOODS` 経路）。`UCR-RELSCOPE-001` | 運営者（R-1〜R-8、N-A、N-B） | **W1〜W2** | PR-L2-2 以降の Goods / Karaoke の表と API |
| 2 | **PR-SPEC-SEED** | Event・Entry Offering などの初期データの作り方 | 運営者 | W2〜W3 | PR-SEED、staging の公開ページ結合 |
| 3 | **PR-SPEC-IDM** | Transport Idempotency の replay 記録の保存先 | 運営者 | W2〜W3 | PR-S0-3d（`409 IDEMPOTENCY_KEY_REUSED`） |
| 4 | **PR-SPEC-MAIL** | メール Provider を ZeptoMail に変更。冪等性・照合・Webhook・設定・Secret の改訂 | 運営者（M-1〜M-6） | **W5 末（12/18）** | L3-1（W6）、M-RL |

---

## 5. 依存関係とクリティカルパス

```text
運営者: ドメイン ─┬─ ZeptoMail 審査・DNS ─ M-SPK(W2〜W3) ─ PR-SPEC-MAIL(W4〜W5) ─ L3-1a(W6) ─ L3-1b/L3-2(W7〜)
                 ├─ Stripe 審査 ───────────────────────────────────────────────────────── G9 / 本番(W11〜)
                 └─ Cloudflare / Google OAuth / Neon / Railway

担当1: PR-S0-0c ─ S0-1 ─ S0-3 ─ L2-2 ─ L1-1a ─ L1-2 ─ L1-3 ─ L1-4 ─┬─ L1-5 ─ L1-6
        PR-SPEC-RELSCOPE ──────┘                                    └─ L1-7
担当2: L3-8(環境・CI) ─ W-2/W-3 ─ W-4/W-5 ─ L3-1 ─ L3-2 ─ L3-4/L3-5 ─ L3-6 ─ L3-7
```

- **クリティカルパス:** 仕様 PR（RELSCOPE）→ PR-L2-2 → PR-L1-1a → L1-2 → L1-3 → L1-4 → L1-5。購入が確定して Ticket が発行できるまで（M3）が最重要。
- **ZeptoMail の経路:** 審査（2 営業日）と DNS 反映（24〜48 時間）が最初の待ち。**Neon Auth の確認メール（W2）に必要**なので、W1 に申請する。
- 担当1と担当2の受け渡し点: S0-5 の型（W2）、`reconcile*` の型（PR-L1-3d、W5）、`releaseOrderResources()` の型（PR-L1-2e、W4）、Email 関連の表の採番（L3-1a、W6）、共通ファイルの解禁（PR-S0-1b、W2）。

---

## 6. チェックポイント

| 時期 | 確認 | 未達の場合 |
|---|---|---|
| W3 末（12/4） | PR-L1-1a が `dev` にマージ済みか。Neon Auth の互換性結果が出たか。**ZeptoMail の spike が終わったか** | PR-L1-1a が未達なら調整 C（L2-4・L2-5・L2-6 を担当2へ）。Neon Auth に大きな差異があれば UCR を先に出す。spike が遅れたら M-1 の決定を W4 前半に延ばす |
| W5 末（12/18） | **PR-SPEC-MAIL がマージ済みか。** staging で決済 → Ticket が通るか | PR-SPEC-MAIL が未達なら L3-1 の Provider 依存部分だけを後ろ倒しし、公開日への影響を再評価（W11 の余白で吸収できるか） |
| W6 末（12/25） | L1-5（Ticket / QR）まで通っているか | L2-7・L2-8 を後ろ倒しし、公開時期を再計算して所有者へ報告 |
| W9 末（1/15） | L3-4 と L1-4 の結合（決済系の照合）が通っているか | L3-6 の範囲を絞る前に UCR の要否を確認。Recovery の機能を削る場合は仕様 PR |
| W10 末（1/23） | G1〜G8・G10 が clean pass か | フリーズを延ばすか、公開を見送るかを所有者が判断 |

**1 PR あたりの所要日数と往復回数**を W3 末に実測し、「レビューは 1〜2 往復」の前提から外れていれば PR の束ね方を見直す（手順書 N-12）。

---

## 7. リスク

| リスク | 影響 | 対応 |
|---|---|---|
| **ZeptoMail の冪等性・照会・Webhook が仕様の前提を満たさない**（本書 §1 の変更） | 通知の結果不明の扱い、仕様の大改訂 | W2〜W3 の spike で事実を確定。M-1 を推奨案 C で決める。**Webhook は補助情報であり、購入の確定根拠にしない** |
| ZeptoMail のアカウント審査・DNS 反映の待ち | Neon Auth の確認メール（W2）、G9 | W1 に申請。審査が通らない場合の代替手段を事前に決める（運営者） |
| ZeptoMail に日本の Data Center がない | 受信者情報の国外送信 | M-3 で地域を決め、プライバシーポリシーに反映（法務表示。W8） |
| 仕様 PR が 4 本重なり、担当1の W1〜W5 が重い | 実装の開始が遅れる | planner が下書きし、所有者が選択肢を決める形にする。優先順は §4 |
| PR のレビュー待ち | 全体の遅延 | レビューは 1〜2 往復を前提にし、範囲を広げない。スタック PR は 1 段まで |
| Neon Auth の実挙動が仕様と合わない | 認証全体 | W1 から実機確認。差異は UCR（#47〜#49） |
| Stripe の本番審査 | 本番決済 | W1 に申請。テストモードで実装は進める |
| #42・#45（Railway の外部事実） | Production promotion をブロック | 担当2が W1〜W2 の staging で確認 |
| 担当2の後半（L3・管理画面・スタッフ画面）が重い | W6〜W10 が詰まる | 管理画面の規模を W2 までに見積る。調整 C の発動条件を W3 末で判定 |
| Windows 手元で DB・Redis のテストを実行できない | CI と手元の差 | CI（Linux）を正とし、未実行の検証を PR に明記 |

## 8. 本書の限界

- 週は目安で、**13 週が保てるかは再計算していない。** 担当者名・週あたりの稼働時間は未確認。
- ZeptoMail に関する記述は公式ドキュメントの読取りで、**実機での確認は spike の後**に更新する。
- Goods / Karaoke の Cart 経路（RELSCOPE の N-A）の作業量は未見積り。

---
spec_id: SPEC-020
title: Functional Requirements
version: 1.1.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
related_specs:
  - SPEC-030
  - SPEC-040
  - SPEC-050
  - SPEC-060
  - SPEC-070
  - SPEC-080
  - SPEC-090
  - SPEC-100
  - SPEC-110
  - SPEC-120
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-190
  - SPEC-200
---

# 020 Functional Requirements

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形が、利用者および運用者へ提供しなければならない機能要件を定義する。

本書は `SPEC-010 System Overview` で確定したSystem Boundary、Actor、技術責務、System of Record、主要Data Flow、Security Principle、System Invariantを前提とし、それらを変更または弱化せず、実装・後続仕様・テストから一意に追跡できるRequirement IDへ具体化する。

本書はFunctional RequirementsのCanonical Ownerである。Domain Entityの完全な状態遷移、画面遷移、URL、DB物理設計、API Contract、Stripe Event別処理、QR Token形式、Karaoke hold時間、Role Permission Matrix等の詳細は、それぞれの後続Canonical Owner仕様へ委譲する。

## 2. 適用範囲

本書は以下の機能領域へ適用する。

- 公開イベントサイト
- アカウント・認証
- 入場チケット販売・購入後利用
- Karaoke予約販売・購入後利用
- Goods販売・会場受け渡し
- Cart・Entry TicketとGoodsの複合購入
- マイページ
- Administrator向け管理機能
- Staff向け受付機能
- Email通知
- 上記に共通する認証・認可・決済確定・所有権・整合性・障害時挙動

本書は、イベント開催日時、会場、価格、販売数量、契約条件等の外部事実そのものを決定しない。システムは確定した値を設定・保持・適用・表示できなければならない。

## 3. 前提・依存仕様

本書は以下へ依存する。

- `SPEC-000 Specification Governance`: 仕様書ガバナンス、Canonical Owner、依存関係、情報源優先順位、Upstream Change Requestの規則
- `SPEC-010 System Overview`: System Boundary、Actor、技術責務、System of Record、主要Data Flow、Security Principle、System Invariant

`off-r39x-2027_handoff.md` は、利用可能な場合に背景確認の参考資料として扱う。正式仕様と矛盾する内容は採用せず、本書のNormativeな根拠は `SPEC-000`、`SPEC-010` および本書で正式化したRequirementとする。

## 4. Canonical Terms

本書では `SPEC-010` のCanonical Termsを継承する。特に以下を維持する。

| Term | 本書での意味 |
|---|---|
| Guest | 認証されていない一般閲覧者 |
| Authenticated User | Supabase Authにより認証済みの利用者 |
| Customer | Order、Ticket、Reservation、Goods購入等の顧客関係を持つAuthenticated User。独立した権限Roleではない |
| Staff | 当日受付等の限定運用権限を持つ認証済み運用者 |
| Administrator | 管理機能および運用設定を扱う認証済み管理者 |
| Order | 決済対象となる購入取引の内部記録 |
| Entry Ticket | イベント会場への入場権を表す電子チケット |
| Karaoke Reservation | 特定のKaraoke利用枠を確保した予約 |
| Karaoke Ticket | Karaoke Reservationの当日受付に使用する電子チケット |
| Goods Order Item | 会場受け取りを基本とするGoods購入明細 |
| Check-in | 権利の有効性を確認し、利用済み状態へ移す受付処理 |
| Cart | Entry Ticket OfferingとGoodsの参照と数量だけをBrowserに一時保持する購入前の利用者補助機能。業務データでも販売確保でもない |
| 購入開始 | Authenticated Userの操作により、Server-sideで販売条件を再検証し、Business Databaseへ `PREPARED` Orderを永続化する業務操作。Cartへの追加・数量変更・削除は購入開始ではない |
| 複合Order | Entry Ticket Order ItemとGoods Order Itemの両方を含む1つのOrder。1回の外部決済へ対応する |
| Sponsor Logo | 協賛者の表示名、画像、任意のリンク先、表示順、公開状態を持つ公開情報 |
| Business Database | Supabase PostgreSQL上の業務データストア |

Karaokeの時間構造では、参加者が実際に利用できる時間を**利用時間**、次の利用に備える非販売利用区間を**整備時間**と呼ぶ。

## 5. Requirement記述規則

### 5.1 Requirement ID

各機能要件は次のCategory Prefixを持つ一意なIDで識別する。

| Prefix | Category |
|---|---|
| `FR-PUB` | 公開イベントサイト |
| `FR-AUTH` | アカウント・認証 |
| `FR-TKT` | 入場チケット |
| `FR-KRK` | Karaoke予約 |
| `FR-GDS` | Goods |
| `FR-CRT` | Cart・複合購入 |
| `FR-MYP` | マイページ |
| `FR-ADM` | Administrator機能 |
| `FR-STF` | Staff受付 |
| `FR-EML` | Email通知 |
| `FR-XFN` | Cross-functional |

### 5.2 検証可能性

各Requirementは、ActorまたはTrigger、必要なSystem behavior、重要なPrecondition、成功時のObservable Result、必要なFailure behaviorまたは禁止事項のうち、当該要件の検証に必要な要素を含む。

後続仕様とテストはRequirement IDを参照しなければならない。同一Requirementを別IDへ複製してはならない。

## 6. Actor別Capability境界

| Actor | 可能でなければならないこと | 許可してはならないこと |
|---|---|---|
| Guest | 公開情報、販売案内、販売可否・空き状況の公開範囲を閲覧し、登録・ログイン・パスワード再設定を開始する | 認証必須購入、マイページ、自己所有業務データ、Admin操作、Staff受付操作を実行する |
| Authenticated User | Profile管理、購入開始、自身のOrder・Ticket・Reservation・Goods情報参照を行う | 他者所有データへ識別子のみでアクセスする、Admin/Staff権限を自己申告する |
| Customer | Authenticated Userとして、自身の購入済み権利・購入履歴・受け渡し情報を利用する | Customerであることを独立Roleとして高権限操作へ利用する |
| Staff | 認可された受付対象についてQR検証・Check-in・結果確認を行う | Administrator専用運用設定や無関係な顧客データ管理を、Staffであることだけを根拠に行う |
| Administrator | 認可された管理領域で販売・注文・Ticket・Karaoke・Goods・運用設定を管理する | Browser表示だけを根拠に認可を成立させる、System Invariantを破る操作を強制確定する |

Role Permission Matrix、Role細分化、Session詳細は `SPEC-060`、Admin/Staff個別操作の詳細は `SPEC-130` がCanonical Ownerである。

## 7. 公開イベントサイト Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-PUB-001 | Guestを含む利用者は、認証なしでイベント名称、概要、主催側が公開対象とした基本情報を閲覧できなければならない。 |
| FR-PUB-002 | システムは、運営側が設定したイベント開催日時を公開情報として表示できなければならず、未設定値を推測して表示してはならない。 |
| FR-PUB-003 | システムは、運営側が設定した会場名称、会場案内およびアクセス情報を公開できなければならない。 |
| FR-PUB-004 | システムは、運営側が設定した参加上の注意事項を公開し、公開内容の変更を反映できなければならない。 |
| FR-PUB-005 | システムは、FAQの質問と回答を複数件公開し、運営側の変更を反映できなければならない。 |
| FR-PUB-006 | システムは、お知らせを複数件公開し、利用者が公開対象のお知らせを識別して閲覧できなければならない。 |
| FR-PUB-007 | 利用者は、Entry Ticketの種別、販売状態、販売期間、価格その他購入判断に必要な公開情報を閲覧できなければならない。 |
| FR-PUB-008 | 利用者は、Karaokeの販売案内、対象日、利用単位、価格その他予約判断に必要な公開情報を閲覧できなければならない。 |
| FR-PUB-009 | 利用者は、Goodsの名称、販売状態、価格その他購入判断に必要な公開情報を閲覧できなければならない。 |
| FR-PUB-010 | システムは、販売開始前、販売中、販売終了、販売停止、在庫または販売可能数不足等の公開上区別すべき状態を、利用者が購入可否を判断できる形で表現できなければならない。状態名称のCanonical定義は後続Domain仕様へ委譲する。 |
| FR-PUB-011 | 公開情報のうち開催日時、会場、注意事項、FAQ、お知らせ、協賛ロゴ、販売案内等の運営変更対象情報は、コード変更を前提とせず業務データまたは運用設定として更新可能でなければならない。 |
| FR-PUB-012 | 公開画面は、認証が必要な操作をGuestが開始した場合、認証が必要であることを識別できる結果を返し、未認証のまま業務操作を成立させてはならない。 |
| FR-PUB-013 | 公開情報の取得に一時的な障害がある場合、システムは取得失敗を成功データとして偽装せず、利用者が正常取得できていないことを識別できなければならない。 |
| FR-PUB-014 | 公開サイトから、Account、Entry Ticket、Karaoke、Goodsの各利用領域へ到達可能なNavigationを提供しなければならない。詳細なURL・画面構成は `SPEC-050` が定義する。 |
| FR-PUB-015 | システムは、運営側が公開対象とした協賛ロゴを公開画面へ表示できなければならない。公開対象でない協賛ロゴを表示してはならず、公開対象が0件の場合は協賛ロゴ表示領域を表示しなくてよい。協賛ロゴの取得失敗は他の公開情報の表示を妨げてはならない。 |

## 8. アカウント・認証 Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-AUTH-001 | Guestは、Supabase Authを利用する新規Account登録を開始できなければならない。 |
| FR-AUTH-002 | システムは、登録されたIdentityについて、Supabase Authが提供するメール確認フローを完了できなければならない。 |
| FR-AUTH-003 | メール確認が要求される認証状態では、確認未完了のIdentityを確認済みとして扱ってはならない。具体的なSession・Access可否は `SPEC-060` が定義する。 |
| FR-AUTH-004 | 登録済み利用者は、正しいCredentialでログインしAuthenticated UserとしてSessionを取得できなければならない。 |
| FR-AUTH-005 | 認証失敗時、システムは業務操作を認証済みとして継続させず、ログインが成立していない結果を返さなければならない。 |
| FR-AUTH-006 | Authenticated Userは、現在のSessionからログアウトできなければならない。 |
| FR-AUTH-007 | Guestまたはログイン不能な利用者は、登録済みIdentityに対するパスワード再設定フローを開始できなければならない。 |
| FR-AUTH-008 | パスワード再設定の認証基盤処理はSupabase Authへ委譲し、Business DatabaseにPassword Credentialを保存してはならない。 |
| FR-AUTH-009 | システムは、認証が必要なAPI操作ごとにSupabase Authの認証IdentityをServer-sideで確認し、Browserが申告したuser IDだけで本人性を確定してはならない。 |
| FR-AUTH-010 | Authenticated Userは、自身の業務プロフィールを参照できなければならない。 |
| FR-AUTH-011 | Authenticated Userは、運営上更新可能と定義された自身のプロフィール項目を更新できなければならない。具体的なFieldは `SPEC-030` / `SPEC-050` が定義する。 |
| FR-AUTH-012 | プロフィール更新時、システムは更新対象が認証Identityに対応する本人のプロフィールであることをServer-sideで検証しなければならない。 |
| FR-AUTH-013 | Customer分類はOrder、Ticket、Reservation、Goods購入等の業務関係から導出されなければならず、独立した高権限Roleとして利用してはならない。 |
| FR-AUTH-014 | 認証Serviceが一時的に利用不能な場合、認証必須操作を未検証のまま成立させてはならず、既存の確定済み業務データを削除または取消してはならない。 |

## 9. 入場チケット Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-TKT-001 | GuestおよびAuthenticated Userは、公開対象のEntry Ticket販売情報を閲覧できなければならない。 |
| FR-TKT-002 | システムは、Entry Ticket種別ごとに運営側が設定した価格、販売期間、販売状態、販売数量または在庫、1 Accountあたりの購入制限等を購入可否判定へ適用できなければならない。 |
| FR-TKT-003 | Entry Ticket購入はAuthenticated Userだけが開始できなければならない。 |
| FR-TKT-004 | 購入開始時、APIはClientから渡された価格を決済金額の権威ある値として使用せず、Business Database上の販売条件から購入条件を決定しなければならない。 |
| FR-TKT-005 | 購入開始時、システムは販売期間、販売状態、販売可能数量、購入制限その他必要なBusiness RuleをServer-sideで再検証しなければならない。 |
| FR-TKT-006 | 販売終了、販売停止、売り切れまたは購入制限超過の場合、システムは新規購入を成立させず、その購入が開始できない結果を返さなければならない。 |
| FR-TKT-007 | Stripe Checkoutへ遷移する前に、システムは購入試行を追跡可能なOrderをBusiness Databaseへ永続化しなければならない。 |
| FR-TKT-008 | Orderは認証済み購入者と購入対象を後から照合できる関係を保持しなければならない。具体的なEntity・Fieldは `SPEC-030` / `SPEC-100` が定義する。 |
| FR-TKT-009 | Order永続化後、APIはStripe Checkoutを開始するために必要なCheckout Sessionを生成できなければならない。Stripe詳細は `SPEC-070` が定義する。 |
| FR-TKT-010 | Checkout Sessionの作成に失敗した場合、システムは未追跡の購入として破棄せず、失敗または未完了の購入試行を後続の照合・再試行設計で扱える内部記録を維持しなければならない。 |
| FR-TKT-011 | BrowserがStripe CheckoutのSuccess redirectへ到達しただけでは、Orderを支払確定してはならない。 |
| FR-TKT-012 | Entry Ticket購入の支払確定は、署名検証済みStripe Webhookを根拠としてHono APIが処理しなければならない。 |
| FR-TKT-013 | 同一支払に対するWebhook再送または処理retryが発生しても、同一Orderを論理的に一度だけ支払確定しなければならない。 |
| FR-TKT-014 | 支払確定時、購入数量に対応する正規のEntry Ticketを発行しなければならない。 |
| FR-TKT-015 | 同一の購入権利について、Webhook再送やretryを原因とする重複Entry Ticketを発行してはならない。 |
| FR-TKT-016 | Orderの支払確定と必須Entry Ticket発行は、中途半端な確定状態を通常結果として残さない一貫した業務更新として成立しなければならない。Transaction詳細は `SPEC-070` / `SPEC-100` が定義する。 |
| FR-TKT-017 | 決済が未完了または失敗した購入試行について、システムは支払済みEntry Ticketを利用者へ提示してはならない。 |
| FR-TKT-018 | Webhook反映待ちの間、購入完了画面またはマイページはBrowser redirectだけを根拠に支払済みと断定せず、確定状態をBusiness Databaseから取得できなければならない。 |
| FR-TKT-019 | Customerは、自身の確定済みEntry Ticketをマイページから閲覧できなければならない。 |
| FR-TKT-020 | Customerは、自身のEntry Ticketに対応するEntry QRを表示できなければならない。QR詳細は `SPEC-080` が定義する。 |
| FR-TKT-021 | Customerは、自身のEntry Ticket購入に対応するOrder履歴および注文詳細を確認できなければならない。 |
| FR-TKT-022 | Customerは、Stripeが提供する領収書情報へ到達するための導線を確認できなければならない。 |
| FR-TKT-023 | システムは、他者のEntry TicketまたはOrderを、利用者が識別子を知っていることだけを根拠に返してはならない。 |
| FR-TKT-024 | Entry Ticketの取消・返金等が後続仕様で成立した場合、利用者・Staff・Administratorが参照する有効性はBusiness Databaseの現在状態に従わなければならない。詳細な返金・状態遷移は `SPEC-070` / `SPEC-080` が定義する。 |
| FR-TKT-025 | 販売数量に上限があるEntry Ticketについて、並行購入・retryを含め、確定済み販売数量が運営側の有効な販売上限を超えて成立してはならない。具体的な確保・競合制御方式は `SPEC-030` / `SPEC-070` / `SPEC-100` が定義する。 |
| FR-TKT-026 | 1 Accountあたりの購入制限が設定されている場合、並行購入・retryを含め、同一Authenticated Userが制限を超える購入権利を確定できてはならない。具体的な計数Ruleは `SPEC-030` / `SPEC-070` が定義する。 |

## 10. Karaoke予約 Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-KRK-001 | GuestおよびAuthenticated Userは、公開対象のKaraoke販売案内を閲覧できなければならない。 |
| FR-KRK-002 | 利用者は、運営側が販売対象として設定した日付単位でKaraokeの予約可能性を確認できなければならない。 |
| FR-KRK-003 | 利用者は、選択した日付について1時間単位で空き状況を把握できなければならない。1時間表示の具体的な集約UIは `SPEC-050` が定義する。 |
| FR-KRK-004 | 利用者は、空き状況から具体的なKaraoke利用Slotを選択できなければならない。 |
| FR-KRK-005 | システムは、Karaoke Slotについて利用時間と整備時間を区別して扱えなければならない。 |
| FR-KRK-006 | システムは、標準サイクルとして「利用15分 + 整備5分」のKaraoke Slotを生成・販売運用できなければならない。例外的な構成可否と状態モデルは `SPEC-030` / `SPEC-090` が定義する。 |
| FR-KRK-007 | システムは、Karaokeの価格、販売期間、販売状態、購入制限その他運営側が設定する販売条件を購入可否判定へ適用できなければならない。 |
| FR-KRK-008 | Karaoke購入はAuthenticated Userだけが開始できなければならない。 |
| FR-KRK-009 | 購入開始時、APIは選択Slotがその時点で購入可能であることをServer-sideで再検証しなければならない。 |
| FR-KRK-010 | 購入開始時、システムは選択Slotを一時確保し、同じ排他的Slotを別Customerへ同時販売できない状態にしなければならない。 |
| FR-KRK-011 | 一時確保中のSlotは、他の購入者に販売可能な空きSlotとして扱ってはならない。 |
| FR-KRK-012 | 同一Slotに対する同時購入要求が競合した場合、システムは最大1件だけを排他的確保へ進め、残りの要求に当該Slotを取得できなかった結果を返さなければならない。具体的な競合制御は `SPEC-090` / `SPEC-100` が定義する。 |
| FR-KRK-013 | Karaoke購入についてもStripe Checkoutへ遷移する前に追跡可能なOrderをBusiness Databaseへ永続化しなければならない。 |
| FR-KRK-014 | Karaoke購入の決済金額はClient値ではなく、Business Database上の販売条件と選択対象からAPIが決定しなければならない。 |
| FR-KRK-015 | Orderおよび一時確保成立後、システムはStripe Checkoutを開始できなければならない。 |
| FR-KRK-016 | Checkout離脱、支払未完了、Checkout期限切れその他一時確保を継続すべきでない条件が成立した場合、システムは対象Slotを再販売可能な状態へ戻せなければならない。具体的なhold期限と解放条件は `SPEC-090` / `SPEC-070` が定義する。 |
| FR-KRK-017 | Karaoke購入の支払確定は、Browser redirectではなく署名検証済みStripe Webhookを根拠に行わなければならない。 |
| FR-KRK-018 | 支払確定時、システムは対象Karaoke Reservationを購入者へ帰属する確定予約として成立させなければならない。 |
| FR-KRK-019 | 支払確定時、システムは対象Slotを同じCustomerのReservationへ対応する販売済み状態として確定しなければならない。 |
| FR-KRK-020 | 同一支払のWebhook再送またはretryによって、同じKaraoke Reservationを重複確定してはならない。 |
| FR-KRK-021 | 排他的な同一Karaoke Slotを複数Customerへ販売済みとして確定してはならない。 |
| FR-KRK-022 | 支払確定したKaraoke Reservationに対して、当日受付用のKaraoke Ticketを発行しなければならない。 |
| FR-KRK-023 | 同一Reservationについて、Webhook再送またはretryを原因とする重複Karaoke Ticketを発行してはならない。 |
| FR-KRK-024 | Customerは、自身のKaraoke Reservationの対象日時、現在状態および利用判断に必要な情報を確認できなければならない。 |
| FR-KRK-025 | Customerは、自身のKaraoke TicketおよびKaraoke QRを表示できなければならない。 |
| FR-KRK-026 | Entry QRとKaraoke QRは別の権利として扱い、一方を他方の受付に使用できてはならない。 |
| FR-KRK-027 | Karaokeの決済が未完了またはWebhook反映待ちである場合、システムはBrowser redirectだけを根拠に確定Reservationまたは有効Karaoke Ticketとして表示してはならない。 |
| FR-KRK-028 | Administratorは、Karaoke Slotを運用単位で一括生成できなければならない。具体的な生成パラメータ・画面操作は `SPEC-090` / `SPEC-130` が定義する。 |
| FR-KRK-029 | Administratorは、既存Karaoke Slotの販売可否や運用上変更可能な属性を編集できなければならない。ただし既存購入権利を不整合にする変更を無制限に許可してはならない。詳細なBusiness Ruleは `SPEC-030` / `SPEC-090` が定義する。 |
| FR-KRK-030 | Administratorは、Karaoke Slotの販売を停止し、新規購入対象から除外できなければならない。 |
| FR-KRK-031 | Administratorは、Karaoke Reservationを検索・確認し、購入者、対象Slot、支払・Ticket発行・受付に必要な運用情報を確認できなければならない。 |
| FR-KRK-032 | Karaoke外部運用上の例外受付が必要となる場合、システムは後続仕様で認可された例外Capabilityを追加可能な境界を持たなければならないが、通常のStaff操作だけでSystem Invariantを回避できてはならない。 |

## 11. Goods Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-GDS-001 | GuestおよびAuthenticated Userは、公開対象のGoods一覧を閲覧できなければならない。 |
| FR-GDS-002 | Goods一覧は、商品名称、価格、販売状態その他購入判断に必要な公開情報を表示できなければならない。 |
| FR-GDS-003 | Goodsの事前購入はAuthenticated Userだけが開始できなければならない。 |
| FR-GDS-004 | システムは、Goodsごとに運営側が設定した価格、販売期間、販売状態、在庫その他販売条件を購入可否判定へ適用できなければならない。 |
| FR-GDS-005 | Goods購入開始時、APIはClientから受け取った価格・在庫申告を信頼せず、Business Database上の販売条件と在庫から購入可否と金額を決定しなければならない。 |
| FR-GDS-006 | 売り切れ、販売停止、販売期間外または購入条件を満たさないGoodsについて、新規購入を成立させてはならない。 |
| FR-GDS-007 | Goods購入について、Stripe Checkoutへ遷移する前に追跡可能なOrderをBusiness Databaseへ永続化しなければならない。 |
| FR-GDS-008 | Goods購入はStripe Checkoutを利用できなければならず、本システムはカード情報を保持してはならない。 |
| FR-GDS-009 | Goods購入の支払確定は、Browser redirectではなく署名検証済みStripe Webhookを根拠に行わなければならない。 |
| FR-GDS-010 | 同一支払のWebhook再送またはretryによって、同じGoods購入を重複確定してはならない。 |
| FR-GDS-011 | 在庫制約があるGoodsについて、同一在庫を確定済み販売として過剰に割り当ててはならない。具体的な在庫競合制御は `SPEC-030` / `SPEC-100` が定義する。 |
| FR-GDS-012 | Customerは、自身のGoods購入履歴と購入明細を確認できなければならない。 |
| FR-GDS-013 | Goodsの標準履行方式は会場受け取りとし、Customerは会場受け取りに必要な購入・受け渡し情報を確認できなければならない。 |
| FR-GDS-014 | StaffまたはAdministratorのうち後続仕様で認可されたActorは、Goods Order Itemの会場受け渡し状態を確認・更新できなければならない。 |
| FR-GDS-015 | 同一Goods Order Itemについて、既に完了した受け渡しを通常操作で重複完了として成立させてはならない。 |
| FR-GDS-016 | 配送先住所管理、配送業者連携、配送追跡等の配送物流を標準必須機能として要求しない。 |
| FR-GDS-017 | 在庫に上限があるGoodsについて、並行購入・retryを含め、確定済み販売数量が販売可能在庫を超えて成立してはならない。購入中の在庫確保を含む具体的な競合・解放方式は `SPEC-030` / `SPEC-070` / `SPEC-100` が定義する。 |

## 11A. Cart・複合購入 Functional Requirements

Entry TicketとGoodsは、Cartを経由して1回の外部決済へまとめて購入できる。Karaokeは排他的な時間枠と支払前Holdの制約が異なるため、Cartへ入れず、Slotごとに独立して購入する。

| Requirement ID | Functional Requirement |
|---|---|
| FR-CRT-001 | GuestおよびAuthenticated Userは、公開対象のEntry Ticket OfferingとGoodsをCartへ追加し、Cart内の数量変更・削除・内容確認ができなければならない。これらの操作は購入開始ではなく、Order、Allocation、Hold、Inventory変更を発生させてはならない。 |
| FR-CRT-002 | Karaoke SlotをCartへ追加できてはならない。Karaokeの購入開始はSlotごとに独立して行い、1 Orderは1つのKaraoke Slotだけを対象とする。 |
| FR-CRT-003 | Cartは、対象の参照と数量だけを保持しなければならない。価格、金額、通貨、在庫、販売可否、支払結果、Owner、Role、個人情報、Secretを保持してはならず、保持値を権威値として採用してはならない。 |
| FR-CRT-004 | CartはBrowser側の購入前補助であり、Business Databaseへ保存してはならない。Cartへの追加は容量、在庫、Slotを確保せず、他の利用者の購入可否に影響してはならない。 |
| FR-CRT-005 | Cart表示は、各Itemの現在の価格と販売状態をServer-sideの現在値から表示し、販売開始前、販売終了、販売停止、売り切れ、数量不足、Purchase Limit超過等の購入不可理由をItem単位で識別できなければならない。取得に失敗したItemを購入可能として表示してはならない。 |
| FR-CRT-006 | Cartからの購入開始はAuthenticated Userだけが実行できなければならない。GuestがCartから購入開始を選んだ場合、認証が必要であることを識別できる結果を返し、認証後もCart内容を保持して再開できなければならない。 |
| FR-CRT-007 | Cartからの購入開始では、APIはCart内の全Itemについて販売期間、販売状態、容量または在庫、Purchase Limit、価格をServer-sideで再検証し、1件でも成立しない場合は、Orderを作成せず、Allocationを確保した状態を残してはならない。成功した場合は全Itemを同一の購入開始として成立させなければならない。 |
| FR-CRT-008 | Cart内のItemの種類に応じて、システムはEntry Ticketだけ、Goodsだけ、またはEntry TicketとGoodsの両方を含む単一のOrderを作成し、単一の外部決済へ対応させなければならない。Order Purposeの決定はServer-sideで行い、Clientが指定してはならない。 |
| FR-CRT-009 | 複合Orderの支払確定では、含まれるEntry Ticketの発行とAllocation確定、およびGoodsのAllocation確定と履行可能化を、中途半端な確定状態を残さない一貫した業務更新として成立させなければならない。いずれかが成立しない場合は、Orderを通常の `CONFIRMED` として扱ってはならない。 |
| FR-CRT-010 | 複合Orderが支払前に取消、失効または支払不成立となった場合、当該Orderに属する全てのAllocationを同一Order内で一貫して解放しなければならない。 |
| FR-CRT-011 | 購入開始が成功しOrderが作成された時点で、当該Orderに含めたItemをCartから除去できなければならない。購入開始失敗時は、Cart内容を失わず利用者が内容を見直せなければならない。 |
| FR-CRT-012 | Cart内容は特定のAccountの所有権や権利を発生させてはならない。LoginまたはLogoutによって他者のCart内容や購入済み権利が表示されてはならない。 |

## 12. マイページ Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-MYP-001 | Authenticated Userだけがマイページを利用できなければならない。 |
| FR-MYP-002 | マイページは、認証Identityに帰属する業務情報だけを取得・表示しなければならない。 |
| FR-MYP-003 | Customerは、自身が保有するEntry Ticketを一覧または同等の方法で確認できなければならない。 |
| FR-MYP-004 | Customerは、自身の有効なEntry QRを表示できなければならない。 |
| FR-MYP-005 | Customerは、自身のKaraoke Reservationを確認できなければならない。 |
| FR-MYP-006 | Customerは、自身のKaraoke TicketおよびKaraoke QRを表示できなければならない。 |
| FR-MYP-007 | Authenticated Userは、自身のOrder履歴を確認できなければならない。 |
| FR-MYP-008 | Authenticated Userは、自身のOrder詳細として、購入対象、支払状態、購入後権利との関連を確認できなければならない。具体的な表示Fieldは `SPEC-050` が定義する。 |
| FR-MYP-009 | Customerは、自身のGoods購入内容と会場受け渡し状態を確認できなければならない。 |
| FR-MYP-010 | Customerは、自身の対象OrderからStripe領収書情報へ到達する導線を確認できなければならない。 |
| FR-MYP-011 | Authenticated Userは、自身のプロフィールを参照し、更新可能項目を更新できなければならない。 |
| FR-MYP-012 | 利用者が他者のOrder、Ticket、Reservation、Goods購入、Profileの識別子を指定しても、所有権が確認できない情報をマイページ経由で返してはならない。 |

## 13. Administrator Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-ADM-001 | Administrator向け機能は認証済みかつServer-sideで管理権限を認可されたActorだけが実行できなければならない。 |
| FR-ADM-002 | AdministratorはOrder一覧を参照できなければならない。 |
| FR-ADM-003 | AdministratorはOrder詳細を参照し、購入者、購入対象、内部Order状態、Stripe関連識別情報、支払反映状況、関連Ticket・Reservation・Goodsの成立状況を運用確認できなければならない。 |
| FR-ADM-004 | Administratorは、Orderを運用上必要な条件で検索・Filterできなければならない。具体的なFilter項目は `SPEC-130` が定義する。 |
| FR-ADM-005 | Administratorは、購入者をOrder、Ticket、Reservation、Goods購入等の業務記録から確認できなければならない。 |
| FR-ADM-006 | Administratorは、支払状態とBusiness Databaseへの反映状態を確認できなければならない。Stripeの詳細なEvent処理は `SPEC-070` が定義する。 |
| FR-ADM-007 | Administratorは、Entry Ticketの発行状態と現在の利用状態を確認できなければならない。 |
| FR-ADM-008 | Administratorは、Entry Ticketを運用上必要な条件で検索・確認できなければならない。 |
| FR-ADM-009 | Administratorは、Karaoke Slotを一覧・検索・確認できなければならない。 |
| FR-ADM-010 | Administratorは、Karaoke Slotを一括生成できなければならない。 |
| FR-ADM-011 | Administratorは、Karaoke Slotの運用上変更可能な属性を編集できなければならない。 |
| FR-ADM-012 | Administratorは、Karaoke Slotを新規販売停止または再開可能な状態へ変更できなければならない。ただし既存Reservationの権利を暗黙に消滅させてはならない。 |
| FR-ADM-013 | Administratorは、Karaoke Reservationを一覧・検索・確認できなければならない。 |
| FR-ADM-014 | Administratorは、販売対象Entry Ticketの価格、販売期間、販売数量、購入制限等、後続仕様で運用変更可能と定義された販売条件を管理できなければならない。 |
| FR-ADM-015 | Administratorは、Karaokeの価格、販売期間、購入制限その他運用変更可能な販売条件を管理できなければならない。 |
| FR-ADM-016 | Administratorは、Goodsの公開情報、価格、販売状態およびInventoryを管理できなければならない。 |
| FR-ADM-017 | Administratorは、Goodsの会場受け渡し状況を確認し、後続仕様で認可された運用更新を実行できなければならない。 |
| FR-ADM-018 | Administratorは、イベント開催日時、会場情報、注意事項、FAQ、お知らせ、協賛ロゴ等、運営側が決定する公開情報を変更できるCapabilityを持たなければならない。具体的な管理対象と画面は `SPEC-130` が定義する。 |
| FR-ADM-019 | Administrator操作は、Clientから送信されたRole申告やUI表示状態だけを根拠に許可してはならない。 |
| FR-ADM-020 | Administratorの操作要求が現在のBusiness RuleまたはSystem Invariantに違反する場合、システムは通常の管理操作として確定させてはならない。例外操作が必要な場合は `SPEC-060` / `SPEC-130` で個別に認可・定義する。 |
| FR-ADM-021 | Administratorは、外部Service障害や非同期反映待ちにより確認が必要なOrder・通知等を、後続のReliability/Observability仕様で追跡可能な形で識別できなければならない。 |
| FR-ADM-022 | Administratorが実行する重要な管理操作は、後続の監査仕様でActor、対象、結果を追跡できるイベントとして記録可能でなければならない。具体的なAudit schemaは `SPEC-160` が定義する。 |

## 14. Staff受付 Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-STF-001 | Staff受付機能は、認証済みかつServer-sideで受付権限を認可されたActorだけが実行できなければならない。 |
| FR-STF-002 | Staffは、Staff UIからEntry QRを読み取り、Hono APIへ検証要求を送信できなければならない。 |
| FR-STF-003 | Entry QR検証時、システムは対応するEntry Ticketの存在、有効性、利用可否をBusiness Databaseの現在状態に基づいて判定しなければならない。 |
| FR-STF-004 | 有効なEntry Ticketの受付では、システムはEntry Check-inを一度だけ成立させ、Staffへ成功結果を返さなければならない。 |
| FR-STF-005 | 無効、取消済み、利用対象外その他受付不能なEntry QRでは、Check-inを成立させず、その権利を受付できない結果をStaffへ返さなければならない。 |
| FR-STF-006 | 既にCheck-in済みのEntry QRでは、二回目のEntry Check-inを成立させず、使用済みであることを識別できる結果を返さなければならない。 |
| FR-STF-007 | 並行Scanまたはretryが発生しても、同一Entry Ticketの一回限りCheck-inを複数回成立させてはならない。 |
| FR-STF-008 | Staffは、Staff UIからKaraoke QRを読み取り、Hono APIへ検証要求を送信できなければならない。 |
| FR-STF-009 | Karaoke QR検証時、システムは対応するKaraoke TicketおよびReservationの存在、状態、予約日時その他受付判断に必要な情報をBusiness Databaseから確認しなければならない。 |
| FR-STF-010 | 有効なKaraoke Ticketの受付では、システムはKaraoke Check-inを一度だけ成立させ、Reservation日時と受付結果をStaffへ返さなければならない。 |
| FR-STF-011 | 無効、取消済み、受付対象外その他受付不能なKaraoke QRでは、Karaoke Check-inを成立させず、その理由をStaffが区別できる結果を返さなければならない。 |
| FR-STF-012 | 既にCheck-in済みのKaraoke QRでは、二回目のKaraoke Check-inを成立させず、使用済みであることを識別できる結果を返さなければならない。 |
| FR-STF-013 | 並行Scanまたはretryが発生しても、同一Karaoke Ticketの一回限りCheck-inを複数回成立させてはならない。 |
| FR-STF-014 | Entry QRをKaraoke受付に、Karaoke QRをEntry受付に相互代用できてはならない。 |
| FR-STF-015 | 予約時間外受付等の例外運用Capabilityが必要な場合、通常Check-inとは区別して後続仕様で明示的に認可・定義しなければならず、Staff UIから無条件に例外受付できてはならない。 |
| FR-STF-016 | Staffが受付対象を確認するための表示情報は受付業務に必要な範囲へ制限し、無関係なCustomer業務データをStaff権限だけで参照できてはならない。詳細な情報範囲は `SPEC-060` / `SPEC-130` が定義する。 |

## 15. Email通知 Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-EML-001 | システムは、Supabase Authの認証フローに必要なメール確認・パスワード再設定等の認証関連通知を利用できなければならない。 |
| FR-EML-002 | 支払確定したEntry Ticket購入について、システムは購入完了通知を送信対象として生成できなければならない。 |
| FR-EML-003 | 支払確定したKaraoke Reservationについて、システムは予約内容を含む購入・予約完了通知を送信対象として生成できなければならない。 |
| FR-EML-004 | 支払確定したGoods購入について、システムは購入内容と会場受け取りに必要な案内を含む通知を送信対象として生成できなければならない。 |
| FR-EML-005 | システムは、運用上必要と後続仕様で定義される予約・受付・変更等の通知種別を追加可能な通知Capabilityを持たなければならない。 |
| FR-EML-006 | Business Transactionの正常Commit後に送信すべき業務通知は、Email配送処理から独立して追跡可能な送信要求として扱えなければならない。 |
| FR-EML-007 | Email送信失敗を理由に、確定済みOrder、Entry Ticket、Karaoke Reservation、Karaoke TicketまたはGoods購入をRollbackしてはならない。 |
| FR-EML-008 | Email送信に失敗した通知は、確定済みBusiness Transactionを再実行せずに再送できる構造を持たなければならない。 |
| FR-EML-009 | 同一通知の再送または処理retryによって、Order・Ticket・Reservation等の業務状態を重複更新してはならない。 |
| FR-EML-010 | Email Providerが一時的に利用不能な場合、システムは通知失敗として追跡可能な状態を保持し、購入・予約情報を失ってはならない。 |
| FR-EML-011 | Customerは、Emailが届かなかった場合でも、認証可能である限りBusiness Databaseに確定済みの購入・Ticket・Reservationをマイページから確認できなければならない。 |
| FR-EML-012 | Email Template全文、Provider送信結果の詳細、Retry policyは `SPEC-120` / `SPEC-150` がCanonical Ownerであり、本書の要件を弱めてはならない。 |

## 16. Cross-functional Functional Requirements

| Requirement ID | Functional Requirement |
|---|---|
| FR-XFN-001 | システムは、公開操作と認証必須操作を区別し、認証必須操作をGuestに成立させてはならない。 |
| FR-XFN-002 | 認証必須Requestについて、Hono APIはSupabase AuthのIdentityをServer-sideで検証しなければならない。 |
| FR-XFN-003 | Authenticated User向け自己所有データの参照・更新では、APIは認証Identityと対象業務データの所有関係をServer-sideで検証しなければならない。 |
| FR-XFN-004 | AdministratorおよびStaffの全高権限操作はAPI側で認可し、Web UIのRoute制御または表示制御だけを権限境界としてはならない。 |
| FR-XFN-005 | 業務データを読み書きする基本経路は `Browser → Next.js Web → Hono API → Supabase PostgreSQL` とし、Next.js WebまたはBrowserからBusiness Databaseへ直接アクセスする機能を実装してはならない。 |
| FR-XFN-006 | Supabase Authは認証IdentityのSystem of Recordとして利用し、Order、Ticket、Reservation、Goods、Check-in等の業務状態を認証Metadataだけで確定してはならない。 |
| FR-XFN-007 | Order、Ticket、Reservation、Goods、Check-in等の業務状態はBusiness DatabaseをSystem of Recordとして参照・更新しなければならない。 |
| FR-XFN-008 | 本システムはStripe Checkoutを利用し、カード番号その他の機微なカード情報をBusiness DatabaseまたはClient保存領域へ保持してはならない。 |
| FR-XFN-009 | 決済対象の購入試行は、Stripeへ遷移する前に追跡可能なOrderとしてBusiness Databaseへ永続化しなければならない。 |
| FR-XFN-010 | 支払確定はBrowser redirectと分離し、署名検証済みStripe Webhookを業務確定の根拠としなければならない。 |
| FR-XFN-011 | Webhook署名検証に失敗したEventを支払確定その他の業務状態更新へ使用してはならない。 |
| FR-XFN-012 | Webhook再送、Network retryまたはClient retryが発生しても、同一Orderの支払確定を論理的に一度だけ成立させなければならない。 |
| FR-XFN-013 | 同一原因から同一権利のEntry TicketまたはKaraoke Ticketを重複発行してはならない。 |
| FR-XFN-014 | 排他的な同一Karaoke Slotを複数Customerへ販売済みとして確定してはならない。 |
| FR-XFN-015 | 一回限りのEntry Check-inおよびKaraoke Check-inを、並行Scanやretryによって二重成立させてはならない。 |
| FR-XFN-016 | APIは、Clientが送信したprice、role、payment result、inventory、slot availabilityその他改ざん可能な業務値を、Server-side再検証なしに権威ある値として採用してはならない。 |
| FR-XFN-017 | 公開識別子または内部識別子を知っていることだけを根拠に、他者のOrder、Ticket、Reservation、Profile、Goods購入情報へアクセスさせてはならない。 |
| FR-XFN-018 | Entry QRとKaraoke QRは別の権利・用途として検証し、相互利用を許可してはならない。 |
| FR-XFN-019 | Business Transactionが確定した後のEmail配送失敗は通知処理の失敗として分離し、確定済み業務状態をRollbackしてはならない。 |
| FR-XFN-020 | Stripe、Resend、Supabase Authその他外部Serviceの一時障害が発生しても、既にBusiness Databaseへ確定済みの業務データを障害の副作用として削除または消失させてはならない。 |
| FR-XFN-021 | 外部Service呼び出しを含む処理で単一Database Transactionに収められない非同期状態が生じる場合、後続仕様で再試行・再同期・運用確認できる追跡可能な業務状態を持たなければならない。 |
| FR-XFN-022 | システムは、運営側が決める外部事実および販売条件を変更可能な業務データまたは運用設定として保持・適用できなければならない。 |
| FR-XFN-023 | Administratorが変更可能な外部事実・販売条件について、変更後の値は新規の公開表示および新規業務判定へ反映できなければならない。既存確定権利への影響ルールは各Domain Canonical Ownerが定義する。 |
| FR-XFN-024 | 重要な購入確定、Ticket発行、Reservation確定、Check-in、管理操作、外部連携失敗は、後続のObservability/Audit仕様で原因・対象・結果を追跡できるイベントとして観測可能でなければならない。 |
| FR-XFN-025 | 権限不足の操作要求では、システムは対象操作を実行せず、呼出元が許可されていないことを識別できる失敗結果を返さなければならない。HTTP Status等は `SPEC-110` が定義する。 |
| FR-XFN-026 | 販売状態、在庫、Slot空き、支払状態等がClient表示後に変化した場合、APIは実行時の現在状態を基準に再判定し、古いClient表示だけを根拠に処理を成立させてはならない。 |
| FR-XFN-027 | Checkout開始に失敗した場合、システムは支払済みとして扱わず、購入試行を後から照合可能な状態として保持しなければならない。 |
| FR-XFN-028 | 決済未完了の場合、システムは対象Orderに対応する購入済み権利を有効として提供してはならない。 |
| FR-XFN-029 | Webhook反映待ちの場合、システムはBusiness Database上の確定前状態を表示でき、Browser側の成功表示だけで確定済みと偽装してはならない。 |
| FR-XFN-030 | QRが形式上または業務上無効である場合、システムはCheck-inを成立させず、Staffが無効結果を識別できなければならない。 |
| FR-XFN-031 | QRが既に使用済みである場合、システムは二重Check-inを成立させず、Staffが使用済み結果を識別できなければならない。 |
| FR-XFN-032 | 利用者向けまたは運用者向け画面が一時的な外部Service障害を検出した場合、確定していない処理を成功と表示せず、再試行または後続確認が必要であることを識別できる結果を返さなければならない。具体的なUXは `SPEC-040` / `SPEC-050` が定義する。 |
| FR-XFN-033 | Server-only SecretはClientへ露出してはならず、Clientに必要な公開設定と秘密情報を分離しなければならない。詳細は `SPEC-140` / `SPEC-180` が定義する。 |

## 17. System Configuration / External Facts

システムは、プロジェクト所有者またはイベント運営側が決定する外部事実を、固定値の捏造ではなく設定可能な業務情報として扱う。

少なくとも以下を管理・適用できなければならない。

| Configuration / External Fact | Functional requirement上の扱い | 詳細Canonical Owner |
|---|---|---|
| イベント開催日時 | 公開表示および日時依存の運用判断に利用できる設定値 | SPEC-030 / SPEC-050 / SPEC-130 |
| 会場情報・アクセス | 公開表示を変更可能にする | SPEC-050 / SPEC-130 |
| 公開注意事項・FAQ・お知らせ | 公開内容を運用変更可能にする | SPEC-050 / SPEC-130 |
| Entry Ticket種別 | 販売対象として定義・表示・購入判定に利用する | SPEC-030 / SPEC-130 |
| Entry Ticket価格 | Server-sideの決済金額決定へ利用する | SPEC-030 / SPEC-070 / SPEC-130 |
| Entry Ticket販売期間 | 新規購入可否へ適用する | SPEC-030 / SPEC-130 |
| Entry Ticket販売数量 | 新規購入可否へ適用する | SPEC-030 / SPEC-100 / SPEC-130 |
| 1 Accountあたり購入制限 | Server-side購入可否へ適用する | SPEC-030 / SPEC-130 |
| Karaoke価格 | Server-sideの決済金額決定へ利用する | SPEC-030 / SPEC-070 / SPEC-090 / SPEC-130 |
| Karaoke販売期間 | 新規予約購入可否へ適用する | SPEC-030 / SPEC-090 / SPEC-130 |
| Karaoke購入制限 | Server-side購入可否へ適用する | SPEC-030 / SPEC-090 / SPEC-130 |
| Karaoke Slot構成 | 利用時間・整備時間を含むSlot生成へ利用する | SPEC-030 / SPEC-090 / SPEC-130 |
| Goods価格 | Server-sideの決済金額決定へ利用する | SPEC-030 / SPEC-070 / SPEC-130 |
| Goods在庫 | 新規購入可否および受け渡し運用へ利用する | SPEC-030 / SPEC-100 / SPEC-130 |

どの情報をAdmin UIで変更可能にするか、変更時の履歴・監査、Deploy-time configurationとの境界は `SPEC-130` / `SPEC-160` / `SPEC-180` が詳細化する。本書は、運営変更対象の外部事実をコードへ不必要に固定しない機能要件をCanonicalに所有する。

## 18. Error / Failure時のFunctional Behavior集約

本章は各Requirementに定義した失敗時挙動を横断的に整理する。Error code、HTTP Status、Retry回数、Runbookは本書では定義しない。

| Failure Scenario | 必須の利用者・運用者向けBehavior | Primary Requirement IDs |
|---|---|---|
| 認証失敗 | 認証必須操作を成立させず、認証が成立していない結果を返す | FR-AUTH-005, FR-XFN-001, FR-XFN-002 |
| 販売終了・売り切れ | 新規購入を成立させず、現在購入不可である結果を返す | FR-TKT-006, FR-GDS-006 |
| Cart購入開始時の一部Item不成立 | Orderを作成せず、確保済みAllocationを残さず、不成立Itemを識別できる結果を返す | FR-CRT-005, FR-CRT-007 |
| Karaoke Slot競合 | 最大1件だけを確保へ進め、競合した他要求を失敗させる | FR-KRK-012, FR-XFN-014 |
| Checkout開始失敗 | 支払済みにせず、購入試行を追跡可能に保持する | FR-TKT-010, FR-XFN-027 |
| 決済未完了 | Ticket / Reservation / Goods権利を支払済みとして有効化しない | FR-TKT-017, FR-XFN-028 |
| Webhook反映待ち | redirectのみで確定表示せず、Business Databaseの現在状態を表示する | FR-TKT-018, FR-KRK-027, FR-XFN-029 |
| Email送信失敗 | Business TransactionをRollbackせず、通知を再送可能にする | FR-EML-007, FR-EML-008, FR-XFN-019 |
| QR無効 | Check-inを成立させず、Staffへ無効結果を返す | FR-STF-005, FR-STF-011, FR-XFN-030 |
| QR使用済み | 二重Check-inを防止し、Staffへ使用済み結果を返す | FR-STF-006, FR-STF-012, FR-XFN-031 |
| 権限不足 | 操作を実行せず、権限不足の失敗結果を返す | FR-XFN-025 |
| 外部Service一時障害 | 未確定処理を成功と表示せず、確定済み業務データを失わない | FR-AUTH-014, FR-EML-010, FR-XFN-020, FR-XFN-032 |

## 19. System InvariantとのTraceability

`SPEC-010` のSystem Invariantは本書のFunctional Requirementsによって次のように具体化される。

| SPEC-010 Invariant | 主な追跡先Requirement |
|---|---|
| INV-010-01 購入情報を失わない | FR-TKT-007, FR-KRK-013, FR-GDS-007, FR-CRT-011, FR-XFN-009 |
| INV-010-02 Orderを二重確定しない | FR-TKT-013, FR-KRK-020, FR-GDS-010, FR-XFN-012 |
| INV-010-03 Ticketを二重発行しない | FR-TKT-015, FR-KRK-023, FR-XFN-013 |
| INV-010-04 カラオケ枠を二重販売しない | FR-KRK-010, FR-KRK-011, FR-KRK-012, FR-KRK-021, FR-XFN-014 |
| INV-010-05 QR Ticketを二重利用させない | FR-STF-004, FR-STF-005, FR-STF-006, FR-STF-007, FR-STF-010, FR-STF-011, FR-STF-012, FR-STF-013, FR-XFN-015 |
| INV-010-06 Email失敗で購入確定をRollbackしない | FR-EML-006, FR-EML-007, FR-EML-008, FR-EML-009, FR-EML-010, FR-XFN-019 |
| INV-010-07 決済確定と権利発行を中途半端に残さない | FR-TKT-016, FR-CRT-007, FR-CRT-009, FR-CRT-010, FR-KRK-017, FR-KRK-018, FR-KRK-019, FR-KRK-020, FR-KRK-021, FR-KRK-022, FR-KRK-023, FR-XFN-021 |
| INV-010-08 所有権と権限をServer-sideで検証する | FR-AUTH-009, FR-MYP-002, FR-MYP-012, FR-XFN-002, FR-XFN-003, FR-XFN-004, FR-XFN-017 |
| INV-010-09 金額をClient入力だけで確定しない | FR-TKT-004, FR-KRK-014, FR-GDS-005, FR-CRT-003, FR-CRT-007, FR-XFN-016 |
| INV-010-10 外部処理の再送に耐える | FR-TKT-013, FR-KRK-020, FR-GDS-010, FR-EML-008, FR-EML-009, FR-XFN-012, FR-XFN-013, FR-XFN-014, FR-XFN-015 |

下流仕様は上記InvariantとRequirementを同時に満たす具体設計を定義しなければならない。

## 20. 後続仕様へのCanonical Owner委譲

本書はFunctional Requirementの存在、成立条件、禁止事項を所有する。以下の詳細は本書で固定せず、各Canonical Ownerへ委譲する。

| SPEC | 本書から委譲する詳細 |
|---|---|
| SPEC-030 Domain Model & Business Rules | Domain Entity、属性の論理意味、完全なState、状態遷移、購入・所有・在庫・予約等のBusiness Rule |
| SPEC-040 User Flows | 画面遷移、分岐、失敗時UX、再試行導線 |
| SPEC-050 Page / Screen Specification | URL、画面一覧、Field、Layout、Navigation、表示条件 |
| SPEC-060 Authentication / Authorization | Session、Role、Permission Matrix、Actor細分化、認可規則 |
| SPEC-070 Order / Payment | Order lifecycle、Checkout、Stripe Event別処理、Refund、Checkout期限、決済冪等性詳細 |
| SPEC-080 Ticket / QR / Check-in | Ticket lifecycle、QR Token形式、Token保存、検証、Check-in競合制御 |
| SPEC-090 Karaoke Reservation | Slot model、hold具体時間、競合実装、解放条件、当日時間ルール |
| SPEC-100 Database Design | Table、Column、Type、Index、Constraint、Transaction SQL、Migration |
| SPEC-110 API Specification | Endpoint、Request / Response、Zod Schema、HTTP Status、Error code |
| SPEC-120 Email Notification | 通知種別詳細、Template全文、送信条件、Provider内部連携、Retry詳細 |
| SPEC-130 Admin / Staff | 個別画面、操作単位、Filter、例外運用、管理対象の詳細 |
| SPEC-140 Security | Secret、Threat、CSRF/CORS、Token、詳細Security Control |
| SPEC-150 Reliability / Error Recovery | Retry回数、Backoff、再同期、復旧Runbook、不整合修復 |
| SPEC-160 Observability / Audit Log | Log、Metric、Trace、Audit event schema、Retention |
| SPEC-170 Test Specification | Unit / Integration / E2E Test Case一覧とCoverage |
| SPEC-180 Infrastructure / Deployment | Environment、Secret配置、Hosting設定、Deploy手順、Network |
| SPEC-190 AI Development Guidelines | Repository coding rule、AI実装手順、品質Gate |
| SPEC-200 System Acceptance Criteria | 完成システムのAcceptance testcase・最終受入判定 |

下流仕様は本書のRequirement IDを参照して詳細化し、本書の要件を無断で弱めてはならない。

## 21. 受入条件

本仕様書は以下をすべて満たす場合に成立する。

1. 公開サイト、Account、Entry Ticket、Karaoke、Goods、Mypage、Administrator、Staff、Emailの各機能領域に一意なRequirement IDが存在する。
2. Guest、Authenticated User、Customer、Staff、AdministratorのCapability境界が `SPEC-010` と整合する。
3. Customerが独立Roleではなく業務上のActor分類として維持されている。
4. Business Databaseアクセスの基本経路と、Next.js WebからBusiness Databaseへ直接アクセスしない原則が機能要件として維持されている。
5. Supabase AuthとBusiness DatabaseのSystem of Record責務が分離されている。
6. Stripeへ遷移する前にOrderを永続化する要件がある。
7. Browser redirectではなく検証済みStripe Webhookを支払確定根拠とする要件がある。
8. Order二重確定、Ticket二重発行、Entry Ticket販売上限超過、Karaoke Slot二重販売、Goods在庫超過、QR二重Check-inを防ぐ要件がある。
9. Entry QRとKaraoke QRの用途分離が要件化されている。
10. Email送信失敗とBusiness Transaction確定が分離され、失敗通知を再送可能にする要件がある。
11. Userが自身に帰属する業務データだけを参照できる要件がある。
12. Administrator / Staff操作のServer-side authorizationが要件化されている。
13. Client price、role、payment result、在庫、Slot空き等を信頼しない要件がある。
14. 外部Service一時障害が確定済み業務データ消失へ連鎖しない要件がある。
15. イベント日時、会場、価格、販売条件等の外部事実を捏造せず、設定・保持・適用・表示できる要件がある。
16. Functional Requirementから `SPEC-010` のSystem Invariantへ追跡可能である。
17. 状態遷移、DB、API、Screen、Stripe Event、QR Token、hold時間等の詳細Canonical Ownerを侵食していない。
18. 各Requirementが後続 `SPEC-170` / `SPEC-200` で成立・不成立を判定できる断定文になっている。
19. 本書が `SPEC-000` の依存関係、Canonical Owner、情報源優先順位、Upstream Change Request規則に従っている。
20. Entry TicketとGoodsをCartへ入れて1回の外部決済へまとめて購入でき、Karaokeは別Orderとして購入する要件がある。
21. Cartが参照と数量だけを保持するBrowser側の補助であり、金額・在庫・販売可否・Ownerを権威値にしない要件がある。
22. Cartからの購入開始がAll-or-Nothingであり、複合Orderの確定・解放が一貫して成立する要件がある。
23. 協賛ロゴを公開対象だけ表示し、運営が変更できる要件がある。

## 22. 上流仕様変更要求

なし。

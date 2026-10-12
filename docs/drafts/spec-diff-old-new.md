# 仕様書 新旧差分

- 旧: コミット `385127c`（本作業の開始時点。2026-09-14）
- 新: 現在の `dev` の先頭（`HEAD`）
- 左列が旧仕様書の本文、右列が新仕様書の本文です。変更のあった箇所だけを、仕様書IDごと・章（見出し）ごとにまとめています。
- 空の側（「（なし）」）は、その側に該当する行がないこと（追加または削除）を表します。
- 表の都合で、`|` は `\|`、`<` と `>` は文字参照に置き換えています。
- 変更のなかった仕様書は載せていません。

## 目次

- SPEC-020 Functional Requirements（version 1.0.0 → 1.1.0、10 章 / 13 箇所）
- SPEC-030 Domain Model and Business Rules（version 1.0.0 → 1.1.0、17 章 / 21 箇所）
- SPEC-040 User Flows（version 1.0.0 → 1.1.0、23 章 / 28 箇所）
- SPEC-050 Page and Screen Specification（version 1.0.0 → 1.2.0、37 章 / 66 箇所）
- SPEC-070 Order and Payment Specification（version 1.0.0 → 1.1.0、7 章 / 9 箇所）
- SPEC-100 Database Design（version 1.0.0 → 1.0.1、2 章 / 2 箇所）
- SPEC-110 API Specification（version 1.1.0 → 1.1.1、2 章 / 2 箇所）
- SPEC-170 Test Specification（version 1.1.0 → 1.2.0、4 章 / 4 箇所）
- SPEC-190 AI Development Guidelines（version 1.1.0 → 1.2.0、5 章 / 5 箇所）

## SPEC-020 Functional Requirements

- ファイル: `docs/specs/020-functional-requirements.md`
- version: 1.0.0 → 1.1.0
- 変更: 10 章 / 13 箇所

### SPEC-020 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.0.0 | version: 1.1.0 |

### SPEC-020 / 2. 適用範囲

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart・Entry TicketとGoodsの複合購入 |

### SPEC-020 / 4. Canonical Terms

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Cart \| Entry Ticket OfferingとGoodsの参照と数量だけをBrowserに一時保持する購入前の利用者補助機能。業務データでも販売確保でもない \|<br>\| 購入開始 \| Authenticated Userの操作により、Server-sideで販売条件を再検証し、Business Databaseへ `PREPARED` Orderを永続化する業務操作。Cartへの追加・数量変更・削除は購入開始ではない \|<br>\| 複合Order \| Entry Ticket Order ItemとGoods Order Itemの両方を含む1つのOrder。1回の外部決済へ対応する \|<br>\| Sponsor Logo \| 協賛者の表示名、画像、任意のリンク先、表示順、公開状態を持つ公開情報 \| |

### SPEC-020 / 5.1 Requirement ID

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| `FR-CRT` \| Cart・複合購入 \| |

### SPEC-020 / 7. 公開イベントサイト Functional Requirements

| 旧仕様書 | 新仕様書 |
|---|---|
| \| FR-PUB-011 \| 公開情報のうち開催日時、会場、注意事項、FAQ、お知らせ、販売案内等の運営変更対象情報は、コード変更を前提とせず業務データまたは運用設定として更新可能でなければならない。 \| | \| FR-PUB-011 \| 公開情報のうち開催日時、会場、注意事項、FAQ、お知らせ、協賛ロゴ、販売案内等の運営変更対象情報は、コード変更を前提とせず業務データまたは運用設定として更新可能でなければならない。 \| |
| （なし） | \| FR-PUB-015 \| システムは、運営側が公開対象とした協賛ロゴを公開画面へ表示できなければならない。公開対象でない協賛ロゴを表示してはならず、公開対象が0件の場合は協賛ロゴ表示領域を表示しなくてよい。協賛ロゴの取得失敗は他の公開情報の表示を妨げてはならない。 \| |

### SPEC-020 / 11A. Cart・複合購入 Functional Requirements

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ## 11A. Cart・複合購入 Functional Requirements<br>&nbsp;<br>Entry TicketとGoodsは、Cartを経由して1回の外部決済へまとめて購入できる。Karaokeは排他的な時間枠と支払前Holdの制約が異なるため、Cartへ入れず、Slotごとに独立して購入する。<br>&nbsp;<br>\| Requirement ID \| Functional Requirement \|<br>\|---\|---\|<br>\| FR-CRT-001 \| GuestおよびAuthenticated Userは、公開対象のEntry Ticket OfferingとGoodsをCartへ追加し、Cart内の数量変更・削除・内容確認ができなければならない。これらの操作は購入開始ではなく、Order、Allocation、Hold、Inventory変更を発生させてはならない。 \|<br>\| FR-CRT-002 \| Karaoke SlotをCartへ追加できてはならない。Karaokeの購入開始はSlotごとに独立して行い、1 Orderは1つのKaraoke Slotだけを対象とする。 \|<br>\| FR-CRT-003 \| Cartは、対象の参照と数量だけを保持しなければならない。価格、金額、通貨、在庫、販売可否、支払結果、Owner、Role、個人情報、Secretを保持してはならず、保持値を権威値として採用してはならない。 \|<br>\| FR-CRT-004 \| CartはBrowser側の購入前補助であり、Business Databaseへ保存してはならない。Cartへの追加は容量、在庫、Slotを確保せず、他の利用者の購入可否に影響してはならない。 \|<br>\| FR-CRT-005 \| Cart表示は、各Itemの現在の価格と販売状態をServer-sideの現在値から表示し、販売開始前、販売終了、販売停止、売り切れ、数量不足、Purchase Limit超過等の購入不可理由をItem単位で識別できなければならない。取得に失敗したItemを購入可能として表示してはならない。 \|<br>\| FR-CRT-006 \| Cartからの購入開始はAuthenticated Userだけが実行できなければならない。GuestがCartから購入開始を選んだ場合、認証が必要であることを識別できる結果を返し、認証後もCart内容を保持して再開できなければならない。 \|<br>\| FR-CRT-007 \| Cartからの購入開始では、APIはCart内の全Itemについて販売期間、販売状態、容量または在庫、Purchase Limit、価格をServer-sideで再検証し、1件でも成立しない場合は、Orderを作成せず、Allocationを確保した状態を残してはならない。成功した場合は全Itemを同一の購入開始として成立させなければならない。 \|<br>\| FR-CRT-008 \| Cart内のItemの種類に応じて、システムはEntry Ticketだけ、Goodsだけ、またはEntry TicketとGoodsの両方を含む単一のOrderを作成し、単一の外部決済へ対応させなければならない。Order Purposeの決定はServer-sideで行い、Clientが指定してはならない。 \|<br>\| FR-CRT-009 \| 複合Orderの支払確定では、含まれるEntry Ticketの発行とAllocation確定、およびGoodsのAllocation確定と履行可能化を、中途半端な確定状態を残さない一貫した業務更新として成立させなければならない。いずれかが成立しない場合は、Orderを通常の `CONFIRMED` として扱ってはならない。 \|<br>\| FR-CRT-010 \| 複合Orderが支払前に取消、失効または支払不成立となった場合、当該Orderに属する全てのAllocationを同一Order内で一貫して解放しなければならない。 \|<br>\| FR-CRT-011 \| 購入開始が成功しOrderが作成された時点で、当該Orderに含めたItemをCartから除去できなければならない。購入開始失敗時は、Cart内容を失わず利用者が内容を見直せなければならない。 \|<br>\| FR-CRT-012 \| Cart内容は特定のAccountの所有権や権利を発生させてはならない。LoginまたはLogoutによって他者のCart内容や購入済み権利が表示されてはならない。 \|<br>&nbsp; |

### SPEC-020 / 13. Administrator Functional Requirements

| 旧仕様書 | 新仕様書 |
|---|---|
| \| FR-ADM-018 \| Administratorは、イベント開催日時、会場情報、注意事項、FAQ、お知らせ等、運営側が決定する公開情報を変更できるCapabilityを持たなければならない。具体的な管理対象と画面は `SPEC-130` が定義する。 \| | \| FR-ADM-018 \| Administratorは、イベント開催日時、会場情報、注意事項、FAQ、お知らせ、協賛ロゴ等、運営側が決定する公開情報を変更できるCapabilityを持たなければならない。具体的な管理対象と画面は `SPEC-130` が定義する。 \| |

### SPEC-020 / 18. Error / Failure時のFunctional Behavior集約

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Cart購入開始時の一部Item不成立 \| Orderを作成せず、確保済みAllocationを残さず、不成立Itemを識別できる結果を返す \| FR-CRT-005, FR-CRT-007 \| |

### SPEC-020 / 19. System InvariantとのTraceability

| 旧仕様書 | 新仕様書 |
|---|---|
| \| INV-010-01 購入情報を失わない \| FR-TKT-007, FR-KRK-013, FR-GDS-007, FR-XFN-009 \| | \| INV-010-01 購入情報を失わない \| FR-TKT-007, FR-KRK-013, FR-GDS-007, FR-CRT-011, FR-XFN-009 \| |
| \| INV-010-07 決済確定と権利発行を中途半端に残さない \| FR-TKT-016, FR-KRK-017, FR-KRK-018, FR-KRK-019, FR-KRK-020, FR-KRK-021, FR-KRK-022, FR-KRK-023, FR-XFN-021 \| | \| INV-010-07 決済確定と権利発行を中途半端に残さない \| FR-TKT-016, FR-CRT-007, FR-CRT-009, FR-CRT-010, FR-KRK-017, FR-KRK-018, FR-KRK-019, FR-KRK-020, FR-KRK-021, FR-KRK-022, FR-KRK-023, FR-XFN-021 \| |
| \| INV-010-09 金額をClient入力だけで確定しない \| FR-TKT-004, FR-KRK-014, FR-GDS-005, FR-XFN-016 \| | \| INV-010-09 金額をClient入力だけで確定しない \| FR-TKT-004, FR-KRK-014, FR-GDS-005, FR-CRT-003, FR-CRT-007, FR-XFN-016 \| |

### SPEC-020 / 21. 受入条件

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 20. Entry TicketとGoodsをCartへ入れて1回の外部決済へまとめて購入でき、Karaokeは別Orderとして購入する要件がある。<br>21. Cartが参照と数量だけを保持するBrowser側の補助であり、金額・在庫・販売可否・Ownerを権威値にしない要件がある。<br>22. Cartからの購入開始がAll-or-Nothingであり、複合Orderの確定・解放が一貫して成立する要件がある。<br>23. 協賛ロゴを公開対象だけ表示し、運営が変更できる要件がある。 |

## SPEC-030 Domain Model and Business Rules

- ファイル: `docs/specs/030-domain-model-business-rules.md`
- version: 1.0.0 → 1.1.0
- 変更: 17 章 / 21 箇所

### SPEC-030 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.0.0 | version: 1.1.0 |

### SPEC-030 / 4. Canonical Domain Terms

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| 複合Order \| Entry Ticket Order ItemとGoods Order Itemの両方を含むOrder。Purposeは `ENTRY_GOODS_PURCHASE` \|<br>\| Cart \| Entry Ticket OfferingとGoodsの参照と数量だけをBrowserに一時保持する購入前の利用者補助。Domain Entityではなく、Business Databaseへ保存せず、販売確保も行わない \|<br>\| Sponsor Logo \| 協賛者の表示名、画像、任意のリンク先、表示順、公開状態を持つ公開情報Entity \| |

### SPEC-030 / 6.1 Aggregate一覧

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Sponsor Logo \| Entity \| 協賛ロゴの表示情報と公開状態 \| |

### SPEC-030 / 8.1 Event

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Sponsor Logo群（§8.4） |

### SPEC-030 / 8.2 Publication State

| 旧仕様書 | 新仕様書 |
|---|---|
| FAQ Item、Announcementその他公開/非公開を切り替える独立コンテンツは以下の状態を持つ。 | FAQ Item、Announcement、Sponsor Logoその他公開/非公開を切り替える独立コンテンツは以下の状態を持つ。 |

### SPEC-030 / 8.3 Event Business Rules

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| BR-EVT-005 \| Guestを含む利用者へ返すSponsor Logoは `PUBLISHED` のものだけとし、`DRAFT` / `ARCHIVED` を公開データとして扱ってはならない。表示順は運営が設定した順序に従う。 \| FR-PUB-011, FR-PUB-015, FR-ADM-018 \| INV-010-08 \|<br>&nbsp;<br>### 8.4 Sponsor Logo<br>&nbsp;<br>`Sponsor Logo` は少なくとも以下の論理情報を持つ。<br>&nbsp;<br>- 表示名称（画像の代替テキストを兼ねる）<br>- 画像への参照<br>- リンク先（任意。運営が設定した公開可能な外部URL）<br>- 表示順<br>- Publication State<br>&nbsp;<br>画像そのものの制作・取得元は運営が用意する素材であり、本書は権利関係や画像形式を定義しない。Sponsor Logoの追加・変更・公開状態の変更は、コード変更を前提とせず運営が行える。 |

### SPEC-030 / 11.2 Order Purpose

| 旧仕様書 | 新仕様書 |
|---|---|
| - `ENTRY_TICKET_PURCHASE`<br>- `KARAOKE_PURCHASE`<br>- `GOODS_PURCHASE` | \| Purpose \| 含むOrder Item \|<br>\|---\|---\|<br>\| `ENTRY_TICKET_PURCHASE` \| Entry Ticket Order Itemだけ \|<br>\| `KARAOKE_PURCHASE` \| 1つのKaraoke Order Item \|<br>\| `GOODS_PURCHASE` \| Goods Order Itemだけ \|<br>\| `ENTRY_GOODS_PURCHASE` \| Entry Ticket Order ItemとGoods Order Itemの両方 \| |
| 1つのOrderに異なるPurposeを混在させるCross-domain cartは本システムのCanonical Domainとして定義しない。 | Purposeは、Order作成時にServer-sideが含まれるOrder Itemから決定し、作成後に変更しない。Clientが指定したPurposeを採用してはならない。 |
| 理由は、Entry Ticket容量、Karaoke Slot hold、Goods在庫の解放条件と権利生成が異なり、上流RequirementがCross-domain cartを要求していないためである。同一Purpose内では複数Order Itemを持ってよい。ただしKaraoke Orderは1つの排他的Slot購入を1 Orderとして扱い、1つのOrderに複数Karaoke Slotを混在させない。 | Karaokeを他のPurposeのOrder Itemと混在させるOrderは定義しない。理由は、Karaoke Holdが1つの排他的Slotを時間限定で支払前に確保し、その有効期限が支払期限と連動するため、Entry TicketやGoodsのAllocationと解放条件・失効条件が異なるからである。混在させるとKaraoke Holdの失効がEntry TicketとGoodsの確定まで阻害する。<br>&nbsp;<br>Entry TicketとGoodsは、どちらも支払前にSales Allocationで確保し、確定・解放の条件が同形であるため、利用者が1回の支払操作で購入できるよう1つの複合Order（§11.9）にまとめてよい。同一Purpose内では複数Order Itemを持ってよい。ただしKaraoke Orderは1つの排他的Slot購入を1 Orderとして扱い、1つのOrderに複数Karaoke Slotを混在させない。 |

### SPEC-030 / 11.7 Order Business Rules

| 旧仕様書 | 新仕様書 |
|---|---|
| \| BR-ORD-012 \| Order Purposeは作成後不変であり、Karaoke Orderは1 Orderにつき1排他的Karaoke Slotだけを対象とする。 \| FR-KRK-004, FR-KRK-013〜019 \| INV-010-04, INV-010-07 \| | \| BR-ORD-012 \| Order Purposeは作成後不変であり、Karaoke Orderは1 Orderにつき1排他的Karaoke Slotだけを対象とし、他のPurposeのOrder Itemを含まない。 \| FR-KRK-004, FR-KRK-013〜019 \| INV-010-04, INV-010-07 \| |

### SPEC-030 / 11.8 Orderの禁止遷移

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | &nbsp;<br>### 11.9 Entry TicketとGoodsの複合Order<br>&nbsp;<br>Cartを経由した購入開始では、Entry TicketとGoodsを1つのOrderにまとめられる。複合Orderでも、Entry TicketとGoodsそれぞれの販売Rule、Allocation、権利生成のRuleは各Domainの既存Ruleに従う。本節は、複合であることによって追加される整合Ruleだけを定める。<br>&nbsp;<br>\| Rule ID \| Precondition / Rule / Result \| 関連FR \| 関連Invariant \|<br>\|---\|---\|---\|---\|<br>\| BR-ORD-013 \| Order PurposeはOrder作成時にServer-sideがOrder Itemから決定する。Entry Ticketだけなら `ENTRY_TICKET_PURCHASE`、Goodsだけなら `GOODS_PURCHASE`、両方を含むなら `ENTRY_GOODS_PURCHASE` とする。Karaoke Order Itemを含むOrderを複合Orderにしてはならない。 \| FR-CRT-002, FR-CRT-008 \| INV-010-09 \|<br>\| BR-ORD-014 \| Cartからの購入開始では、含まれる全Entry Ticket Allocation、全Goods Sales Allocationの確保が成立した場合だけOrderを `PREPARED` として永続化する。1つでも確保できない場合はOrderを作成せず、確保途中の `HELD` Allocationを残してはならない。 \| FR-CRT-007, FR-CRT-008, FR-XFN-026 \| INV-010-01, INV-010-07 \|<br>\| BR-ORD-015 \| 複合OrderのBusiness Confirmationでは、全Entry Ticket Allocationの `COMMITTED` 化とEntry Ticket発行、全Goods Sales Allocationの `COMMITTED` 化とGoods Order Itemの `FULFILLABLE` 化、Order `CONFIRMED` を一貫して成立させなければならない。一部のItemだけの確定を通常結果にしてはならない。 \| FR-CRT-009 \| INV-010-02, INV-010-07 \|<br>\| BR-ORD-016 \| 複合Orderが支払前に `CANCELED` / `EXPIRED` / `PAYMENT_FAILED` になる場合、当該Orderに属する全ての `HELD` AllocationをDomain Ruleに従って解放しなければならない（BR-ORD-009）。一部のItemだけを解放して他を `HELD` のまま残してはならない。 \| FR-CRT-010, FR-XFN-027〜028 \| INV-010-07, INV-010-10 \|<br>\| BR-ORD-017 \| 複合Orderに含まれるEntry Ticket OfferingとGoodsの販売期間、Sale Control State、容量または在庫、Purchase Limitは、それぞれ従来のRule（BR-SAL-*、BR-GDS-*、BR-TKT-*）で判定する。複合であることを理由に判定を緩和してはならない。 \| FR-CRT-007, FR-TKT-026 \| INV-010-09, INV-010-10 \|<br>\| BR-ORD-018 \| Order金額は、複合Orderでも各Order ItemのServer-side価格Snapshotの合計とし、Clientが保持するCart内の金額を権威値にしてはならない（BR-ORD-003）。 \| FR-CRT-003, FR-CRT-005, FR-CRT-007 \| INV-010-09 \|<br>\| BR-ORD-019 \| Karaoke Orderと、Cartから作成するOrderは独立した別Orderであり、状態・支払・失効・Recoveryを共有しない。一方のOrderの失敗が他方の確保や権利を暗黙に変更してはならない。 \| FR-CRT-002 \| INV-010-04, INV-010-07 \|<br>\| BR-ORD-020 \| Cartは参照と数量だけを保持するBrowser側の購入前補助である。Cartへの追加・変更・削除は、Order、Allocation、Hold、Inventoryを変更せず、他の利用者の購入可否にも影響してはならない。購入開始成功後は、当該Orderに含めたItemをCartから除去してよい。 \| FR-CRT-001, FR-CRT-004, FR-CRT-011 \| INV-010-01, INV-010-09 \| |

### SPEC-030 / 22.13 DI-030-013 Combined Order Atomicity

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 22.13 DI-030-013 Combined Order Atomicity<br>&nbsp;<br>Entry TicketとGoodsを含む複合Orderでは、全Itemの支払前確保は全て成立するか何も成立しない。Order確定時も、含まれる全Entry Ticketの発行とAllocation確定、および全Goodsの履行可能化とAllocation確定が全て成立するか、いずれも通常確定として成立しない。支払前の解放も、全Allocationを一括で行う。<br>&nbsp;<br>Supports: `INV-010-01`, `INV-010-07`, `INV-010-10`<br>&nbsp; |

### SPEC-030 / 23. SPEC-010 System Invariant Traceability

| 旧仕様書 | 新仕様書 |
|---|---|
| \| INV-010-01 購入情報を失わない \| Order `PREPARED`, Allocation, Consistency Review Case \| BR-ORD-001, BR-ORD-010, DI-030-001 \| | \| INV-010-01 購入情報を失わない \| Order `PREPARED`, Allocation, Consistency Review Case \| BR-ORD-001, BR-ORD-010, BR-ORD-014, DI-030-001, DI-030-013 \| |
| \| INV-010-07 決済確定と権利発行を中途半端に残さない \| Order `CONFIRMED`, Allocation, Reservation, Ticket \| BR-ORD-005〜010, BR-TKT-005, BR-KRK-008, BR-GDS-004, DI-030-009 \| | \| INV-010-07 決済確定と権利発行を中途半端に残さない \| Order `CONFIRMED`, Allocation, Reservation, Ticket \| BR-ORD-005〜010, BR-ORD-013〜016, BR-TKT-005, BR-KRK-008, BR-GDS-004, DI-030-009, DI-030-013 \| |
| \| INV-010-09 金額をClient入力だけで確定しない \| Sales Configuration, Order Item price snapshot \| BR-SAL-001〜002, BR-ORD-003, DI-030-011 \| | \| INV-010-09 金額をClient入力だけで確定しない \| Sales Configuration, Order Item price snapshot \| BR-SAL-001〜002, BR-ORD-003, BR-ORD-013, BR-ORD-017〜018, BR-ORD-020, DI-030-011 \| |

### SPEC-030 / 24.1 Public / Auth

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| FR-PUB-015 \| Sponsor Logo, Publication State, BR-EVT-005 \| |

### SPEC-030 / 24.4a Cart / 複合購入

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 24.4a Cart / 複合購入<br>&nbsp;<br>\| Requirement \| Domain trace \|<br>\|---\|---\|<br>\| FR-CRT-001, FR-CRT-004 \| Cart（Domain Entityではない）, BR-ORD-020 \|<br>\| FR-CRT-002 \| §11.2, BR-ORD-012, BR-ORD-013, BR-ORD-019 \|<br>\| FR-CRT-003, FR-CRT-005 \| BR-ORD-003, BR-ORD-018, DI-030-011 \|<br>\| FR-CRT-006 \| BR-USR-001, BR-SAL-005 \|<br>\| FR-CRT-007 \| BR-ORD-014, BR-ORD-017, DI-030-013 \|<br>\| FR-CRT-008 \| §11.2, BR-ORD-013 \|<br>\| FR-CRT-009 \| BR-ORD-015, DI-030-009, DI-030-013 \|<br>\| FR-CRT-010 \| BR-ORD-016, BR-ORD-009 \|<br>\| FR-CRT-011 \| BR-ORD-020 \|<br>\| FR-CRT-012 \| BR-USR-006, DI-030-010 \|<br>&nbsp; |

### SPEC-030 / 24.5 Mypage / Admin / Staff / Email

| 旧仕様書 | 新仕様書 |
|---|---|
| \| FR-ADM-014〜016, FR-ADM-018 \| Sales Configuration / Event Domainを§§8,10で定義 \| | \| FR-ADM-014〜016, FR-ADM-018 \| Sales Configuration / Event Domain（Sponsor Logoを含む）を§§8,10で定義 \| |

### SPEC-030 / 25.2 Entry / Goods Allocation

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - 複合Orderで一部のAllocationだけを `HELD` のまま残して他を解放しない<br>- 複合Orderで一部のItemの権利だけを成立させて `CONFIRMED` にしない<br>- Karaoke Order ItemをEntry Ticket / Goods Order Itemと同じOrderに含めない |

### SPEC-030 / 26.1 SPEC-030 1.1.0により下流仕様で整合が必要な事項

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 26.1 SPEC-030 1.1.0により下流仕様で整合が必要な事項<br>&nbsp;<br>以下の下流仕様は、本改訂時点ではOrder Purposeを3値として記述しており、本書の4値と整合していない。該当仕様は、本書を正として改訂する。改訂が完了するまでの間、複合Orderと協賛ロゴに関しては本書の記述を正とし、下流の旧記述を根拠に複合Orderを禁止または未定義として扱ってはならない。<br>&nbsp;<br>\| SPEC \| 整合が必要な事項 \|<br>\|---\|---\|<br>\| SPEC-100 \| `orders.purpose` の許可値とPurposeとpurchase sourceの組合せ制約、複合Orderの購入時Transaction \|<br>\| SPEC-110 \| Cartからの購入開始API（複数ItemのRequest、All-or-Nothingの結果、不成立Itemの識別）、Order Purposeの許可値、Sponsor Logoの公開取得 \|<br>\| SPEC-120 \| 複合Orderの確認通知（Entry TicketとGoodsの両方を含む場合の通知内容） \|<br>\| SPEC-130 \| Sponsor Logoの管理画面と操作、Order一覧・詳細での複合Order表示 \|<br>\| SPEC-170 / SPEC-200 \| 複合Orderの確定・解放、Cart購入開始のAll-or-Nothing、Sponsor Logoの公開制御に対するTest CaseとAcceptance \|<br>&nbsp;<br>SPEC-070のPAY-ORD-004等のPurpose記述は、本改訂と同時にSPEC-070 1.1.0で最小限整合させる。<br>&nbsp; |

### SPEC-030 / 27. 受入条件

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 30. Order Purposeが `ENTRY_TICKET_PURCHASE`、`KARAOKE_PURCHASE`、`GOODS_PURCHASE`、`ENTRY_GOODS_PURCHASE` の4値であり、Server-sideが決定し、作成後不変である。<br>31. Karaoke Order ItemがEntry Ticket / Goods Order Itemと同じOrderに含まれない。<br>32. 複合Orderの支払前確保、確定、解放が全て成立するか何も成立しないRule（All-or-Nothing）がある。<br>33. CartがDomain Entityではなく、販売確保を行わず、金額・在庫を権威値にしないRuleがある。<br>34. Sponsor Logoが公開状態を持ち、`PUBLISHED` だけが公開対象になる。 |

## SPEC-040 User Flows

- ファイル: `docs/specs/040-user-flows.md`
- version: 1.0.0 → 1.1.0
- 変更: 23 章 / 28 箇所

### SPEC-040 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.0.0 | version: 1.1.0 |

### SPEC-040 / 5.5 利用者が区別できなければならないOutcome

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart内Itemの購入不可（購入開始時の一部Item不成立） |

### SPEC-040 / 6. Flow ID体系

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| `UF-CRT-*` \| Cart・Entry TicketとGoodsの複合購入 \| |

### SPEC-040 / 7.1 Main Success Flow

| 旧仕様書 | 新仕様書 |
|---|---|
| 4. **System** はEvent概要、開催日時、会場・アクセス、注意事項、`PUBLISHED` のFAQ / Announcementを返す。 | 4. **System** はEvent概要、開催日時、会場・アクセス、注意事項、`PUBLISHED` のFAQ / Announcement / Sponsor Logoを返す。 |

### SPEC-040 / 7.3 Failure / Conflict Flow

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 5. Sponsor Logoの取得に失敗した場合も、他領域の公開情報を失敗扱いにせず、Sponsor Logoを推測して補完しない。公開対象が0件の場合、利用者へSponsor Logoの領域を示さなくてよい。 |

### SPEC-040 / 7.6 Traceability

| 旧仕様書 | 新仕様書 |
|---|---|
| - `FR-PUB-001〜011`, `FR-PUB-013〜014`, `FR-KRK-002〜004`<br>- `BR-EVT-001〜004`, `BR-SAL-003〜005`, `BR-XFN-001〜004` | - `FR-PUB-001〜011`, `FR-PUB-013〜015`, `FR-KRK-002〜004`<br>- `BR-EVT-001〜005`, `BR-SAL-003〜005`, `BR-XFN-001〜004` |

### SPEC-040 / 8.2 Alternative / Failure Flow

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cartから購入手続きへ進んだGuestが認証を求められた場合、Cartの内容（参照と数量）を保持したまま認証へ進み、認証後にCartへ戻る。復帰時の価格・販売状態・在庫は現在状態で再取得する（`UF-CRT-001`）。 |

### SPEC-040 / 8.5 Traceability

| 旧仕様書 | 新仕様書 |
|---|---|
| - `FR-PUB-012`, `FR-AUTH-004〜005`, `FR-XFN-001〜003`, `FR-XFN-026` | - `FR-PUB-012`, `FR-AUTH-004〜005`, `FR-CRT-006`, `FR-XFN-001〜003`, `FR-XFN-026` |

### SPEC-040 / 16. UF-TKT-001 Entry Ticket購入

| 旧仕様書 | 新仕様書 |
|---|---|
| - **Entry Point:** 公開Entry Ticket販売案内または購入可能なEntry Ticket Offering | - **Entry Point:** 公開Entry Ticket販売案内から追加したEntry Ticketを含むCartの購入手続き（`UF-CRT-001`） |
| - **Trigger:** UserがTicket種別・数量を選択して購入開始する | - **Trigger:** UserがEntry Ticketを含むCartの購入手続きへ進み、購入開始する<br>&nbsp;<br>Entry Ticketの購入開始は `UF-CRT-001`（Cart）を起点とする。CartにEntry Ticketだけが含まれる場合は本Flowの全手順が適用される。Goodsも含まれる場合は、本Flowと `UF-GDS-001` の該当手順を `UF-CRT-001` の複合Order規則に従って同一Orderに対して適用する。 |

### SPEC-040 / 16.1 Main Success Flow

| 旧仕様書 | 新仕様書 |
|---|---|
| 1. **User** はEntry Ticket販売情報を確認し、Ticket種別と数量を選択する。 | 1. **User** はEntry Ticket販売情報を確認し、Ticket種別と数量を選択してCartへ追加し、Cartから購入手続きへ進む。 |

### SPEC-040 / 16.14 Traceability

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | &nbsp;<br># Part II-A — Cart・複合購入 Flows<br>&nbsp;<br>## 16A. UF-CRT-001 Cart・Entry TicketとGoodsの複合購入<br>&nbsp;<br>- **Flow ID:** `UF-CRT-001`<br>- **Primary Actor:** Guest / Authenticated User / Customer<br>- **Secondary Actor / External System:** Hono API / Business Database / Stripe / Notification subsystem<br>- **Entry Point:** Entry Ticket販売案内、Goods一覧またはGoods詳細の「Cartに追加」、またはGlobal NavigationのCart<br>- **Precondition:** 対象のEntry Ticket OfferingまたはGoodsが公開されている。Cartの閲覧・編集はGuestでも可能であり、購入開始にはAuthenticated Userであることが必要である<br>- **Trigger:** UserがEntry TicketまたはGoodsをCartへ追加する、またはCartから購入手続きへ進む<br>&nbsp;<br>Cartは参照と数量だけを保持するBrowser側の購入前補助であり、Domain Entityではない。Cartへの追加・変更・削除はBusiness Transactionを発生させない（`BR-ORD-020`）。Karaokeは本Flowの対象外であり、`UF-KRK-001` / `UF-KRK-002` に従ってSlotごとに独立して購入する（`BR-ORD-019`）。<br>&nbsp;<br>### 16A.1 Main Success Flow<br>&nbsp;<br>1. **User** はEntry Ticket種別・数量、またはGoods・数量を選択し、Cartへ追加する。GuestでもCartへ追加できる。<br>2. **Web** はBrowser側のCartへ参照と数量だけを保存する。Order、Allocation、Hold、Inventoryは変化しない。<br>3. **User** はCartを開く。**Web / API** は各Itemの現在の価格と販売状態をServer-sideの現在値から取得して表示する。小計は表示用であり、購入時の権威値ではない。<br>4. **User** は数量変更・削除を行う。購入不可のItemがある場合、Itemごとに購入不可理由が示される。<br>5. **User** は「購入手続きへ進む」を選ぶ。Guestなら `UF-PUB-002` へ分岐し、Cart内容は保持される。<br>6. **API** は認証Identityを検証し、Cart内の全Itemについて、販売期間、Sale Control State、容量または在庫、Purchase Limit、価格をServer-sideの現在状態から再検証する。Cartに保持された価格・在庫・販売可否は採用しない。<br>7. 全Itemが成立する場合のみ、**Business Database** は全Entry Sales Allocationと全Goods Sales Allocationを `HELD` として確保し、Order Purposeを決定し（`BR-ORD-013`）、購入時価格Snapshotを持つOrderを `PREPARED` として永続化する。Goods Order Itemは `PENDING_PAYMENT` である。<br>8. Order作成後、**Web** は当該OrderのItemをCartから除去する。<br>9. **API** は外部Checkoutを開始する。成立したらOrderを `AWAITING_PAYMENT` とし、**User** は1回のStripe Checkoutで支払う。<br>10. **Browser** が戻った後、**Web** は同じOrderをBusiness Databaseから取得する（`PG-XFN-001`）。`AWAITING_PAYMENT` なら `UF-XFN-001` として待機表示する。<br>11. 権威ある支払確定をAPIが検証する。**Business Database** は、`UF-TKT-001` §16.1 の手順14〜16に当たるEntry Ticket側の確定と、`UF-GDS-001` §20.1 の手順14〜15に当たるGoods側の確定を、含まれるItemの全てについて一貫して成立させ、Order `AWAITING_PAYMENT -&gt; CONFIRMED` とする（`BR-ORD-015`, `DI-030-013`）。<br>12. **System** はOrder確定後にNotification Requestを生成する。<br>13. **User** はマイページ（またはPurchase Status）で同じ `CONFIRMED` Order、Entry Ticket / QR、Goods / Handoff状態、Receipt導線を確認する。<br>&nbsp;<br>### 16A.2 Alternative Flow — Entry TicketだけまたはGoodsだけのCart<br>&nbsp;<br>CartにEntry TicketだけまたはGoodsだけが含まれる場合も、同じ購入手続きを使う。Order Purposeは `ENTRY_TICKET_PURCHASE` または `GOODS_PURCHASE` となり、`UF-TKT-001` または `UF-GDS-001` の結果が適用される。<br>&nbsp;<br>### 16A.3 Failure / Conflict Flow — 購入開始時に一部のItemが成立しない<br>&nbsp;<br>1. 表示時点で購入可能だったItemが、購入開始時に販売終了、停止、売り切れ、数量不足、Purchase Limit超過、Allocation競合となる場合がある。<br>2. 1つでも成立しないItemがある場合、**API** はOrderを作成せず、確保途中のAllocationを `HELD` のまま残さない（`BR-ORD-014`）。<br>3. **Web** は成立しなかったItemと理由を識別できる形で示し、Cart内容を保持する。<br>4. **User** はItemの数量変更・削除を行い、改めて購入手続きへ進む。この再試行は新しい購入開始であり、既存のAllocationを再利用しない。<br>&nbsp;<br>### 16A.4 Alternative Flow — 表示後の価格・販売状態の変化<br>&nbsp;<br>Cartの表示後に価格や販売状態が変化した場合も、購入開始時はServer-sideの現在値を使う。Cartの小計と作成されたOrderの金額が異なる場合、権威はOrderの金額であり、Orderの金額は `PG-XFN-001` で確認できる。<br>&nbsp;<br>### 16A.5 Failure Flow — Checkout開始失敗<br>&nbsp;<br>- OrderとAllocationを削除せず、Checkout未成立ならOrderは `PREPARED` に留まる。<br>- 全Allocationが有効な間だけ、同一Orderで安全なCheckout開始retryを行える。retryで追加Allocationや新Orderを作らない。<br>- Allocationが失効・解放された場合は、同一Orderを支払待ちへ進めず、新規購入として新しいOrder / Allocationを取得する。<br>&nbsp;<br>### 16A.6 Waiting / Failure / Recovery Flow — 支払未確定・Payment failure・不整合<br>&nbsp;<br>- `AWAITING_PAYMENT` / `REVIEW_REQUIRED` は成功扱いせず、同一Orderの状態再確認だけを行う。<br>- Payment failure、取消、失効となった場合、Orderに属する全てのAllocationを一括して解放する（`BR-ORD-016`）。一部のItemだけを `HELD` のまま残さない。<br>- 外部支払成功だがEntry Ticket側またはGoods側のいずれかを安全に確定できない場合、通常成功として表示せず、Order全体を `REVIEW_REQUIRED` またはConsistency Review Caseで追跡する。他方のItemだけを有効権利として提供しない。<br>- Terminalな失敗後の再購入は新Orderである。**Web** は、失敗したOrderに含まれていたItemの参照と数量を、Cartへ再投入して購入手続きをやり直せるようにしてよい。再投入はCartへの追加であり、価格・販売状態・在庫は現在状態で再検証する。<br>&nbsp;<br>### 16A.7 Alternative Flow — Email failure<br>&nbsp;<br>Order / Allocation / Ticket / Goods Order ItemのBusiness Transactionは `CONFIRMED` のまま維持し、Notificationだけを `FAILED_RETRYABLE` とする（`UF-XFN-002`）。<br>&nbsp;<br>### 16A.8 Alternative Flow — Karaokeとの併用<br>&nbsp;<br>- Karaokeは別Orderとして購入し、Entry Ticket / GoodsのOrderとは支払、状態、失効、Recoveryを共有しない（`BR-ORD-019`）。<br>- Cartを開いた利用者に、Karaokeはカートに入れられず、Slotごとに別の支払になることを示す。<br>- 同じ利用者が、Cartからの購入とKaraokeの購入の両方を行う場合、支払は別々に発生する。一方のOrderの失敗が他方のOrderを変更してはならない。<br>&nbsp;<br>### 16A.9 Retry / Resume Rule<br>&nbsp;<br>- Cartの再読込・再訪問: Browser側のCartを再取得し、現在の価格・販売状態を表示し直す。Business effectを作らない。<br>- Browser側のデータが失われた場合: Cartの内容は失われるが、既に作成済みのOrder・Allocation・権利には影響しない。<br>- Order作成後の再読込・Browser Return: 同一Orderを参照し、新Orderや新Ticketを作らない（`UF-TKT-001` §16.11、`UF-GDS-001` §20.11）。<br>- Allocation解放後・Terminal後の再購入: 新Order + 新Allocation群。<br>&nbsp;<br>### 16A.10 Success Postcondition<br>&nbsp;<br>- Order: `CONFIRMED`。Purposeは `ENTRY_TICKET_PURCHASE` / `GOODS_PURCHASE` / `ENTRY_GOODS_PURCHASE` のいずれか。<br>- Entry Sales Allocation: 全て `COMMITTED`。Entry Ticket: 購入数量分が `VALID`。<br>- Goods Sales Allocation: 全て `COMMITTED`。Goods Order Item: `FULFILLABLE`。Goods Handoff: `PENDING`。<br>- Customer / Owner: Order Customerと一致。<br>- Cart: 当該OrderのItemは除去済み。<br>&nbsp;<br>### 16A.11 Failure Postcondition<br>&nbsp;<br>- 購入開始に失敗した場合、Orderは作成されず、Allocationは残らない。Cart内容は保持される。<br>- 購入開始後の失敗は、Orderが `PREPARED` / `AWAITING_PAYMENT` / `PAYMENT_FAILED` / `CANCELED` / `EXPIRED` / `REVIEW_REQUIRED` のいずれかで追跡される。`CONFIRMED` でないOrderから有効Entry Ticketまたは受け取り可能なGoodsを提供しない。<br>&nbsp;<br>### 16A.12 Traceability<br>&nbsp;<br>- **FR:** `FR-CRT-001〜012`, `FR-TKT-003〜010`, `FR-TKT-025〜026`, `FR-GDS-003〜007`, `FR-GDS-011`, `FR-GDS-017`, `FR-PUB-012`, `FR-XFN-009〜013`, `FR-XFN-016`, `FR-XFN-019〜021`, `FR-XFN-026〜029`, `FR-XFN-032`<br>- **BR:** `BR-SAL-001〜008`, `BR-ORD-001〜020`, `BR-TKT-001〜011`, `BR-GDS-001〜013`, `BR-NTF-001〜006`<br>- **DI:** `DI-030-001〜004`, `DI-030-006`, `DI-030-009〜013`<br>- **INV:** `INV-010-01〜03`, `INV-010-06〜10` |

### SPEC-040 / 20. UF-GDS-001 Goods購入

| 旧仕様書 | 新仕様書 |
|---|---|
| - **Entry Point:** 公開Goods一覧またはGoods詳細の購入操作 | - **Entry Point:** 公開Goods一覧またはGoods詳細から追加したGoodsを含むCartの購入手続き（`UF-CRT-001`） |
| - **Trigger:** UserがGoodsと数量を選択して購入開始する | - **Trigger:** UserがGoodsを含むCartの購入手続きへ進み、購入開始する<br>&nbsp;<br>Goodsの購入開始は `UF-CRT-001`（Cart）を起点とする。CartにGoodsだけが含まれる場合は本Flowの全手順が適用される。Entry Ticketも含まれる場合は、本Flowと `UF-TKT-001` の該当手順を `UF-CRT-001` の複合Order規則に従って同一Orderに対して適用する。 |

### SPEC-040 / 20.1 Main Success Flow

| 旧仕様書 | 新仕様書 |
|---|---|
| 1. **User** はGoods一覧を閲覧し、商品・数量を選択する。 | 1. **User** はGoods一覧を閲覧し、商品・数量を選択してCartへ追加し、Cartから購入手続きへ進む。 |

### SPEC-040 / 30.2 Domain別確保状態

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Entry + Goods（複合） \| 全Entry Allocation `HELD` + 全Goods Allocation `HELD` + Goods Item `PENDING_PAYMENT`（全て成立するか何も成立しない） \| 全Entry Allocation `COMMITTED` + Entry Ticket `VALID` + 全Goods Allocation `COMMITTED` + Goods Item `FULFILLABLE`（全て成立するか何も成立しない） \| 全Allocation `RELEASED`（一括） \| |

### SPEC-040 / 31. Retry / Resume Decision Table

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Cartの再読込 / 再訪問 \| Yes \| Browser側Cartを再取得し、現在の価格・販売状態を表示し直す。Business effectなし \|<br>\| Cart購入開始で一部Itemが不成立となった後の再試行 \| No \| Orderが作成されていないため新しい購入開始。Allocationは残っていない \|<br>\| 複合Orderの支払前失敗・失効後の再購入 \| No \| 新しいAllocation群 + 新Order。Cartへの再投入は参照と数量のみで、現在状態で再検証 \| |

### SPEC-040 / 32. Flow別Traceability Matrix

| 旧仕様書 | 新仕様書 |
|---|---|
| \| `UF-PUB-001` \| FR-PUB-001〜011, 013〜014 \| BR-EVT-001〜004, BR-SAL-003〜005, BR-XFN-001〜004 \| - \| INV-010-08, 09 \| | \| `UF-PUB-001` \| FR-PUB-001〜011, 013〜015 \| BR-EVT-001〜005, BR-SAL-003〜005, BR-XFN-001〜004 \| - \| INV-010-08, 09 \| |
| （なし） | \| `UF-CRT-001` \| FR-CRT-001〜012, FR-PUB-012, FR-XFN-009, 016, 026〜029 \| BR-SAL-001〜008, BR-ORD-001〜020, BR-TKT-001〜011, BR-GDS-001〜013 \| DI-030-001〜004, 006, 009〜013 \| INV-010-01〜03, 06〜10 \| |

### SPEC-040 / 33.9a `FR-CRT-*`

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 33.9a `FR-CRT-*`<br>&nbsp;<br>- Cart、Cartからの購入開始、複合Order、All-or-Nothing: `UF-CRT-001`<br>- Cartからの購入開始におけるGuestの認証: `UF-PUB-002`<br>- Entry Ticket / Goods側の個別結果: `UF-TKT-001`, `UF-GDS-001`<br>&nbsp; |

### SPEC-040 / 33.10 `FR-XFN-*`

| 旧仕様書 | 新仕様書 |
|---|---|
| - Order / Payment / retry: `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003` | - Order / Payment / retry: `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-CRT-001`, `UF-XFN-001`, `UF-XFN-003` |

### SPEC-040 / 34. Business Rule Coverage

| 旧仕様書 | 新仕様書 |
|---|---|
| \| `BR-SAL-*` \| `UF-PUB-001`, `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001` \|<br>\| `BR-ORD-*` \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003`, `UF-XFN-004` \| | \| `BR-SAL-*` \| `UF-PUB-001`, `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-CRT-001` \|<br>\| `BR-ORD-*` \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-CRT-001`, `UF-XFN-001`, `UF-XFN-003`, `UF-XFN-004` \| |

### SPEC-040 / 35. Domain Invariant Coverage

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| `DI-030-013` Combined Order Atomicity \| Cart購入開始・確定・解放で、複合Orderの全Allocationと権利を全て成立させるか何も成立させない \| |

### SPEC-040 / 36. System Invariant Coverage

| 旧仕様書 | 新仕様書 |
|---|---|
| \| `INV-010-01` 購入情報を失わない \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-003〜004` \|<br>\| `INV-010-02` Orderを二重確定しない \| 購入3Flow, `UF-XFN-001`, `UF-XFN-003` \| | \| `INV-010-01` 購入情報を失わない \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-CRT-001`, `UF-XFN-003〜004` \|<br>\| `INV-010-02` Orderを二重確定しない \| 購入3Flow, `UF-CRT-001`, `UF-XFN-001`, `UF-XFN-003` \| |
| \| `INV-010-07` 決済確定と権利発行を中途半端に残さない \| 購入3Flow, `UF-XFN-001`, `UF-XFN-003` \| | \| `INV-010-07` 決済確定と権利発行を中途半端に残さない \| 購入3Flow, `UF-CRT-001`, `UF-XFN-001`, `UF-XFN-003` \| |
| \| `INV-010-09` 金額をClient入力だけで確定しない \| 購入3Flow \|<br>\| `INV-010-10` 外部処理の再送に耐える \| 購入3Flow, `UF-GDS-002`, `UF-CHK-*`, `UF-XFN-*` \| | \| `INV-010-09` 金額をClient入力だけで確定しない \| 購入3Flow, `UF-CRT-001` \|<br>\| `INV-010-10` 外部処理の再送に耐える \| 購入3Flow, `UF-CRT-001`, `UF-GDS-002`, `UF-CHK-*`, `UF-XFN-*` \| |

### SPEC-040 / 38. 実装上のFlow禁止事項

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cartの金額・在庫・販売可否・Ownerを権威値として購入開始する<br>- Cartへの追加・変更・削除で、Order、Allocation、Hold、Inventoryを変更する<br>- Karaoke SlotをCartへ入れる、またはEntry Ticket / GoodsとKaraokeを1つのOrderにまとめる<br>- Cart購入開始で一部のItemだけを確保して `PREPARED` Orderを作る、または確保途中のAllocationを残す<br>- 複合Orderで一部のItemの権利だけを有効権利として提供する |

### SPEC-040 / 39. 受入条件

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 29. Cart、Cartからの購入開始、Entry TicketとGoodsの複合Order、Karaokeの別Orderを扱うFlow（`UF-CRT-001`）があり、Cart購入開始のAll-or-Nothing、複合Orderの確定・解放、一部Item不成立時の扱いを区別している。<br>30. 公開情報閲覧でSponsor Logoを扱い、その取得失敗が他の公開情報を失敗扱いにしない。 |

## SPEC-050 Page and Screen Specification

- ファイル: `docs/specs/050-page-screen-specification.md`
- version: 1.0.0 → 1.2.0
- 変更: 37 章 / 66 箇所

### SPEC-050 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.0.0 | version: 1.2.0 |

### SPEC-050 / 1. 目的

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart画面と、共通Header / Footer（Sponsor Logo表示領域を含む）の表示仕様 |

### SPEC-050 / 2. 適用範囲

| 旧仕様書 | 新仕様書 |
|---|---|
| - Entry Ticket販売・購入開始 | - Entry Ticket販売・Cartへの追加 |
| - Goods一覧、Goods購入判断、購入開始 | - Goods一覧、Goods購入判断、Cartへの追加<br>- Cart（Entry TicketとGoodsの内容確認・編集と、1回の支払いへの購入手続き）<br>- 共通Header / Footer、Sponsor Logo表示 |

### SPEC-050 / 4. Canonical UI Terms

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Cart \| Entry Ticket OfferingとGoodsの参照と数量だけをBrowserに保持する購入前の補助。Business Databaseには保存せず、販売確保も行わない（`SPEC-030` §11.9） \|<br>\| Cart Item \| Cartに含まれる1件のEntry Ticket種別またはGoodsと数量 \|<br>\| Global Header / Global Footer \| 全一般利用者向けPageで共通に表示するHeaderとFooter \|<br>\| Sponsor Logo \| 運営が公開対象とした協賛ロゴ。共通Footerに表示する \| |

### SPEC-050 / 5.1 Route namespace

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart: `/cart` |

### SPEC-050 / 5.2 Identifier rule

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cartが保持するEntry Ticket OfferingおよびGoodsの参照は公開対象の参照であり、権限根拠にならない。 |

### SPEC-050 / 6. Page ID体系

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| `PG-CRT-*` \| Cart \| |

### SPEC-050 / 7. Page一覧

| 旧仕様書 | 新仕様書 |
|---|---|
| \| `PG-TKT-001` \| Entry Ticket Sales \| `/entry` \| Guest / Authenticated User \| 閲覧不要、購入開始は必要 \| `UF-PUB-001`, `UF-PUB-002`, `UF-TKT-001` \| | \| `PG-TKT-001` \| Entry Ticket Sales \| `/entry` \| Guest / Authenticated User \| 閲覧・Cart追加は不要 \| `UF-PUB-001`, `UF-CRT-001`, `UF-TKT-001` \| |
| \| `PG-GDS-002` \| Goods Detail / Purchase \| `/goods/{goods_ref}` \| Guest / Authenticated User \| 閲覧不要、購入開始は必要 \| `UF-PUB-002`, `UF-GDS-001` \| | \| `PG-GDS-002` \| Goods Detail / Cart追加 \| `/goods/{goods_ref}` \| Guest / Authenticated User \| 閲覧・Cart追加は不要 \| `UF-CRT-001`, `UF-GDS-001` \|<br>\| `PG-CRT-001` \| Cart \| `/cart` \| Guest / Authenticated User \| 閲覧・編集は不要、購入手続きは必要 \| `UF-CRT-001`, `UF-PUB-002`, `UF-TKT-001`, `UF-GDS-001` \| |
| \| `PG-XFN-001` \| Purchase Status \| `/purchase/orders/{order_ref}` \| Authenticated User / Customer \| 必要 \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003`, `UF-XFN-004` \| | \| `PG-XFN-001` \| Purchase Status \| `/purchase/orders/{order_ref}` \| Authenticated User / Customer \| 必要 \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-CRT-001`, `UF-XFN-001`, `UF-XFN-003`, `UF-XFN-004` \| |

### SPEC-050 / 8.1 Primary Navigation

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart: `PG-CRT-001` |

### SPEC-050 / 8.2 Guest表示

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart |

### SPEC-050 / 8.3 Authenticated User表示

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart |

### SPEC-050 / 8.4 Administrator / Staff境界

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | &nbsp;<br>### 8.5 Global Header / Global Footer<br>&nbsp;<br>**Global Header**<br>&nbsp;<br>- 全一般利用者向けPageで表示し、Pageをscrollしても到達できる固定表示とする。<br>- 少なくとも以下を含む: サイト名（`PG-PUB-001` へのLink）、Primary Navigation（§8.1）、Cart、Account / Login。Primary Navigationはメニューボタンの操作で開閉する形式で提供する（下記）。<br>- 主要CTA「チケットを購入する」を常時表示し、`PG-TKT-001` へ遷移する。GuestとAuthenticated Userの両方に同じCTAを表示する。<br>- Cartには、Cart内の合計数量を数字（テキスト）で示す。0件のときは数字を表示しない。数字は色や形状だけに依存せず、アクセシブルな名称でも伝える。<br>- Primary Navigation（Event、Entry Ticket、Karaoke、Goods）は、Mobile・Desktopを問わず、メニューボタンを操作したときに開き、そこから選択できる形式にする。メニューは常時展開しない。<br>- メニューボタンは、開閉状態をプログラム上で伝え（`aria-expanded` 相当）、Keyboardで開閉でき、Escape等で閉じられ、閉じた後はメニューボタンへFocusを戻す。選択またはPage遷移でメニューを閉じる。メニューの項目はNavigationであり、Linkとして提供する（§25）。Drawer等のDialogを使用する場合は§25のDialog / Drawer要件を満たす。<br>- Cart、主要CTA、Login / Mypageはメニュー内に隠さず、Header上に常時表示する。Flow完遂に必要な到達性を失わせない。<br>- サイト名のLinkは `PG-PUB-001` へ遷移する。すでに `PG-PUB-001` を表示している場合は、Pageの先頭へscrollする。<br>&nbsp;<br>**Floating Ticket Button**<br>&nbsp;<br>- 全一般利用者向けPageのうち、`PG-TKT-001`、`PG-CRT-001`、Authentication Page（`PG-AUTH-*`）、Mypage（`PG-MYP-*`）、`PG-XFN-001` を除くPageで、画面の右下に固定表示し、Pageをscrollしても追従する。<br>- Linkであり、`PG-TKT-001` へ遷移する。Global Headerの主要CTAを置き換えず、補助として併存する。<br>- ラベルは主要CTAとは別に定義する。表示の見た目と文言は差し替え可能にし、本書では文言を固定しない。<br>- 他のContent・Footer・Sponsor Logo領域・操作要素を覆って到達不能にしない。Mobileではsafe areaを考慮する。<br>- Administrator / Staffの運用領域、開発用領域では表示しない。<br>&nbsp;<br>**Global Footer**<br>&nbsp;<br>- 全一般利用者向けPageで表示する。<br>- 少なくとも以下を含む: Event名称、Primary Navigation相当のLink、Sponsor Logo領域。<br>- Administrator / Staffの運用領域へのEntry Pointは§8.4に従う。<br>&nbsp;<br>**Sponsor Logo領域**<br>&nbsp;<br>- `PUBLISHED` のSponsor Logoだけを、運営が設定した表示順に表示する（`BR-EVT-005`）。<br>- 各Logoは表示名称をアクセシブルな名称（代替テキスト）として持つ。リンク先が設定されている場合は、外部へ遷移するLinkであることが利用者に分かるようにする。<br>- 公開対象が0件の場合、Sponsor Logo領域を表示しない。<br>- 取得に失敗した場合、Sponsor Logo領域を表示せず、「協賛なし」等の0件を示す表示にしない。他のContentとNavigationの表示・操作を妨げない。<br>- Logo画像が読み込めない場合は表示名称をテキストで表示する。<br>&nbsp;<br>Trace: `FR-PUB-011`, `FR-PUB-014〜015`, `FR-CRT-001`, `BR-EVT-005`, `UF-PUB-001`, `UF-CRT-001`. |

### SPEC-050 / 10.1 Guestが認証必須Actionを開始した場合

| 旧仕様書 | 新仕様書 |
|---|---|
| GuestがEntry / Karaoke / Goods購入、Mypage等の認証必須Actionを開始した場合、`PG-AUTH-003` Loginまたは `PG-AUTH-001` Account Registrationへ遷移する。 | GuestがCartからの購入手続き、Karaoke購入、Mypage等の認証必須Actionを開始した場合、`PG-AUTH-003` Loginまたは `PG-AUTH-001` Account Registrationへ遷移する。Cartへの追加・数量変更・削除・閲覧はGuestにも許可する認証不要のActionであり、認証要求の対象ではない。 |

### SPEC-050 / 10.2 Continuation Intent

| 旧仕様書 | 新仕様書 |
|---|---|
| - Entry Ticket購入 → `PG-TKT-001` の対象Offering選択へ復帰 | - Cartの購入手続き（Entry Ticket / Goods） → `PG-CRT-001` へ復帰。Cart内容（参照と数量）はBrowser側のCartに保持され、Continuation Intentには含めない |
| - Goods購入 → `PG-GDS-002` の対象Goodsへ復帰 | （なし） |

### SPEC-050 / 10.3 Unsafe continuationの禁止

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cartに保持された価格・在庫・販売可否 |

### SPEC-050 / 11.1 `PG-PUB-001` Event Home

| 旧仕様書 | 新仕様書 |
|---|---|
| **Main Content** | **Main Content（上から順に配置する）** |
| 1. Event概要Section | 1. Hero Section<br>   - Event名称<br>   - 開催日時の要約（設定済み開催日時または開催期間。表示Timezoneは `Asia/Tokyo`）<br>   - 会場名称<br>   - 主要CTA「チケットを購入する」 → `PG-TKT-001`<br>   - Key Visual等の装飾画像はデザイン素材であり、任意とする。素材が未設定または取得できない場合も、文字情報だけでHero Sectionが成立する。<br>2. 最新Announcement Section（NEWS）<br>   - `PUBLISHED` Announcementの新しいものを、公開日付き、少数件で抜粋<br>   - 「すべて見る」 → `PG-PUB-002`<br>3. Sales Shortcut<br>   - Entry Ticket<br>   - Karaoke<br>   - Goods<br>4. Event概要Section |
| 2. 開催日時Section | 5. 開催日時Section |
| 3. 会場・アクセスSection | 6. 会場・アクセスSection |
| 4. 注意事項Section | 7. 注意事項Section |
| 5. FAQ Section | 8. FAQ Section |
| 6. 最新Announcement Section<br>   - `PUBLISHED` Announcementの新しいものを抜粋<br>   - `PG-PUB-002` への導線<br>7. Sales Shortcut<br>   - Entry Ticket<br>   - Karaoke<br>   - Goods | &nbsp;<br>Sponsor Logoは共通Footer（§8.5）に表示し、本Page固有のSectionとして重複配置しない。Section順序と必須要素は本書で固定し、色・書体・余白・装飾等の視覚表現は固定しない（§24.3）。 |
| （なし） | - チケットを購入する → `PG-TKT-001`（Hero Section。Global Headerの主要CTAと同じ遷移先） |
| - Error: Event基本情報取得FailureはPage-level error。FAQ / Announcement等の部分取得失敗はSection-level errorにして他の正常Sectionを保持してよい。 | - Error: Event基本情報取得FailureはPage-level error。FAQ / Announcement等の部分取得失敗はSection-level errorにして他の正常Sectionを保持してよい。Sponsor Logoの取得失敗は§8.5に従う。 |
| **Trace:** `FR-PUB-001〜006`, `FR-PUB-011`, `FR-PUB-013〜014`, `BR-EVT-001〜004`, `BR-XFN-001`, `UF-PUB-001`, `INV-010-08`. | **Trace:** `FR-PUB-001〜006`, `FR-PUB-011`, `FR-PUB-013〜015`, `BR-EVT-001〜005`, `BR-XFN-001`, `UF-PUB-001`, `INV-010-08`. |

### SPEC-050 / 12.1 `PG-TKT-001` Entry Ticket Sales

| 旧仕様書 | 新仕様書 |
|---|---|
| - **Auth:** 閲覧不要、購入開始はAuthenticated Userのみ<br>- **対応UF:** `UF-PUB-001`, `UF-PUB-002`, `UF-TKT-001`<br>- **Purpose:** Entry Ticketの購入判断、種別・数量選択、購入開始を行う。 | - **Auth:** 閲覧・Cart追加は不要。購入手続きは `PG-CRT-001` でAuthenticated Userのみ<br>- **対応UF:** `UF-PUB-001`, `UF-CRT-001`, `UF-TKT-001`<br>- **Purpose:** Entry Ticketの購入判断、種別・数量選択、Cartへの追加を行う。 |
| \| 条件 \| 利用者向け表示 \| Purchase Action \| | \| 条件 \| 利用者向け表示 \| Cart追加Action \| |
| \| Sales Period内 + `ENABLED` + capacityあり \| 販売中 \| GuestはLoginへ、Authenticated UserはEnabled \| | \| Sales Period内 + `ENABLED` + capacityあり \| 販売中 \| Guest・Authenticated UserともEnabled \| |
| - `購入手続きへ進む`<br>  - Guest: `PG-AUTH-003` へ。Continuation IntentとしてEntry購入へ戻す。<br>  - Authenticated User: Server-side再検証とAllocation / Order作成を開始する。 | - `Cartに追加`: 選択した種別・数量をBrowser側のCartへ追加する。GuestもAuthenticated Userも利用できる。<br>- `Cartを見る` → `PG-CRT-001` |
| **Action実行中** | **Cart追加の結果** |
| - Buttonを処理中状態にする。<br>- 「購入条件を確認しています」「購入試行を作成しています」等、未確定表示を行う。<br>- reload / double clickで複数Orderが無条件に作られない前提でUIも重複送信を抑止する。<br>&nbsp;<br>**Purchase start result**<br>&nbsp;<br>- 成功してOrder `PREPARED` が作成された場合、`PG-XFN-001` へ遷移するか、そのOrderに対応するCheckout開始へ進む。外部Checkoutへ移る直前は「支払い画面を準備中」であり、購入成功表示をしない。<br>- Sales Period / Sale Control / capacity / Purchase Limit再検証失敗: 同Pageで現在結果を表示し、選択を更新可能にする。<br>- Allocation競合 / 売り切れ: 「表示後に販売可能数が変わった」ことを識別できるFailure。再読込または数量変更。<br>- Checkout開始前のOrder作成Failure: 外部Checkoutへ進めない。<br>- Checkout開始失敗かつOrder `PREPARED` が存在: `PG-XFN-001` で同一Order retryを提供する。 | - Cart追加はBrowser側のCartへの追加であり、販売確保も購入成立も意味しない。成功時は「Cartに追加しました。購入はまだ確定していません」と示し、Cartを見る導線を提供する。追加結果は状態変化の通知として支援技術にも伝える（§25）。<br>- 購入可否・容量・Purchase Limitは、購入手続き（`PG-CRT-001`）でServer-sideが再検証する。本Pageの表示を購入保証として扱わない。<br>- 数量Selectorの入力検証（正の整数、案内された上限を超えない）は本Pageで行ってよいが、最終判定はServer-sideである。<br>- 購入手続きと、Allocation / Orderの作成、Checkout開始、その失敗表示は `PG-CRT-001` と `PG-XFN-001` が扱う。 |
| **Trace:** `FR-PUB-007`, `FR-PUB-010`, `FR-PUB-012`, `FR-TKT-001〜010`, `FR-TKT-025〜026`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜007`, `BR-ORD-001〜004`, `BR-TKT-001〜004`, `DI-030-001`, `DI-030-004`, `DI-030-010〜012`, `UF-PUB-002`, `UF-TKT-001`, `INV-010-01`, `INV-010-08〜10`. | **Trace:** `FR-PUB-007`, `FR-PUB-010`, `FR-CRT-001`, `FR-CRT-003〜005`, `FR-TKT-001〜010`, `FR-TKT-025〜026`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜007`, `BR-ORD-001〜004`, `BR-TKT-001〜004`, `DI-030-001`, `DI-030-004`, `DI-030-010〜012`, `UF-CRT-001`, `UF-TKT-001`, `INV-010-01`, `INV-010-08〜10`. |

### SPEC-050 / 14.2 `PG-GDS-002` Goods Detail / Cart追加

| 旧仕様書 | 新仕様書 |
|---|---|
| ### 14.2 `PG-GDS-002` Goods Detail / Purchase | ### 14.2 `PG-GDS-002` Goods Detail / Cart追加 |
| - **Auth:** 閲覧不要、購入開始は必要<br>- **対応UF:** `UF-PUB-002`, `UF-GDS-001`<br>- **Purpose:** Goods詳細、数量選択、購入開始を行う。 | - **Auth:** 閲覧・Cart追加は不要。購入手続きは `PG-CRT-001` でAuthenticated Userのみ<br>- **対応UF:** `UF-CRT-001`, `UF-GDS-001`<br>- **Purpose:** Goods詳細、数量選択、Cartへの追加を行う。 |
| \| 条件 \| 表示 \| Purchase Action \| | \| 条件 \| 表示 \| Cart追加Action \| |
| \| 販売中 + 在庫確保可能 \| 購入可能 \| Guest: Login、Authenticated: Enabled \| | \| 販売中 + 在庫確保可能 \| 購入可能 \| Guest・Authenticated UserともEnabled \| |
| **Purchase start / Conflict** | **Primary Action** |
| - 購入開始時にServer-sideで販売条件とInventoryを再検証する。<br>- Inventory競合でAllocationを取得できなければ、「在庫状況が変わり、選択数量を確保できない」と表示する。<br>- Allocation `HELD` + Order `PREPARED` 後にCheckout開始する。<br>- Checkout開始失敗は同一 `PREPARED` Orderを `PG-XFN-001` で扱う。 | - `Cartに追加`: 選択した数量をBrowser側のCartへ追加する。GuestもAuthenticated Userも利用できる。<br>- `Cartを見る` → `PG-CRT-001`<br>&nbsp;<br>**Cart追加の結果**<br>&nbsp;<br>- Cart追加はBrowser側のCartへの追加であり、在庫確保も購入成立も意味しない。成功時は「Cartに追加しました。購入はまだ確定していません」と示し、Cartを見る導線を提供する。追加結果は支援技術にも伝える（§25）。<br>- 販売条件とInventoryは、購入手続き（`PG-CRT-001`）でServer-sideが再検証する。Inventory競合でAllocationを取得できない場合の表示は `PG-CRT-001` が扱う。 |
| **Trace:** `FR-GDS-001〜008`, `FR-GDS-011`, `FR-GDS-016〜017`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜008`, `BR-ORD-001〜004`, `BR-GDS-001〜006`, `BR-GDS-009`, `DI-030-001`, `DI-030-006`, `DI-030-010〜012`, `UF-GDS-001`, `INV-010-01`, `INV-010-08〜10`. | **Trace:** `FR-GDS-001〜008`, `FR-GDS-011`, `FR-GDS-016〜017`, `FR-CRT-001`, `FR-CRT-003〜005`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜008`, `BR-ORD-001〜004`, `BR-GDS-001〜006`, `BR-GDS-009`, `DI-030-001`, `DI-030-006`, `DI-030-010〜012`, `UF-GDS-001`, `INV-010-01`, `INV-010-08〜10`.<br>&nbsp;<br>## 14A. Cart Page<br>&nbsp;<br>### 14A.1 `PG-CRT-001` Cart<br>&nbsp;<br>- **Route:** `/cart`<br>- **Actor:** Guest / Authenticated User<br>- **Auth:** Cartの閲覧・編集は不要。購入手続きはAuthenticated Userのみ<br>- **対応UF:** `UF-CRT-001`, `UF-PUB-002`, `UF-TKT-001`, `UF-GDS-001`<br>- **Purpose:** Browser側に保持したEntry TicketとGoodsの内容を確認・編集し、1回の支払いへ購入手続きを開始する。<br>&nbsp;<br>**Fields per Cart Item**<br>&nbsp;<br>- 種別（Entry Ticket / Goods）<br>- 名称<br>- Server-sideで取得した現在の単価と通貨<br>- 数量Selector<br>- 明細小計（表示用）<br>- 現在の販売状態と購入不可理由<br>- 削除Action<br>&nbsp;<br>**Summary**<br>&nbsp;<br>- 表示用の合計金額。「購入時の金額はServer-sideで再計算される」ことを示す。<br>- Entry TicketとGoodsは1回の支払いにまとめられること。<br>&nbsp;<br>**Karaoke案内**<br>&nbsp;<br>Karaokeはカートに入れられず、Slotごとに別の購入・別の支払いになることを示し、`PG-KRK-001` への導線を提供する。Karaoke SlotをCartへ追加するActionを提供しない。<br>&nbsp;<br>**Cart Itemの購入不可理由**<br>&nbsp;<br>\| 条件 \| 表示 \| Itemの扱い \|<br>\|---\|---\|---\|<br>\| Sales Period開始前 \| 販売開始前 \| 購入不可 \|<br>\| Sales Period終了 \| 販売終了 \| 購入不可 \|<br>\| Sale Control `SUSPENDED` \| 販売停止 \| 購入不可 \|<br>\| capacity / 在庫0 \| 売り切れ \| 購入不可 \|<br>\| 選択数量を確保できない \| 数量不足。数量変更を促す \| 購入不可 \|<br>\| Purchase Limit超過 \| 購入上限により購入不可 \| 購入不可 \|<br>\| 現在状態の取得Failure \| 状態を確認できない \| 購入不可。購入可能と表示しない \|<br>&nbsp;<br>**Actions**<br>&nbsp;<br>- 数量変更: 同Page内で行う。Business effectを作らない。数量の下限は1とし、数量を0にする代わりに削除Actionを使う。<br>- 削除: Cart ItemをCartから除く。Business effectを作らない。<br>- `購入手続きへ進む`<br>  - Enabled条件: Cartが1件以上で、全Itemが購入可能と表示されている。購入不可Itemがある間はDisabledとし、理由と削除または数量変更の案内を周辺Textで示す。<br>  - Guest: `PG-AUTH-003` へ。Continuation Intentとして `PG-CRT-001` へ戻す。Cart内容は保持する。<br>  - Authenticated User: Server-sideで全Itemを再検証し、全Itemが成立した場合のみAllocation確保とOrder `PREPARED` の作成を行う（`BR-ORD-014`）。<br>- 商品へ戻る → `PG-TKT-001` / `PG-GDS-001`<br>&nbsp;<br>**State**<br>&nbsp;<br>- Loading: 各Itemの現在状態を取得中であることを示す。確定値に見える金額を仮表示しない。<br>- Empty: Cartが0件のときだけ「カートは空です」と表示し、`PG-TKT-001` / `PG-GDS-001` への導線を提供する。現在状態の取得Failureを空のCartとして表示しない。<br>- Failure: 現在状態を取得できないことを示し、Itemを購入可能と表示せず、再取得を提供する。<br>&nbsp;<br>**Purchase start result**<br>&nbsp;<br>- 成功してOrder `PREPARED` が作成された場合、当該OrderのItemをCartから除去し、`PG-XFN-001` へ遷移するか、そのOrderに対応するCheckout開始へ進む。外部Checkoutへ移る直前は「支払い画面を準備中」であり、購入成功表示をしない。<br>- 一部のItemが成立しない場合（販売終了、停止、売り切れ、数量不足、Purchase Limit超過、Allocation競合）: Orderは作成されていないこと、「購入は開始されていません」、成立しなかったItemと理由を示す。Cart内容を保持し、数量変更・削除を可能にする。<br>- Checkout開始前のOrder作成Failure: 外部Checkoutへ進めない。Cart内容を保持する。<br>- Checkout開始失敗かつOrder `PREPARED` が存在: `PG-XFN-001` で同一Order retryを提供する。<br>- Action実行中: Buttonを処理中状態にし、「購入条件を確認しています」「購入試行を作成しています」等、未確定表示を行う。reload / double clickで複数Orderが無条件に作られない前提でUIも重複送信を抑止する。<br>&nbsp;<br>**Cartの保持**<br>&nbsp;<br>- CartはBrowserに保持され、Accountに紐づかない。Browserのデータ消去等で失われ得るが、作成済みのOrder・Allocation・権利には影響しない。<br>- Cartには参照と数量だけを保持し、価格・在庫・販売可否・Owner・個人情報・Secretを保持しない（`FR-CRT-003`）。<br>&nbsp;<br>**Security Boundary:** Cartの内容と表示金額は権威値ではない。購入手続きの認可・再検証・金額決定はServer-sideで行う。<br>&nbsp;<br>**Trace:** `FR-CRT-001〜012`, `FR-PUB-012`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜007`, `BR-ORD-001〜004`, `BR-ORD-013〜020`, `DI-030-001`, `DI-030-004`, `DI-030-006`, `DI-030-011〜013`, `UF-CRT-001`, `UF-PUB-002`, `INV-010-01`, `INV-010-07`, `INV-010-09〜10`. |

### SPEC-050 / 16.2 Main Fields

| 旧仕様書 | 新仕様書 |
|---|---|
| - Order purpose: Entry / Karaoke / Goods | - Order purpose: Entry / Karaoke / Goods / Entry + Goods（複合） |

### SPEC-050 / 16.4 Order State別UI

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | Entry Ticket、Goods、またはその複合Orderの `PAYMENT_FAILED` / `CANCELED` / `EXPIRED` における「もう一度購入する」は、Orderに含まれていたItemの参照と数量をCartへ再投入して `PG-CRT-001` へ遷移する。再投入は新Orderを作らず、価格・販売状態・在庫は現在状態で表示し直す。Karaokeの「もう一度購入する」は新Slot / Hold取得（Slot選択）から開始する。<br>&nbsp; |

### SPEC-050 / 16.5 Domain-specific `CONFIRMED` content

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | **Entry + Goods（複合）**<br>&nbsp;<br>- Order `CONFIRMED`<br>- Entry Ticket（購入数量分）へのLinkと、Goods Order Item（`FULFILLABLE`）およびGoods Handoff stateを同じ画面で区別して表示する。<br>- Entry TicketとGoodsの両方が成立している場合だけ表示する。一部のItemだけを有効権利として表示しない（`BR-ORD-015`）。`CONFIRMED` 以外では、どのItemも有効権利として表示しない。<br>&nbsp; |

### SPEC-050 / 16.8 Ownership failure

| 旧仕様書 | 新仕様書 |
|---|---|
| **Trace:** `FR-TKT-010〜023`, `FR-KRK-015〜027`, `FR-GDS-007〜015`, `FR-MYP-007〜010`, `FR-EML-002〜011`, `FR-XFN-009〜013`, `FR-XFN-017`, `FR-XFN-019〜021`, `FR-XFN-027〜029`, `FR-XFN-032`, `BR-ORD-001〜012`, `BR-TKT-005〜010`, `BR-KRK-007〜024`, `BR-GDS-004〜013`, `BR-NTF-001〜006`, `DI-030-001〜003`, `DI-030-007〜012`, `UF-XFN-001〜004`, `INV-010-01〜10` のうち当該Purposeに適用されるもの。 | **Trace:** `FR-TKT-010〜023`, `FR-KRK-015〜027`, `FR-GDS-007〜015`, `FR-CRT-007〜011`, `FR-MYP-007〜010`, `FR-EML-002〜011`, `FR-XFN-009〜013`, `FR-XFN-017`, `FR-XFN-019〜021`, `FR-XFN-027〜029`, `FR-XFN-032`, `BR-ORD-001〜012`, `BR-TKT-005〜010`, `BR-KRK-007〜024`, `BR-GDS-004〜013`, `BR-NTF-001〜006`, `DI-030-001〜003`, `DI-030-007〜012`, `UF-XFN-001〜004`, `INV-010-01〜10` のうち当該Purposeに適用されるもの。 |

### SPEC-050 / 18.4 `PG-MYP-004` Order Detail

| 旧仕様書 | 新仕様書 |
|---|---|
| - 購入対象明細 | - 購入対象明細（複合Orderでは、Entry TicketとGoodsの明細を区別して表示する） |

### SPEC-050 / 21. Pending / Failure / Retry UX Matrix

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| Cart内Itemが購入不可 \| Item単位の購入不可理由 \| 数量変更 / 削除 \| 購入可能と表示、購入手続きを有効化 \|<br>\| Cart購入開始で一部Item不成立 \| 購入開始未成立（Order未作成） + 不成立Itemと理由 \| Item見直し / 再試行 \| 一部のItemだけのOrder作成、確保途中のAllocation \|<br>\| Cart現在状態の取得Failure \| 状態を確認できない \| 再取得 \| 空のCart表示、購入可能と表示 \|<br>\| Cartが空 \| カートは空です \| 商品選択へ \| 取得失敗との混同 \| |

### SPEC-050 / 22. Browser Reload / Back / Revisit

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - `PG-CRT-001` のreloadはBrowser側のCartを再取得し、現在の価格・販売状態を表示し直す。新Orderを作らない。 |

### SPEC-050 / 24.1 Breakpoint非依存要件

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cart内容の確認、数量変更、削除、購入手続き、購入不可理由の確認を完遂可能。<br>- Global Headerの主要CTAとCartをMobileでも到達可能にする（§8.5）。 |

### SPEC-050 / 24.2 QR表示

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | &nbsp;<br>### 24.3 表示表現の差し替え容易性<br>&nbsp;<br>視覚表現は、本書が定めるPage構成、Section順序、Canonical State、Actionの意味を変えずに差し替えられなければならない。<br>&nbsp;<br>- 色、書体、余白、角丸、装飾、Hero背景やKey Visualなどのデザイン素材を変更しても、Page構成、Section順序、Canonical Stateに対応する表示の意味、Action、Accessibility要件（§25）は変わらない。<br>- デザイン素材（装飾画像、ロゴ、背景等）はBusiness Domain Dataではない。素材が未設定または取得できない場合も、情報Sectionと購入Flowを表示・完遂できる。<br>- Canonical Stateの表示意味（例: Order State、Ticket State）は、色や形状だけに依存せずText labelを併用する（§25）。 |

### SPEC-050 / 25. Accessibility仕様

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Section見出し（Heading level 2 / 3）は、画面内に表示された際にフェードインしてよい。演出は、JavaScriptが無効でも、動きの軽減を設定した利用者（`prefers-reduced-motion`）でも、見出しを最初から表示する。見出しはDOM上に常に存在し、演出の有無で読み上げ・Focus順序・Heading hierarchyを変えない。 |

### SPEC-050 / 26.4 Cart

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 26.4 Cart<br>&nbsp;<br>- Cartには参照と数量だけを保持し、価格・金額・在庫・販売可否・Owner・Role・個人情報・Secretを保持しない。<br>- Cartに表示する金額は表示用であり、購入時の金額はServer-sideで再計算される。<br>- Cartの内容を知っていること、またはCartの内容をそのまま送信することを、購入成立・権限・販売可否の根拠にしない。<br>&nbsp; |

### SPEC-050 / 28. Traceability Matrix — Page to User Flow

| 旧仕様書 | 新仕様書 |
|---|---|
| \| `PG-TKT-001` \| `UF-PUB-001`, `UF-PUB-002`, `UF-TKT-001` \| | \| `PG-TKT-001` \| `UF-PUB-001`, `UF-CRT-001`, `UF-TKT-001` \| |
| \| `PG-GDS-002` \| `UF-PUB-002`, `UF-GDS-001` \| | \| `PG-GDS-002` \| `UF-CRT-001`, `UF-GDS-001` \|<br>\| `PG-CRT-001` \| `UF-CRT-001`, `UF-PUB-002`, `UF-TKT-001`, `UF-GDS-001` \|<br>\| Global Header / Footer \| `UF-PUB-001`, `UF-CRT-001` \| |
| \| `PG-XFN-001` \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003〜004` \| | \| `PG-XFN-001` \| `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-CRT-001`, `UF-XFN-001`, `UF-XFN-003〜004` \| |

### SPEC-050 / 29.1 Public

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - `FR-PUB-014〜015` → Global Header / Footer（§8.5） |

### SPEC-050 / 29.3 Entry Ticket

| 旧仕様書 | 新仕様書 |
|---|---|
| - `FR-TKT-001〜010`, `FR-TKT-025〜026` → `PG-TKT-001` | - `FR-TKT-001〜006`, `FR-TKT-025〜026` → `PG-TKT-001`、`PG-CRT-001`<br>- `FR-TKT-007〜010` → `PG-CRT-001`、`PG-XFN-001` |

### SPEC-050 / 29.8 Cart / 複合購入

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 29.8 Cart / 複合購入<br>&nbsp;<br>- `FR-CRT-001〜005`, `FR-CRT-012` → `PG-CRT-001`、`PG-TKT-001`、`PG-GDS-002`、Global Header（§8.5）<br>- `FR-CRT-006` → `PG-CRT-001`、`PG-AUTH-003`（Continuation Intent）<br>- `FR-CRT-007〜008`, `FR-CRT-011` → `PG-CRT-001`<br>- `FR-CRT-009〜010` → `PG-XFN-001`、`PG-MYP-004`<br>- `BR-ORD-013〜020`, `DI-030-013` → `PG-CRT-001`、`PG-XFN-001`<br>&nbsp; |

### SPEC-050 / 30. System Invariant UI Coverage

| 旧仕様書 | 新仕様書 |
|---|---|
| \| `INV-010-07` 決済確定と権利発行を中途半端に残さない \| `AWAITING_PAYMENT` / `REVIEW_REQUIRED` をSuccessにしない \| | \| `INV-010-07` 決済確定と権利発行を中途半端に残さない \| `AWAITING_PAYMENT` / `REVIEW_REQUIRED` をSuccessにしない。複合Orderの一部Itemだけを有効権利として表示しない \| |
| \| `INV-010-09` 金額をClient入力だけで確定しない \| UI合計は表示用であり購入時Server-side金額を再取得する \| | \| `INV-010-09` 金額をClient入力だけで確定しない \| UI合計・Cart小計は表示用であり購入時Server-side金額を再取得する \| |

### SPEC-050 / 31. E2E観点の最低Page Acceptance

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 24. GuestがEntry TicketとGoodsをCartへ追加し、数量変更・削除でき、購入手続きでLoginへ進み、認証後にCartへ復帰して内容が保持される。<br>25. Cartが各Itemの購入不可理由を区別して表示し、購入不可Itemがある間は購入手続きを有効にしない。<br>26. Cartの購入開始でいずれかのItemが成立しない場合、Orderが作成されず、Cart内容が保持され、成立しなかったItemと理由が示される。<br>27. Entry TicketとGoodsを含む複合Orderの `CONFIRMED` で、Entry TicketとGoodsの両方を確認できる。`AWAITING_PAYMENT` / `REVIEW_REQUIRED` ではどちらも有効権利として表示しない。<br>28. Karaoke SlotをCartへ追加できず、Cartに「Karaokeは別購入・別支払い」の案内が表示される。<br>29. Global Headerの主要CTAとCartが全Pageから到達でき、Sponsor Logoは `PUBLISHED` のみ表示され、0件なら領域が表示されず、取得失敗でも他のContentが操作できる。 |

### SPEC-050 / 33. 実装禁止事項

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - Cartの金額・在庫・販売可否・Ownerを権威値として購入開始する<br>- Cartへの追加・変更・削除をもって、販売確保または購入成立と表示する<br>- Karaoke SlotをCartへ追加できるUIを提供する、またはKaraokeをEntry Ticket / Goodsと同じOrderにまとめる<br>- Cart購入開始で一部のItemだけのOrderを作る、または確保途中のAllocationを残す<br>- 複合Orderで一部のItemだけを有効権利として表示する<br>- Cartの現在状態の取得Failureを空のCartとして表示する、またはItemを購入可能と表示する<br>- Sponsor Logoの取得失敗を理由に他の公開Contentの表示・操作を妨げる、または公開対象でないSponsor Logoを表示する |

### SPEC-050 / 34. 受入条件

| 旧仕様書 | 新仕様書 |
|---|---|
| 7. Entry Ticket購入の販売条件、数量、購入開始、Checkout開始失敗、Browser Return、7つのOrder State、Ticket / QR、Order / Receipt導線がPageへ対応している。 | 7. Entry Ticket購入の販売条件、数量、Cart追加、購入手続き（`PG-CRT-001`）での購入開始、Checkout開始失敗、Browser Return、7つのOrder State、Ticket / QR、Order / Receipt導線がPageへ対応している。 |
| （なし） | 26. Cart Page（`PG-CRT-001`）があり、Entry TicketとGoodsの追加、数量変更、削除、現在状態の表示、購入不可理由、購入手続きが定義されている。<br>27. Entry TicketとGoodsの購入開始がCart経由であり、Karaokeはカートに入らず別Orderとして購入する。<br>28. Cart購入開始の一部Item不成立でOrderを作らず、Cart内容を保持する表示が定義されている。<br>29. 複合Orderの `CONFIRMED` 内容と、`CONFIRMED` 以外で一部ItemだけをSuccessにしない表示が定義されている。<br>30. Global Header / Footer、主要CTA、Sponsor Logo表示、デザイン表現の差し替え容易性（§24.3）が定義されている。 |

## SPEC-070 Order and Payment Specification

- ファイル: `docs/specs/070-order-payment-specification.md`
- version: 1.0.0 → 1.1.0
- 変更: 7 章 / 9 箇所

### SPEC-070 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.0.0 | version: 1.1.0 |

### SPEC-070 / 2. 適用範囲

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | - `ENTRY_GOODS_PURCHASE`（Entry TicketとGoodsを含む複合Order。`SPEC-030` §11.9） |
| 本書のPaymentはStripe Checkoutによる一回払いだけを対象とする。Subscription、分割払い、Cross-domain cart、独自カード入力画面、Browser側でのPayment confirmationは対象外である。 | 本書のPaymentはStripe Checkoutによる一回払いだけを対象とする。Subscription、分割払い、Karaokeを含むCross-domain cart、独自カード入力画面、Browser側でのPayment confirmationは対象外である。 |

### SPEC-070 / 7. Order Customer / Purpose / Amount Authority

| 旧仕様書 | 新仕様書 |
|---|---|
| **PAY-ORD-004:** Order Purposeは作成時に `ENTRY_TICKET_PURCHASE` / `KARAOKE_PURCHASE` / `GOODS_PURCHASE` のいずれか1つとして確定し、作成後に変更しない。 | **PAY-ORD-004:** Order Purposeは作成時にServer-sideが含まれるOrder Itemから決定し、`ENTRY_TICKET_PURCHASE` / `KARAOKE_PURCHASE` / `GOODS_PURCHASE` / `ENTRY_GOODS_PURCHASE` のいずれか1つとして確定し、作成後に変更しない。Clientが指定したPurposeを採用してはならない。`KARAOKE_PURCHASE` のOrderはEntry Ticket / Goods Order Itemを含まない。 |

### SPEC-070 / 8. Stripe Payment構成

| 旧仕様書 | 新仕様書 |
|---|---|
| - promotion code、subscription、installment、cross-domain cartは本仕様のPayment capabilityに含めない | - promotion code、subscription、installment、Karaokeを含むcross-domain cartは本仕様のPayment capabilityに含めない |

### SPEC-070 / 24. Goods confirmation

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | &nbsp;<br>### 24.1 Entry TicketとGoodsの複合Order confirmation<br>&nbsp;<br>`ENTRY_GOODS_PURCHASE` のBusiness Confirmationでは、§22の全項目（対象Entry Ticket Order Itemの数だけ）と§24の全項目（対象Goods Order Itemの数だけ）を、同一のtransaction境界で一貫して成立させ、最後にOrder `AWAITING_PAYMENT -&gt; CONFIRMED` または `REVIEW_REQUIRED -&gt; CONFIRMED` とする。<br>&nbsp;<br>**PAY-CFM-012:** 複合OrderでEntry Ticket側またはGoods側のいずれかが§22または§24の条件を満たせない場合、他方だけを通常成功として確定せず、Order全体を通常 `CONFIRMED` にしない。支払済みの場合はRecoveryへ送る（PAY-CFM-004、PAY-CFM-006、PAY-CFM-010の適用）。<br>&nbsp;<br>**PAY-CFM-013:** 複合Orderが支払前に取消、失効、支払不成立となる場合、当該Orderに属する全てのEntry Sales AllocationとGoods Sales Allocationを一括して解放する。一部のAllocationだけを `HELD` のまま残してはならない（`BR-ORD-016`）。<br>&nbsp;<br>**PAY-CFM-014:** 複合Orderでも、Stripe Checkoutのline itemはOrder Item Snapshotから生成し、`amount_total` はEntry TicketとGoodsの全Order Itemの合計と一致しなければならない（PAY-ORD-009）。 |

### SPEC-070 / 51. Order / Payment Rule Traceability

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | \| `PAY-CFM-012〜014` \| `FR-CRT-007〜010`, `BR-ORD-013〜018`, `UF-CRT-001`, `PG-CRT-001`, `DI-030-009`, `DI-030-013`, `INV-010-07`, `INV-010-10` \| |

### SPEC-070 / 54. Acceptance Criteria

| 旧仕様書 | 新仕様書 |
|---|---|
| 3. Order Purposeは作成後不変である。 | 3. Order PurposeはServer-sideが決定し、4値のいずれかであり、作成後不変である。 |
| 16. Order `CONFIRMED` とPurpose必須Domain effectが一貫して成立する。 | 16. Order `CONFIRMED` とPurpose必須Domain effectが一貫して成立する。複合Orderでは、Entry TicketとGoodsの両方のDomain effectが全て成立するか、いずれも通常確定として成立しない。 |

## SPEC-100 Database Design

- ファイル: `docs/specs/100-database-design.md`
- version: 1.0.0 → 1.0.1
- 変更: 2 章 / 2 箇所

### SPEC-100 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.0.0 | version: 1.0.1 |

### SPEC-100 / 未反映のUCR（`SPEC-050` v1.1.0 に伴う要求）

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 未反映のUCR（`SPEC-050` v1.1.0 に伴う要求）<br>&nbsp;<br>以下は本書へ未反映の上流仕様変更要求であり、`DEV-GEN-001` に従い、本書のCanonical Owner本文へ反映されるまで実装契約として扱わない。<br>&nbsp;<br>### UCR-100-001<br>&nbsp;<br>- 対象: SPEC-100（関連: SPEC-110）<br>- 現在の仕様: Business Profileに利用者が編集できるFieldが列挙されていない（§14.1）。一方、`SPEC-050` §18.2 `PG-MYP-002` はDisplay nameを更新可能な項目としている。<br>- 要求する変更: Business ProfileのDisplay nameの物理表現（Column、制約、更新可否）と、対応するAPI contract（`API-AUTH-004`）を定義する。<br>- 理由: `PG-MYP-002` の更新Actionを実装するため。<br>- 変更しない場合の影響: Display nameの更新をBusiness Databaseへ永続化できない。UI mockは必須入力のチェックだけを行い、最大文字数を定めない。<br>- 影響を受ける可能性がある仕様書: SPEC-110<br>&nbsp; |

## SPEC-110 API Specification

- ファイル: `docs/specs/110-api-specification.md`
- version: 1.1.0 → 1.1.1
- 変更: 2 章 / 2 箇所

### SPEC-110 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.1.0 | version: 1.1.1 |

### SPEC-110 / 未反映のUCR（`SPEC-050` v1.1.0 / `SPEC-030` v1.1.0 に伴う要求）

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | ### 未反映のUCR（`SPEC-050` v1.1.0 / `SPEC-030` v1.1.0 に伴う要求）<br>&nbsp;<br>以下は本書へ未反映の上流仕様変更要求であり、`DEV-GEN-001` に従い、本書のCanonical Owner本文へ反映されるまで実装契約として扱わない。<br>&nbsp;<br>### UCR-110-001<br>&nbsp;<br>- 対象: SPEC-110（関連: SPEC-100）<br>- 現在の仕様: 次の項目が定義されていない。<br>  1. Cartからの購入開始（複数Item、All-or-Nothing、不成立Itemの識別、Purposeの `ENTRY_GOODS_PURCHASE` を含む決定）。`API-PUR-ENTRY-001` と `API-PUR-GDS-001` はそれぞれ1 ItemのRequestだけを受ける。<br>  2. `API-ORD-003` の `purpose` に `ENTRY_GOODS_PURCHASE`（`SPEC-030` §11.2）がない。<br>  3. Sponsor Logoの公開取得（`SPEC-030` §8.4、`FR-PUB-015`）。<br>  4. 認証済み閲覧者ごとのPurchase Limit到達（`SPEC-050` §12.1 / §13.3 / §14A.1 が購入不可として表示するため）。<br>  5. `API-ORD-003` のNotification通知表示（`SPEC-050` §16.2 / §16.7）。<br>- 要求する変更: 上記を、Operation IDまたは既存Operationの応答fieldとして定義する。1〜3は `SPEC-030` §26.1 が下流整合事項として既に挙げている。<br>- 理由: `SPEC-050` v1.1.0 と `SPEC-030` v1.1.0 の要件をAPIで満たすため。<br>- 変更しない場合の影響: UI mockのportのうち該当methodを実api-clientへ置き換えられない。UI mockは該当methodを「Operation IDなし」と明示して実装する。<br>- 影響を受ける可能性がある仕様書: SPEC-100, SPEC-120, SPEC-130, SPEC-170<br>&nbsp; |

## SPEC-170 Test Specification

- ファイル: `docs/specs/170-test-specification.md`
- version: 1.1.0 → 1.2.0
- 変更: 4 章 / 4 箇所

### SPEC-170 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.1.0 | version: 1.2.0 |

### SPEC-170 / 21. Unit Test responsibility

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | &nbsp;<br>**TST-UNT-004:** UIの状態対応（Order / Ticket / Reservation / Slot / Goods / Notification state → 利用者向け表示）、Cart保存、Continuation Intentの検証、金額・日時のformatなど、`SPEC-050` が定める表示規則を実装する純粋関数はUnit Testで検証する。このTest CaseのIDは、`TC-&lt;test-rule-id-without-TST-prefix&gt;-&lt;3-digit-sequence&gt;` の `&lt;test-rule-id&gt;` に代えて、対象の `SPEC-050` Page ID（例: `PG-CRT-001`）またはRule IDを使用してよい。 |

### SPEC-170 / 65. Browser isolation

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | **TST-E2E-003:** `SPEC-050 §31` のPage Acceptance各項目は、E2E Test Caseへ追跡できなければならない。Test CaseのIDは `TST-UNT-004` と同じ規則でPage IDを使用してよい。<br>&nbsp;<br>**TST-E2E-004:** `DEV-WEB-010〜013` のUI mockを対象にしたbrowser suite（UI mock suite）は、`SPEC-050` の画面表示・導線・Accessibility確認を目的とする補助suiteである。UI mock suiteは本書 §7 のG8（production相当のWeb + Hono API + Business Database）の代替にならず、G8を実行したと報告してはならない。UI mock suiteのTest Caseはmanifestで `critical: false` とし、`api_operation_ids` と `db_constraint_names` を空にし、API / DB / Providerのcoverageへ算入しない。Test runnerのretryは0とする。<br>&nbsp; |

### SPEC-170 / 77. SPEC-170 acceptance

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 51. `SPEC-050` が定める表示規則の純粋関数（`TST-UNT-004`）と、`SPEC-050 §31` のPage Acceptance（`TST-E2E-003`）がTest Caseへ追跡できる。<br>52. UI mock suiteが補助suiteとして扱われ、G8、API / DB / Providerのcoverageとして報告されていない（`TST-E2E-004`）。 |

## SPEC-190 AI Development Guidelines

- ファイル: `docs/specs/190-ai-development-guidelines.md`
- version: 1.1.0 → 1.2.0
- 変更: 5 章 / 5 箇所

### SPEC-190 / (frontmatter / 冒頭)

| 旧仕様書 | 新仕様書 |
|---|---|
| version: 1.1.0 | version: 1.2.0 |

### SPEC-190 / 6. Canonical repository layout

| 旧仕様書 | 新仕様書 |
|---|---|
| **DEV-REP-004:** Test fixture / fake provider / fault injector / deterministic admin hookは `tests/fixtures` または `tests/harness` にのみ置き、Production route table / worker public endpointへ登録しない。 | **DEV-REP-004:** Test fixture / fake provider / fault injector / deterministic admin hookは `tests/fixtures` または `tests/harness` にのみ置き、Production route table / worker public endpointへ登録しない。UI mock（DEV-WEB-010〜013）だけが、そこで定める条件の下で `apps/web/src/mock/` に置ける例外である。 |

### SPEC-190 / 14. Session / RPC / cache

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | **DEV-WEB-010:** Hono API clientが未実装の間に限り、`apps/web/src/mock/` にUI mock（api-client portとauth portのmock実装、合成data、開発用scenario切替）を置いてよい。UI mockはSPEC-050の画面確認だけを目的とし、API contract、DB制約、Provider動作の検証根拠として扱わない。<br>&nbsp;<br>**DEV-WEB-011:** UI mockは `NEXT_PUBLIC_UI_MOCK=1` のときだけ選択する。それ以外では実api-client portを使い、実装が存在しない場合はfail closedとする。本番deploy用のbuildで `NEXT_PUBLIC_UI_MOCK=1` が有効な場合、buildを失敗させなければならない。<br>&nbsp;<br>**DEV-WEB-012:** `apps/web/src/mock/` をimportしてよいのは、port factory（`apps/web/src/api-client/index.ts`、`apps/web/src/auth/index.ts`）、`apps/web/app/dev/**`、およびMock Mode表示の差し込みに限る。許可listは `scripts/check-import-boundaries.mts` で機械検査し、`presentation` / `features` からのimportを禁止する。`/dev/*` はUI mock無効時に `notFound` を返し、一般利用者向けNavigationからLinkしない。<br>&nbsp;<br>**DEV-WEB-013:** UI mockの認証、合成data、scenario切替は本番の認証・業務dataとして扱わない。実api-client / Supabase Auth integrationを導入する際は、`apps/web/src/mock/` と `apps/web/app/dev/**` を削除でき、画面側の変更を必要としないportの形を維持する。UI mockにpassword、Secret、実QR Token、実個人情報を保存・記録してはならない。<br>&nbsp; |

### SPEC-190 / 21. Authority rules

| 旧仕様書 | 新仕様書 |
|---|---|
| **DEV-AUTH-009:** test用auth bypassをProduction code pathへ残さない。 | **DEV-AUTH-009:** test用auth bypassをProduction code pathへ残さない。DEV-WEB-010〜013のUI mockが提供するmock認証は、`UI_MOCK_ENABLED` のときだけ選択され、本番の認証経路として扱わない。 |

### SPEC-190 / 42. SPEC-190 Acceptance Criteria

| 旧仕様書 | 新仕様書 |
|---|---|
| （なし） | 32. UI mock（DEV-WEB-010〜013）が `NEXT_PUBLIC_UI_MOCK=1` のときだけ選択され、許可listからのみimportされ、本番buildで無効であり、API contract / DB / Providerの検証根拠として扱われていない。 |

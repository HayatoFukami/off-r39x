---
spec_id: SPEC-080
title: Ticket, QR and Check-in Specification
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
  - SPEC-020
  - SPEC-030
  - SPEC-040
  - SPEC-050
  - SPEC-060
  - SPEC-070
related_specs:
  - SPEC-090
  - SPEC-100
  - SPEC-110
  - SPEC-120
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-200
---

# 080 Ticket / QR / Check-in Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形における電子Ticket、Entry QR、Karaoke QR、QR Token、Ticket表示、QR検証、Entry Check-in、Karaoke Check-in、二重利用防止、並行Scan、取消・失効Ticket、Payment / Refund後のTicket有効性境界、およびTicket / Check-in整合性Failureを定義する。

本書は `SPEC-010`〜`SPEC-070` の上流仕様を変更または弱化せず、そこで確定したSystem Boundary、System of Record、Functional Requirement、Ticket / Reservation / Check-in State Machine、User Flow、Page / Route、Authentication / Authorization / Ownership、Payment Confirmation / Refund boundaryを、Ticket / QR / Check-in処理として実装可能かつ追跡可能なRuleへ具体化するCanonical Ownerである。

本書がCanonical Ownerとなるのは少なくとも以下である。

- Entry Ticket / Karaoke Ticketの利用上の意味
- Ticket StateとQR表示可否の接続
- QR TokenのCanonical format、purpose binding、entropy、生成、照合、失効、rotation
- TicketとQR Tokenのcorrelation model
- Entry QR / Karaoke QRのpurpose separation
- QR表示前のAuthentication / Ownership / current state確認
- QR Scan時のStaff Authentication / Authorizationとの接続
- QR validationからCheck-in成立までの論理処理順
- Entry Check-in / Karaoke Check-inの共通Ticket消費処理
- Check-in atomicity
- Check-in idempotency / concurrency
- 同一QR連続Scan、double submit、Network retry、response loss、複数Staff端末並行Scanの結果
- malformed / unknown / wrong-purpose / used / canceled / expired / time-condition failure等のResult分類
- Staffへ返す受付対象情報の最小境界
- Ticket cancellation後のQR無効化境界
- Payment / Refund / Domain cancellationとの接続境界
- Auth / Business Database障害時のfail-closed behavior
- QR Token compromise時の失効・再発行境界
- Ticket / Check-in / Token correlationのConsistency Failure境界
- `FR-*`, `BR-*`, `DI-030-*`, `UF-*`, `PG-*`, `AR-*`, `PAY-*`, `INV-010-*` へのTraceability

本書はMVP、Step1、Step2等の実装フェーズで仕様を分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は以下へ適用する。

- 正規発行済みEntry Ticket
- 正規発行済みKaraoke Ticket
- Entry Ticket用QR Token
- Karaoke Ticket用QR Token
- `PG-MYP-005〜007` のEntry Ticket / QR表示境界
- `PG-MYP-008〜010` のKaraoke Reservation / Ticket / QR表示境界
- StaffによるEntry QR Scan / Check-in
- StaffによるKaraoke QR Scan / Check-in
- Ticketのsingle-use消費
- Ticket cancellation / expiration後のQR扱い
- Payment Confirmationで発行されたTicketとの接続
- Refund後に正規Domain cancellationが要求された場合のTicket側処理
- Auth Service / Business Database / API一時障害時のTicket / Check-in保全
- Token compromise、correlation不整合、Ticket / Check-in不整合

本書は以下をCanonicalには定義しない。

- Authentication / Session / Ownership / Role / Permission Matrix: `SPEC-060`
- 一般利用者向けPage / Route / UI Layout: `SPEC-050`
- Order / Stripe / Refund financial lifecycle: `SPEC-070`
- Karaoke Slot / Hold / Reservation / 通常受付時間の具体値: `SPEC-090`
- DB Table / Column / Index / Unique Constraint / Transaction SQL: `SPEC-100`
- API Endpoint / Request / Response / HTTP Status: `SPEC-110`
- Email / Notification: `SPEC-120`
- Administrator / Staff個別画面: `SPEC-130`
- Security Control全般、rate limit、secret storage具体方式: `SPEC-140`
- Recovery Runbook / retry回数 / operator手順: `SPEC-150`
- Audit Event schema / log field: `SPEC-160`
- Test case詳細: `SPEC-170`

---

## 3. 前提・依存仕様

本書は以下へ直接依存する。

- `SPEC-000`: Canonical Owner、`depends_on`、情報源優先順位、Upstream Change Request、正式仕様生成規則
- `SPEC-010`: System Boundary、Business Database、Entry / Karaoke QR用途分離、`INV-010-*`
- `SPEC-020`: Ticket / Mypage / Staff / Cross-functional Functional Requirement
- `SPEC-030`: Entry Ticket / Karaoke Ticket / Reservation / Check-in State Machine、`BR-*`、`DI-030-*`
- `SPEC-040`: Mypage、Entry / Karaoke Check-in、failure / retry / rescanの `UF-*`
- `SPEC-050`: Ticket / QR関連Page ID、Route、Ticket state別表示境界
- `SPEC-060`: Authentication、Business Profile resolution、Ownership、Staff Role / Capability、fail-closed rule
- `SPEC-070`: Business Confirmationによる正規Ticket発行、Refund financial lifecycle、Domain cancellationとの責務分離、Payment recovery boundary

本書は上流で定義済みのState、Role、Capability、Page ID、Order / Refund意味を再定義しない。

---

## 4. Canonical Terms

| Term | 本書での意味 |
|---|---|
| Ticket | 本書ではEntry TicketまたはKaraoke Ticketの総称。両者は別Domain Typeである |
| Entry Ticket | 1名分のイベント入場権。`SPEC-030` のState Machineに従う |
| Karaoke Ticket | 1件のKaraoke Reservationに対応する一回受付権。`SPEC-030` のState Machineに従う |
| QR Token | TicketをStaff側Server operationへ相関させるための推測困難なopaque bearer value。Ticket IDでもOwner認証情報でもない |
| QR Payload | QR画像へencodeするCanonicalな文字列。version、purpose marker、opaque random tokenからなる |
| QR Purpose | `ENTRY` または `KARAOKE`。受付OperationとTicket Domain Typeを結び付ける用途情報 |
| Active QR Token | 当該Ticketに対し現在QR表示へ使用してよい1件のToken |
| Revoked QR Token | compromise等により明示的に旧Tokenとして失効させたToken。再Check-inへ使用不可 |
| Token Correlation | QR TokenからServer-sideで正規Ticketを一意に解決する関係 |
| Check-in | Ticketの一回利用を成立させた不変Business Event |
| Check-in Business Cause | ある1枚のTicketがそのpurposeで一度だけ消費されるという業務原因。Request IDではなくTicketそのものに結び付く |
| Winner | 並行Check-in要求のうち、Ticket `VALID -> USED` とCheck-in作成を正規にCommitした1要求 |
| Loser | WinnerのCommit後に同じTicketが既に消費済みであることを観測し、新規Check-inを作らない要求 |
| Current Ticket State | Business Databaseに保存されたTicket Stateに、必要な時間条件をServer-sideで適用して得る受付判断時の権威状態 |
| Consistency Failure | Token、Ticket、Reservation、Check-inの関係が上流Invariantを満たさず、安全な自動更新で正常化できない状態 |

QR Tokenを知っていることは、CustomerとしてTicketを所有していることの証明ではない。Staff ScanではTokenが受付対象を相関する入力となるが、Staff operation自体のAuthorizationは `SPEC-060` に従い別途成立しなければならない。

---

## 5. Rule ID体系

本書のNormative Ruleは以下のPrefixを使用する。

| Prefix | Category |
|---|---|
| `TQR-TKT-*` | Ticket lifecycle / issuance boundary |
| `TQR-TOK-*` | QR Token model / generation / lifecycle |
| `TQR-DSP-*` | Customer Ticket / QR display |
| `TQR-AZ-*` | Staff / Customer authorization接続 |
| `TQR-CHK-*` | Check-in execution / atomicity |
| `TQR-IDM-*` | Idempotency / concurrency / retry |
| `TQR-OUT-*` | Result / failure classification |
| `TQR-CAN-*` | Cancellation / expiration / Payment boundary |
| `TQR-REC-*` | Failure / consistency / recovery boundary |
| `TQR-SEC-*` | Ticket / QRに直接必要なSecurity boundary |

同一Rule IDを別の意味へ再利用してはならない。

# Part I — Ticket Semantics

## 6. Entry Ticket State

`SPEC-030` のEntry Ticket Stateをそのまま使用する。

| State | 本書での受付上の意味 | QR表示 | 通常Check-in |
|---|---|---|---|
| `VALID` | 正規発行済みで、現在の受付条件を満たす限り一回利用可能 | 可 | 条件付き可 |
| `USED` | Entry Check-inが一度成立済み | 利用可能QRとしては不可 | 不可。既存Check-inを返す |
| `CANCELED` | 正規取消により利用権を失った | 利用可能QRとしては不可 | 不可 |
| `EXPIRED` | Domain上の有効期間終了により利用不可 | 利用可能QRとしては不可 | 不可 |

State Machineは次のとおりであり、本書は追加・改名・復活遷移を導入しない。

```text
[*] -> VALID
VALID -> USED
VALID -> CANCELED
VALID -> EXPIRED
```

`USED` / `CANCELED` / `EXPIRED` から `VALID` へ戻す通常Operationは存在しない。

**TQR-TKT-001:** Entry Ticketは `PAY-CFM-006〜007` および `BR-TKT-005〜007` に従い、Order Business Confirmationで正規発行されたものだけを初期 `VALID` とする。

**TQR-TKT-002:** Order `CONFIRMED` 前、支払未確定、Payment failure、Webhook反映待ちから有効Entry Ticketまたは有効Entry QRを提供してはならない。

**TQR-TKT-003:** Entry Ticketは `(Order Item, 正規購入数量単位)` ごとに最大1件とし、本書のToken生成・QR表示・Check-in retryを原因に新しいEntry Ticketを生成してはならない。

**TQR-TKT-004:** Entry Ticket Ownerは対応Order Customerから導出し、QR Token、Ticket reference、Staff入力によって変更しない。

---

## 7. Karaoke Ticket State

`SPEC-030` のKaraoke Ticket Stateをそのまま使用する。

| State | 本書での受付上の意味 | QR表示 | 通常Check-in |
|---|---|---|---|
| `VALID` | `CONFIRMED` Reservationに対応し、受付時間条件を満たす場合に一回利用可能 | Reservation `CONFIRMED` 時のみ可 | 条件付き可 |
| `USED` | Karaoke Check-inが一度成立済み | 利用可能QRとしては不可 | 不可。既存Check-inを返す |
| `CANCELED` | Reservation取消等の正規Operationで利用不可 | 利用可能QRとしては不可 | 不可 |
| `EXPIRED` | 通常受付可能期間終了後、未使用のまま利用不可 | 利用可能QRとしては不可 | 不可 |

State Machineは次のとおりであり、本書は追加・改名しない。

```text
[*] -> VALID
VALID -> USED
VALID -> CANCELED
VALID -> EXPIRED
```

**TQR-TKT-005:** Karaoke Ticketは `CONFIRMED` Karaoke Reservationごとに最大1件とし、`PAY-CFM-008〜009` / `BR-KRK-019〜020` により正規発行されたTicketだけを初期 `VALID` とする。

**TQR-TKT-006:** Order `CONFIRMED` 前、Reservation未確定、Webhook反映待ちから有効Karaoke TicketまたはKaraoke QRを提供してはならない。

**TQR-TKT-007:** Karaoke Ticket OwnerはReservation Customerと一致し、QR Token、Reservation reference、Staff入力で変更しない。

**TQR-TKT-008:** Reservationが `CANCELED` の場合、Karaoke Ticketが物理的に残っていても受付可能権利として扱わない。正規Reservation cancellationでは未使用Ticketを同じDomain cancellationへ含めて `CANCELED` とする。

---

## 8. TicketとQRの関係

TicketとQR Tokenは同一Entityではない。

```text
Entry Ticket    1 -> 0..n historical QR Tokens, 0..1 ACTIVE
Karaoke Ticket  1 -> 0..n historical QR Tokens, 0..1 ACTIVE
```

通常運用では1 Ticketに対して1つのActive QR Tokenを継続利用する。Rotationが発生した場合のみ複数のhistorical Token relationが存在し得る。

**TQR-TKT-009:** QR Tokenを生成・rotateしてもTicket State、Owner、Order、Reservation、Check-in historyを変更してはならない。

**TQR-TKT-010:** Ticketが `USED` / `CANCELED` / `EXPIRED` になっても、既存QRをScanしたStaffへ適切なterminal resultを返せるようToken-to-Ticket correlationを直ちに破棄することを要求しない。受付可否は常にTicket current stateで判断する。

# Part II — QR Token Model

## 9. Canonical QR Payload format

QR PayloadのCanonical formatは次とする。

```text
r39x1.<purpose>.<token>
```

`purpose` は以下のどちらかである。

```text
ent  # Entry Ticket
krk  # Karaoke Ticket
```

`token` はCSPRNGで生成した**256 bit**のrandom valueをBase64url without paddingでencodeした43文字とする。

Canonical例の構造は以下であり、例示値を実Tokenとして使用してはならない。

```text
r39x1.ent.<43-char-base64url-random>
r39x1.krk.<43-char-base64url-random>
```

**TQR-TOK-001:** QR PayloadへDB連番、Ticket ID、Order ID、Reservation ID、Business Profile ID、Email、氏名、Payment ID等の推測可能または個人情報となる値を直接encodeしてはならない。

**TQR-TOK-002:** Token random componentはServer-side CSPRNGで256 bitのentropyを持つ値として生成し、Client-generated tokenを権威値にしてはならない。

**TQR-TOK-003:** QR Payload version `r39x1` はformat versionであり、Ticket stateやAuthorizationを表さない。未知versionはmalformed / unsupported QRとして受付を成立させない。

**TQR-TOK-004:** `purpose` markerは早期分類用であり、それだけをTicket typeの権威根拠にしない。Server-side Token relationと解決後Ticket Domain Typeの双方が一致しなければならない。

---

## 10. Token correlation / purpose binding

Token correlationはServer-side relationとして少なくとも以下の論理情報を保持する。

- Token lookup value
- QR format version
- QR Purpose (`ENTRY` / `KARAOKE`)
- 対応Ticket Domain Type
- 対応Ticket
- Token lifecycle state (`ACTIVE` / `REVOKED`)
- 発行 / rotationのcorrelationに必要な論理情報

物理Table、Column、Index、Unique Constraintは `SPEC-100` が定義する。

**TQR-TOK-005:** QR PayloadからTicketを一意に解決できなければならない。0件ならunknown、複数件または矛盾relationならConsistency Failureとする。

**TQR-TOK-006:** `ent` PayloadをKaraoke Ticket relationへ、`krk` PayloadをEntry Ticket relationへ解決してはならない。Token lookupが成功してもpurpose / Ticket type不一致ならCheck-inを成立させない。

**TQR-TOK-007:** QR Purpose bindingは次の3点をServer-sideで一致確認する。

1. Payload purpose marker
2. Token relationに保存されたcanonical purpose
3. 解決されたTicket Domain Type

3点のいずれかが一致しない場合、Ticket Stateを変更しない。

---

## 11. Tokenの保持・照合に関するSecurity概念

本書ではDB物理Columnを固定しないが、Tokenの秘密値を単純平文lookupだけに依存する設計は禁止する。

Canonicalな論理要件は次とする。

1. Scan lookup用には、Server-only QR token protection secretを用いたHMAC-SHA-256等のkeyed digestを利用可能な形で保持する。
2. Customer QR再表示で同じActive Tokenを再利用するため、Active Token secretをServer-sideで復元可能な形で保護して保持する。
3. 復元可能なToken materialはapplication Serverだけが利用できる暗号化保護境界に置く。
4. lookup digestと復元用保護materialをClientへ返すことはない。
5. Token protection key管理・rotation・KMS / environment secretの具体方式は `SPEC-140` / `SPEC-180` が定義する。

**TQR-TOK-008:** Business Databaseの単純漏えいだけで全Active QR Tokenの平文値が直ちに得られる設計を避ける。

**TQR-TOK-009:** Token lookup用digest、encrypted token material、Ticket referenceの具体Column構成を本書で固定しない。`SPEC-100` は本書の一意相関、active-token cardinality、lookup可能性を実現する。

---

## 12. Token生成時点

QR Tokenは**支払確定前に生成・提供してはならない**。

正規Ticket生成後のToken provisioningは、以下のいずれかの安全な契機で実施してよい。

- Ticket発行後のServer-side post-confirmation処理
- Ownerが初めてQR表示を要求した時点

ただしCanonicalな利用者向け挙動は、Ownerが `VALID` TicketのQR表示を要求した時点でActive Tokenがなければ、同一Ticketについて一度だけ安全に生成し、その後は再利用するものとする。

**TQR-TOK-010:** 初回Token provisioningのBusiness Causeは `(Ticket, initial-active-token)` とし、parallel QR page load / reloadで複数Active Tokenを発行してはならない。

**TQR-TOK-011:** QR Token生成失敗を理由に、既に `CONFIRMED` となったOrderまたは正規発行済みTicketを削除・取消してはならない。QR表示だけを一時Failureとして扱い、TicketはBusiness Database上の正規stateを保持する。

**TQR-TOK-012:** Token provisioningは `PAY-CFM-*` のOrder ConfirmationをBrowser側で代替する処理ではない。Tokenが存在することだけでPayment confirmedと判断してはならない。

---

## 13. Token rotation policy

通常のQR表示、Page reload、Browser revisitのたびにTokenをrotateしない。

採用理由は以下である。

- 会場提示直前のreloadで旧画面・スクリーンショットを不必要に無効化しない
- concurrent page loadでToken churnを発生させない
- single-use guaranteeをToken rotationではなくTicket / Check-in atomicityで成立させる
- Token lifecycleを単純に保ち、障害復旧・テストを容易にする

**TQR-TOK-013:** `VALID` Ticketには通常最大1件のActive QR Tokenを持たせ、QR表示は既存Active Tokenを再利用する。

**TQR-TOK-014:** Page reload、QR画像再描画、別DeviceからのOwnerによる正規QR表示だけを理由にActive Tokenを失効させない。

**TQR-TOK-015:** Token compromiseが合理的に疑われる場合は、後述の明示的Token rotation operationにより旧Tokenを `REVOKED` とし、新しいActive Tokenを同一Ticketへ発行できる。

**TQR-TOK-016:** Rotationは「旧Token revoke」と「新Active Token発行」を、同一TicketにActive Tokenが同時に2件存在する窓を作らない一貫したServer-side operationとして成立させる。

**TQR-TOK-017:** Rotation後の旧Token ScanはTicketを利用済みにせず `TOKEN_REVOKED` outcomeとする。旧Tokenから新Token値を推測・取得できる情報を返さない。

**TQR-TOK-018:** Ticketがすでに `USED` / `CANCELED` / `EXPIRED` の場合、通常のcompromise rotationで新しい利用可能Tokenを発行しない。

---

## 14. Token compromise recovery authorization

本書はCustomer向け新規Page / Buttonを追加しない。Token compromiseに対する明示rotationは、現行上流Capabilityで安全に表現可能な**特定Recovery operation**として扱う。

実行には少なくとも以下を要求する。

1. verified Administrator Identity
2. active `ADMINISTRATOR`
3. `recovery.exception.execute`
4. 対象Ticketが正規に一意解決できる
5. Ticketが `VALID`
6. 対象TicketにCheck-inが存在しない
7. rotation後もTicket Owner / State / Order / Reservationを変更しない

**TQR-TOK-019:** `recovery.exception.execute` をgeneric QR bypassとして使用してはならない。Token rotationはToken compromise recoveryに限定する。

**TQR-TOK-020:** Staff RoleだけではToken rotationを実行できない。

具体的な運用画面は `SPEC-130`、runbookと承認フローは `SPEC-150`、audit event schemaは `SPEC-160` が定義する。

# Part III — Customer Ticket / QR Display

## 15. Ticket / QR表示のServer-side評価順序

`PG-MYP-006〜007` および `PG-MYP-009〜010` のOwner限定表示では、Server-sideで少なくとも次の順序を満たす。

1. Supabase Auth由来Identity verification
2. Email確認等を含む有効Authentication state確認
3. Business Profile一意resolution
4. 対象Ticket / ReservationのOwner relation確認
5. Ticket / Reservation current state取得
6. 必要な時間由来expiration評価
7. QR表示可否判定
8. `VALID` かつ表示可能なら既存Active Tokenを取得し、なければidempotentにprovision
9. QR Payloadを表示用responseへ含める

**TQR-DSP-001:** `{ticket_ref}` / `{reservation_ref}` / QR Tokenを知っていることだけでTicket QRを返してはならない。

**TQR-DSP-002:** Owner verificationは `AR-OWN-001〜008` に従い、ClientへTicket payloadを返す前にServer-sideで成立させる。

**TQR-DSP-003:** QR TokenそのものをCustomer QR表示APIのAuthentication / Authorization credentialとして使用してはならない。

**TQR-DSP-004:** Owner不一致ではTicket state、QR Token、Order内容、Reservation詳細、Owner情報を返さず、`UF-MYP-002` / `PG-XFN-003` のOwnership failure境界に従う。

---

## 16. Entry QR表示Rule

`PG-MYP-007` のRoute / Page ID / UI Layoutは `SPEC-050` を変更しない。

| Entry Ticket State | Server-side QR payload返却 | 利用者向け意味 |
|---|---|---|
| `VALID` | Owner確認後に可 | Entry受付へ提示可能 |
| `USED` | 不可 | 使用済み |
| `CANCELED` | 不可 | 取消済み |
| `EXPIRED` | 不可 | 失効済み |

**TQR-DSP-005:** `USED` / `CANCELED` / `EXPIRED` Ticketへ、以前のActive TokenがServer-sideに残っていても「利用可能QR payload」として返してはならない。

**TQR-DSP-006:** Browser cache / screenshotに旧QRが残っていても、その表示状態をTicket有効性のAuthorityにしない。Staff Scan時にBusiness Database current stateを再評価する。

---

## 17. Karaoke QR表示Rule

`PG-MYP-010` のRoute / Page ID / UI Layoutは `SPEC-050` を変更しない。

Karaoke QRを返せるのは少なくとも次をすべて満たす場合である。

- Owner authentication / authorization成功
- Reservation `CONFIRMED`
- Karaoke Ticket `VALID`
- Ticketが対象Reservationに一意に対応
- Token purpose = `KARAOKE`

| Reservation / Ticket | Server-side QR payload返却 |
|---|---|
| Reservation `CONFIRMED` + Ticket `VALID` | 可 |
| Ticket `USED` | 不可 |
| Reservation `CANCELED` | 不可 |
| Ticket `CANCELED` | 不可 |
| Ticket `EXPIRED` | 不可 |

**TQR-DSP-007:** Reservation `CANCELED` でTicket stateの反映に不整合がある場合、有効QRを返さずConsistency Failureとして扱う。

**TQR-DSP-008:** Entry QRとKaraoke QRは表示Page上のlabelだけでなく、Server-side purpose relationでも分離する。

---

## 18. Client-side authorityの禁止

**TQR-DSP-009:** Browser / Clientが保持する以下の値だけからTicket stateまたはCheck-in可否を変更・確定してはならない。

- `isValid` flag
- QR表示済みflag
- previous scan result
- ticket type文字列
- owner ID
- timestamp
- role / permission
- QR decoded payload

**TQR-DSP-010:** QR PayloadをURL path / query、Continuation Intent、analytics parameter、client-generated deep linkへ埋め込むことを前提にしない。

Client cache control、screenshot protection可否、browser storage、CSP等の具体Security Controlは `SPEC-140` が定義する。

# Part IV — Staff Authorization / Scan Entry

## 19. Authorization before QR evaluation

Staff Check-in Requestは、QR Tokenの正当性を開示する前にStaff Authentication / Authorizationを評価する。

### 19.1 Entry

必要条件:

1. verified Identity
2. active `STAFF`
3. `entry_checkin.execute`
4. `AR-AZ-013` と本書のEntry Check-in Rule成立

### 19.2 Karaoke

必要条件:

1. verified Identity
2. active `STAFF`
3. `karaoke_checkin.execute`
4. `AR-AZ-014` と本書のKaraoke Check-in Rule成立

**TQR-AZ-001:** Client role申告、Staff UI route、button表示、QR scanner modeだけをCheck-in Authorization根拠にしてはならない。

**TQR-AZ-002:** `ADMINISTRATOR` Roleは `STAFF` Roleを自動継承しない。AdministratorがCheck-inを行うには別途active `STAFF` Roleが必要である。

**TQR-AZ-003:** Authentication / Authorization failure時は、提示QRがvalidかunknownかusedか等のTicket情報を不必要に返さない。

**TQR-AZ-004:** Auth Service障害によりIdentityを安全に検証できない場合はFail Closedとし、未検証StaffへCheck-inを許可しない。

---

## 20. QR Scan format validation

認可済みStaff Requestに対して、QR Payloadを次の順序で検証する。

1. 入力が許容最大長内の文字列である
2. `r39x1.<purpose>.<token>` の3 segment形式である
3. versionが `r39x1`
4. purposeが `ent` または `krk`
5. token componentがBase64url without padding 43文字としてcanonical
6. decoded random componentが256 bit
7. Staff operation purposeとPayload purposeが一致
8. Server-side Token correlationを一意に解決
9. Token relation purpose / Ticket Domain Typeをcross-check

**TQR-CHK-001:** malformed QRではToken lookupを権威あるTicket lookupへ進めず、Ticket stateを変更しない。

**TQR-CHK-002:** 正しいformatでもToken relationが存在しない場合はunknown tokenとし、Check-inを成立させない。

**TQR-CHK-003:** 正しいTokenでもEntry/Karaoke purpose不一致ならwrong purposeとしてRejectし、Ticket stateを変更しない。

**TQR-CHK-004:** Staff UIの「Entry mode」「Karaoke mode」はRequest intentを表すに留まり、Server-side purpose / Ticket type cross-checkを省略する根拠にならない。

# Part V — Check-in Execution

## 21. Check-inのauthoritative operation

通常Staff Scanは、**QR検証とTicket消費を別々の信頼済みOperationとして分離しない**。

Authoritative Check-in operationは論理的に次の順序で実行する。

1. Staff Identity verification
2. active Staff Role / purpose-specific Capability authorization
3. QR format / version / purpose validation
4. QR TokenからToken relation / TicketをServer-sideで一意解決
5. Token lifecycle state確認
6. Ticket Domain Type / purpose一致確認
7. Ticket current state確認
8. Ticket OwnerはTicket relationから導出し、Staff入力Ownerで差し替えない
9. Karaokeの場合はReservationを一意に解決しcurrent state確認
10. 受付に必要な現在時刻条件をServer-sideで評価
11. Ticket `VALID -> USED` とCheck-in record作成を同一atomic business operationとして試行
12. CommitできたRequestだけを初回Check-in成功とする
13. Commit後の結果をStaffへ返す

**TQR-CHK-005:** QRが「validである」と非更新検証した後、別Requestが割り込める状態のままClientへ一旦valid resultを返し、そのClient resultを根拠に後続consumeする設計をauthoritative Check-in pathとして使用してはならない。

非更新のpreview / diagnostic validationを将来APIとして持つ場合でも、その結果はCheck-in権利を予約せず、execute時に上記全条件を再評価しなければならない。API Endpoint自体は `SPEC-110` が定義する。

---

## 22. Check-in Business Cause

Entry / Karaoke Check-inのBusiness Causeは次とする。

```text
Entry:   (ENTRY_TICKET, canonical Ticket identity, consume-once)
Karaoke: (KARAOKE_TICKET, canonical Ticket identity, consume-once)
```

Request ID、Device ID、Staff ID、Scan時刻、QR Token rotation generationは新しいCheck-in Business Causeを作らない。

**TQR-CHK-006:** 同一Ticketへ異なるRequest ID、異なるStaff、異なるDeviceから要求が到着しても、成立可能な正規Check-inは最大1件である。

**TQR-CHK-007:** QR Tokenがrotationされても同一TicketのCheck-in権利が増えることはない。

---

## 23. Entry Check-in precondition

Entry Check-inは次をすべて満たす場合だけ成立する。

- Staff Authorization成功
- QR Payload purpose = `ENTRY`
- Token `ACTIVE`
- Tokenが一意なEntry Ticketへ解決
- Entry Ticket State = `VALID`
- Entry Ticketに既存Entry Check-inが存在しない
- Entry Ticketの入場有効期間が定義されている場合、Server current timeがその通常受付可能期間内
- Ticket / Check-in relationにConsistency Failureがない

**TQR-CHK-008:** Entry Ticketが `USED` / `CANCELED` / `EXPIRED` の場合、Staff Roleの強さにかかわらず通常Check-inを成立させない。

**TQR-CHK-009:** Entry Check-in成功時、Entry Ticket `VALID -> USED` とEntry Check-in record 1件作成を同一atomic business operationでCommitする。

**TQR-CHK-010:** Entry Check-in成功はEntry sales capacity recovery、Order state変更、Payment state変更を副作用として行わない。

---

## 24. Karaoke Check-in precondition

Karaoke Check-inは次をすべて満たす場合だけ成立する。

- Staff Authorization成功
- QR Payload purpose = `KARAOKE`
- Token `ACTIVE`
- Tokenが一意なKaraoke Ticketへ解決
- Karaoke Ticket State = `VALID`
- Ticketに対応するReservationが一意に存在
- Reservation State = `CONFIRMED`
- Ticket Owner = Reservation Customer
- Reservation / Ticket relationに不整合がない
- `SPEC-090` がCanonicalに定義する通常Karaoke受付時間条件をServer current timeが満たす
- 既存Karaoke Check-inが存在しない

**TQR-CHK-011:** Karaoke受付時間の具体的な前後許容値、`checkin_opens_at` / `checkin_closes_at` の算出Ruleは `SPEC-090` がCanonical Ownerであり、本書は任意の固定分数を追加しない。

**TQR-CHK-012:** `SPEC-090` の通常受付時間predicateがfalseの場合、`OUTSIDE_CHECKIN_WINDOW` としてRejectし、Ticket / Reservation stateを変更しない。通常Staff Capabilityだけで時間条件を迂回してはならない。

**TQR-CHK-013:** Karaoke Check-in成功時、Karaoke Ticket `VALID -> USED` とKaraoke Check-in record 1件作成を同一atomic business operationでCommitする。Reservationは `CONFIRMED` のままとする。

**TQR-CHK-014:** Karaoke Check-in成功はSlotを `AVAILABLE` へ戻す、副作用でReservationを`CANCELED`にする、またはSlot再販売を成立させるOperationではない。

---

## 25. Check-in record

Check-in recordは成功したTicket消費事実を表すImmutable Business Eventである。

論理的に少なくとも以下を識別可能でなければならない。

- Entry / KaraokeのCheck-in種別
- 対応Ticket
- 成立時のServer-side timestamp
- 実行したverified Staff principal
- 同一TicketのCheck-inが一回限りであることを追跡できるBusiness relation

DB field、public reference、Audit Event schemaはそれぞれ `SPEC-100` / `SPEC-110` / `SPEC-160` が定義する。

**TQR-CHK-015:** invalid scan、authorization failure、time failure、used rescan等の失敗・再Scanごとに新しいDomain Check-in recordを作成してはならない。これらの観測はAudit / Observabilityとして `SPEC-160` が扱う。

**TQR-CHK-016:** Check-in成立後にCheck-in recordを通常編集・削除して「未使用」に戻すOperationを定義しない。

# Part VI — Atomicity / Concurrency / Idempotency

## 26. Atomicity invariant

`BR-CHK-003` / `DI-030-007` を具体化し、Ticket `VALID -> USED` とCheck-in record作成はall-or-nothingである。

許可されない中間結果:

```text
Ticket = USED     + Check-in = none
Ticket = VALID    + Check-in = exists
Ticket = USED     + Check-in = 2件以上
```

**TQR-IDM-001:** Ticket state更新成功 / Check-in insert失敗の場合、transaction全体を失敗させ、Ticketを `USED` のまま部分Commitしてはならない。

**TQR-IDM-002:** Check-in insert成功 / Ticket state更新失敗の場合もtransaction全体を失敗させ、新規Check-inだけを残してはならない。

具体的なtransaction isolation、row lock、conditional update、unique constraint、SQLは `SPEC-100` が定義する。

---

## 27. Concurrent Scan winner / loser

同一Ticketへ2件以上の並行Check-in要求が到着した場合、結果は次とする。

1. 全Requestが同じTicket current stateを独立に信頼して二重成功してはならない。
2. 最大1件だけがTicketのsingle-use transitionを取得し、Check-inをCommitするWinnerとなる。
3. Winner以外はWinner commit後のcurrent state / existing Check-inを再取得する。
4. 正常な競合ならLoserは新しいCheck-inを作らず `ALREADY_USED` outcomeを返す。
5. Loserが観測したTicket / Check-in relationがInvariantに反する場合は `CONSISTENCY_REVIEW_REQUIRED` とする。

**TQR-IDM-003:** Winner / Loser判定はClient timestamp、Staff priority、先にQR画面を開いた順序ではなく、Business Database上のatomic transition結果で決める。

**TQR-IDM-004:** 複数Staff端末から同時にScanされても、Staffごとに別Check-inを作らない。

---

## 28. Retry / double submit / response loss

以下は同一Check-in Business Causeの再入力として扱う。

- 同一端末のdouble tap
- 同一QRの連続Scan
- Network timeout後のretry
- API 5xx相当後のretry
- Clientが成功応答を受信できなかった後の再送
- Browser / Staff UI reload後の再Scan
- 異なるRequest IDで同じTicketを再Scan

**TQR-IDM-005:** retryで新しいTicket、Token、Check-inを生成してはならない。

**TQR-IDM-006:** 初回Commit済みだがresponse lossした場合、retryはTicket `USED` と既存Check-inを解決し、`ALREADY_USED` と既存Check-in summaryを返す。Staffは「先行受付が既に成立した」ことを識別できなければならない。

**TQR-IDM-007:** Request IDが同じか異なるかにかかわらず、Ticket単位のsingle-use invariantを優先する。Transport-level idempotency keyを唯一の二重利用防止にしてはならない。

**TQR-IDM-008:** Check-in成功直後のread / rescanはBusiness Database上の `USED` と既存Check-inを参照し、stale Client stateだけから `VALID` と表示して新しい成功を作らない。

---

## 29. Cancellation / expirationとの競合

Ticket `VALID -> USED` と `VALID -> CANCELED` / `VALID -> EXPIRED` が競合する場合、同じTicketのcurrent stateを競合制御下で評価する。

**TQR-IDM-009:** Check-inが先に正規Commitした場合、Ticketは `USED` となり、後続の通常Cancellation / Expirationは `VALID` 前提を満たさないため成立しない。

**TQR-IDM-010:** Cancellation / Expirationが先に正規Commitした場合、後続Check-inは `CANCELED` / `EXPIRED` outcomeとしてRejectする。

**TQR-IDM-011:** 競合解消のためTerminal Ticketを `VALID` に戻したり、先に成立したCheck-inを削除して別RequestをWinnerにしてはならない。

# Part VII — Result Classification

## 30. Canonical Check-in outcome

Staff operationは内部実装例外ではなく、少なくとも以下の論理Outcomeを区別可能にする。HTTP Status、error code文字列、response schemaは `SPEC-110` が定義する。

| Outcome | 意味 | Domain mutation |
|---|---|---|
| `CHECKED_IN` | このRequestが初回Check-inを正規Commitした | Ticket `VALID -> USED` + Check-in 1件 |
| `ALREADY_USED` | 先行Check-inが既に成立済み | なし。既存Check-in再利用 |
| `MALFORMED_QR` | format / version / token encoding不正 | なし |
| `UNKNOWN_TOKEN` | formatは正しいがToken relationなし | なし |
| `WRONG_PURPOSE` | Entry/Karaoke purpose不一致 | なし |
| `TOKEN_REVOKED` | rotation等で旧Tokenがrevoked | なし |
| `TICKET_CANCELED` | Ticket `CANCELED` | なし |
| `TICKET_EXPIRED` | Ticket `EXPIRED` またはauthoritative expiry条件成立 | 必要な正規expiry transitionを除きCheck-inなし |
| `RESERVATION_CANCELED` | Karaoke Reservation `CANCELED` | Check-inなし |
| `OUTSIDE_CHECKIN_WINDOW` | Karaoke等の通常受付時間条件不成立 | なし |
| `AUTHENTICATION_FAILED` | Staff Identity未検証 | なし |
| `AUTHORIZATION_DENIED` | Role / Capability不足 | なし |
| `TEMPORARY_UNAVAILABLE` | Auth / API / Business Database等一時障害で安全に判定不能 | なし |
| `CONSISTENCY_REVIEW_REQUIRED` | Token / Ticket / Reservation / Check-in invariant不整合 | 自動修復しない |

**TQR-OUT-001:** `UNKNOWN_TOKEN` と `MALFORMED_QR` から内部Ticket ID、Customer存在、Order存在を推測できる詳細を返さない。

**TQR-OUT-002:** `WRONG_PURPOSE` では「別用途の正規Ticketが存在する」以上の他Customer情報を返さない。運用上必要な表示は「受付用途が違う」までを基本とする。

**TQR-OUT-003:** `ALREADY_USED` は2回目のCheck-in成功ではない。既存Check-inが成立しているというterminal reuse resultである。

**TQR-OUT-004:** `TEMPORARY_UNAVAILABLE` を `UNKNOWN_TOKEN` / `TICKET_CANCELED` 等の業務failureへ偽装しない。未確定なら未確定としてretry可能にする。

---

## 31. `USED` outcome detail

Ticketが `USED` の場合、正常系では対応Check-inがちょうど1件存在しなければならない。

Staffへ返してよい既存Check-in summaryは少なくとも次の範囲とする。

- `already used` であること
- Entry / Karaokeの受付種別
- 既存Check-inのServer-side成立時刻
- 当日運用上必要なら、`SPEC-130` が定義する最小受付情報

元Staffの個人情報、内部DB key、Audit payload等は標準resultへ含めない。

**TQR-OUT-005:** Ticket `USED` だが対応Check-inが存在しない、または複数存在する場合は通常 `ALREADY_USED` として隠蔽せずConsistency Failureとする。

---

## 32. Staffへ返す最小受付情報

### 32.1 Entry

通常Entry Check-in resultでStaffへ返してよい情報は以下を上限の基準とする。

- Entry Ticketとして解決できたか
- Ticket category / public display label
- Ticket current state
- Check-in result
- already used時の既存Check-in時刻
- 本人照合が業務上必要と `SPEC-130` で明示された場合の最小Customer表示情報

### 32.2 Karaoke

通常Karaoke Check-in resultでは以下を許可する。

- Karaoke Ticket / Reservationとして解決できたか
- Reservation対象日
- `usage_start` / `usage_end`
- Ticket / Reservation current state
- Check-in result
- already used時の既存Check-in時刻
- 本人照合が必要と `SPEC-130` で明示された場合の最小Customer表示情報

**TQR-OUT-006:** QR Tokenだけを根拠にCustomerの全Order履歴、支払金額、Receipt、Entry / Karaoke / Goods全履歴、Profile編集情報、Email等をStaffへ返してはならない。

**TQR-OUT-007:** Staff operationから任意Customer検索へ横展開するCapabilityを本書は付与しない。

# Part VIII — Expiration

## 33. Entry Ticket expiration

Entry Ticketの具体的なイベント日時は外部設定値であり、本書は値を捏造しない。

Entry Ticketには、イベント運用上の入場権有効期間が設定される場合、その終了時刻以後は未使用Ticketを通常Check-inへ使用できない。

**TQR-CAN-001:** Entry Ticketの有効期間終了がauthoritativeに判定できた場合、未使用 `VALID` Ticketは `EXPIRED` へ進めてよい。境界時刻は開始を含み終了を含まない `[opens_at, closes_at)` として扱う。

**TQR-CAN-002:** Ticket State反映Jobが遅れてDB上 `VALID` に見えていても、Check-in時にauthoritative expiry predicateが成立していれば受付成功にしてはならない。

Entry受付期間の運用設定管理画面は `SPEC-130`、保存形式は `SPEC-100`、API contractは `SPEC-110` が定義する。

---

## 34. Karaoke Ticket expiration

Karaokeの通常受付時間の具体値は `SPEC-090` が定義する。

`SPEC-090` は少なくともReservation / Slotから次を一意に判定可能なRuleを提供しなければならない。

- 通常Check-in開始可能時刻
- 通常Check-in終了時刻
- boundary inclusion (`[opens_at, closes_at)`)
- 受付終了後に未使用Ticketを `EXPIRED` とみなせる条件

**TQR-CAN-003:** `SPEC-090` が定義する受付終了条件を過ぎた未使用Karaoke Ticketは通常Check-inへ使用できず、正規expiration処理で `VALID -> EXPIRED` とする。

**TQR-CAN-004:** Karaoke Ticket expirationだけを理由にReservationを `CANCELED` へ変更しない。Reservationの取消は別Domain operationである。

**TQR-CAN-005:** Karaoke Ticket expirationだけを理由にSlotを再販売可能へ戻さない。

# Part IX — Payment / Refund / Cancellation Boundary

## 35. Payment ConfirmationからのTicket発行境界

**TQR-CAN-006:** Entry Ticketは `PAY-CFM-006〜007` の正規Business Confirmationによる発行結果のみを受付可能Ticket sourceとする。

**TQR-CAN-007:** Karaoke Ticketは `PAY-CFM-008〜009` の正規Reservation / Ticket生成結果のみを受付可能Ticket sourceとする。

**TQR-CAN-008:** Browser Return、Checkout Session ID、Stripe receipt、Client payment success flag、Refund stateをTicket発行Triggerにしてはならない。

**TQR-CAN-009:** `PAY-CFM-*` retryですでに正規Ticketが存在する場合、本書のQR provisioningはそのTicketを再利用し、2枚目のTicketを作らない。

---

## 36. Financial RefundとTicket cancellationの分離

`SPEC-070` に従い、Financial RefundとTicket cancellationは別Operationである。

**TQR-CAN-010:** Refund `SUCCEEDED` だけを根拠にTicket stateを直接 `CANCELED` へ変更してはならない。

**TQR-CAN-011:** `PAY-RFD-*` から正規Domain cancellationが要求され、対象TicketのCancellation preconditionが成立した場合だけTicket cancellationを実行する。

**TQR-CAN-012:** Ticketが `USED` の場合、通常Cancellationを成立させない。Refund側は `PAY-RFD-003` / `PAY-RFD-007` に従いReview / Recovery境界へ進める。

---

## 37. Entry Ticket cancellation

Entry Ticketの通常Cancellation preconditionは少なくとも以下とする。

- Ticketが正規に一意解決できる
- Ticket State = `VALID`
- 対応Entry Check-inが存在しない
- 正規Cancellation causeが `SPEC-070` / 上位運用Ruleから渡される
- concurrent Check-inに負けていない

成功時:

```text
Entry Ticket VALID -> CANCELED
```

**TQR-CAN-013:** Entry Ticket cancellationはTicketを利用不可にする。既存QR TokenをStaffがScanした場合は `TICKET_CANCELED` を返し、Check-inしない。

**TQR-CAN-014:** Entry Ticket cancellationの副作用としてEntry sales capacityを本書だけの判断で回復しない。Capacity recoveryは `BR-TKT-011` と対象Cancellation policyのCanonical Ownerに従う。

**TQR-CAN-015:** Orderを支払前Stateへ戻さない。

---

## 38. Karaoke Ticket cancellation

Karaoke Reservation cancellationのCanonical Ownerは `SPEC-090` である。

Ticket側では、Reservationの正規Cancellation operationへ含める必須effectとして次を定義する。

- Reservation cancellation開始時に対応Karaoke Ticketを一意に解決
- Ticketが `VALID` でCheck-inなしなら `VALID -> CANCELED`
- Ticketが `USED` なら通常Reservation cancellationを成功させない
- Ticket `CANCELED` 後のQR Scanは `TICKET_CANCELED`

**TQR-CAN-016:** Reservation `CONFIRMED -> CANCELED` と、未使用Karaoke Ticketを利用不可にするeffectを中途半端に残してはならない。具体的なReservation側transaction構成は `SPEC-090` / `SPEC-100` が定義する。

**TQR-CAN-017:** Karaoke Ticket cancellationだけを理由にSlotを `AVAILABLE` へ戻したり再販売を成立させない。Slot resale policyは `SPEC-090` が定義する。

---

## 39. Refund / cancellation inconsistency

**TQR-CAN-018:** Financial Refund成功後にTicket cancellationが安全に成立しない場合、Refund成功を巻き戻したように扱わず、既存Ticket / Check-in historyを削除せず `PAY-RFD-007` のConsistency Reviewへ送る。

**TQR-CAN-019:** Payment / Refund不整合を理由に既存Check-inを削除・再生成して帳尻を合わせてはならない。

# Part X — Failure / Recovery Boundary

## 40. Transaction failure

Check-inのatomic transactionがCommitできない場合:

- `CHECKED_IN` を返さない
- Ticket `USED` の部分更新を残さない
- Check-inだけを残さない
- Clientは同じQRを安全にretryできる
- retry時はBusiness Database current stateを再評価する

**TQR-REC-001:** transaction rollback後のretryを新しいCheck-in Business Causeとして扱わない。

**TQR-REC-002:** deadlock / transient DB error等の具体retry回数・backoffは `SPEC-150` が定義する。

---

## 41. Response loss

Check-in transactionがCommitした後、responseがClientへ届かなかった場合:

1. Ticketは `USED`
2. Check-inは1件存在
3. Client retryは既存Check-inを解決
4. `ALREADY_USED` と既存成立時刻等のsummaryを返す
5. 2件目を作らない

**TQR-REC-003:** response delivery成功をCheck-in commit条件にしてはならない。

---

## 42. Token correlation failure

| Failure | Safe behavior |
|---|---|
| Token relation 0件 | `UNKNOWN_TOKEN`、state変更なし |
| 同一Tokenが複数Ticketへ解決 | `CONSISTENCY_REVIEW_REQUIRED`、自動選択しない |
| Token purposeとTicket type不一致 | `CONSISTENCY_REVIEW_REQUIRED` またはwrong-purposeの安全なreject。state変更なし |
| Token relationが存在するがTicket不存在 | `CONSISTENCY_REVIEW_REQUIRED` |
| Active Tokenが同一Ticketに複数 | `CONSISTENCY_REVIEW_REQUIRED`。どれかを便宜的に採用しない |
| encrypted token materialが復元不能 | Customer QR表示Failure。Ticket state変更なし |

**TQR-REC-004:** Correlation Failureを解消するためTicket Owner、Ticket State、Check-inを推測変更しない。

---

## 43. Ticket / Check-in inconsistency

次は上流Invariant違反であり、自動通常Check-inとして扱わない。

- Ticket `USED` だがCheck-in 0件
- Ticket `USED` だがCheck-in 2件以上
- Ticket `VALID` だがCheck-in 1件以上
- Ticket `CANCELED` / `EXPIRED` だが、そのterminal transition後に成立したと見えるCheck-inがある
- Karaoke Reservation `CANCELED` だがTicket `VALID`
- Karaoke TicketとReservation Customer / relationが一致しない

**TQR-REC-005:** 上記を検出した場合、既存確定Dataを削除・上書きせずConsistency Review対象として追跡する。

**TQR-REC-006:** Staffへは `CONSISTENCY_REVIEW_REQUIRED` 相当の運用failureを返し、通常受付成功にしない。

具体的なCase作成、修復判定、operator手順は `SPEC-150`、観測・auditは `SPEC-160` が定義する。

---

## 44. Auth Service outage

**TQR-REC-007:** Staff Identityを安全に検証できないAuth Service障害中は、新しいEntry / Karaoke Check-inを成立させない。

**TQR-REC-008:** Customer QR表示でもAuthentication / Ownershipを安全に確認できない場合はQR Tokenを返さない。

**TQR-REC-009:** Auth障害を理由にTicket、QR Token relation、Check-in、Reservation、Orderを削除・取消・Owner変更しない。

Service回復後はcurrent Authentication / Authorization / Domain stateを再評価する。

---

## 45. Business Database / API outage

**TQR-REC-010:** Business Database current stateを確認できない場合、Clientに保存済みのQR validityやprevious readを根拠にCheck-in成功を確定しない。

**TQR-REC-011:** API一時障害でCheck-in結果が不明な場合、Staff UIは成功と断定せずretry / status再確認可能な結果を扱う。具体UXは `SPEC-130`。

**TQR-REC-012:** Database復旧後のretryはTicket単位のsingle-use invariantを再評価する。

---

## 46. Offline端末

本システムはoffline-first Check-inを採用しない。

**TQR-REC-013:** Staff端末だけでQR formatや署名相当を確認できても、Business Database current state、Staff authorization、single-use atomic transitionを確認せずCheck-in成功を確定してはならない。

**TQR-REC-014:** QR画像の読取り自体を一時的にofflineで実施しても、最終Check-in成立はServer-side authoritative operationの成功を必要とする。

将来offline Check-inを導入する場合は `INV-010-05`, `INV-010-08`, `INV-010-10` を同等以上に維持する上流仕様変更が必要であり、本書の通常実装には含めない。

# Part XI — Security Boundary

## 47. QR TokenのSecurity原則

**TQR-SEC-001:** QR Tokenは推測困難な256-bit random opaque valueとする。

**TQR-SEC-002:** TokenをTicket ID、Order ID、Reservation ID、Customer IDの代替として扱わない。

**TQR-SEC-003:** Entry TokenをKaraoke Purposeへ、Karaoke TokenをEntry Purposeへ再利用しない。

**TQR-SEC-004:** QR TokenをCustomer Owner Authenticationとして使用しない。

**TQR-SEC-005:** QR Payloadへ不必要な個人情報、決済情報、内部識別子をencodeしない。

**TQR-SEC-006:** QR ScanはStaff Authorization後に実行し、public anonymous token validation serviceとして公開しない。

**TQR-SEC-007:** invalid / unknown QR responseで内部Ticket ID、Order reference、Customer情報、Token digest等を不必要に開示しない。

**TQR-SEC-008:** Ticket state、Owner、Check-in stateをClient-supplied valueだけから変更しない。

**TQR-SEC-009:** QR Tokenをaccess log、analytics、URL、exception messageへ無制限に出力することを前提にしない。具体redaction / logging controlは `SPEC-140` / `SPEC-160` が定義する。

**TQR-SEC-010:** Token compromise対策はrotationだけに依存せず、Staff authentication、purpose binding、Ticket current state確認、single-use atomic Check-inを重ねて成立させる。

---

## 48. Security Controlの委譲

以下は `SPEC-140` がCanonical Ownerである。

- QR Token protection keyの保管・rotation
- Encryption algorithm / key management具体方式
- Secret injection
- rate limit / abuse detection
- CSRF / CORS / CSP
- Browser cache / sensitive response policy
- Log redaction
- Staff device security
- brute-force / enumeration mitigationの具体閾値

`SPEC-140` は本書のToken entropy、purpose separation、Owner authorization、Staff authorization、single-use invariantを弱化してはならない。

# Part XII — System of Record / Responsibility Boundary

## 49. System of Record

| 情報 | Authority |
|---|---|
| Auth Identity / Session validity | Supabase Auth (`SPEC-060`) |
| Ticket Owner / State | Business Database |
| Karaoke Reservation current state | Business Database |
| QR Token correlation / lifecycle | Business Database |
| Entry / Karaoke Check-in | Business Database |
| Payment external result | Stripe (`SPEC-070`) |
| 本システム内Order confirmation | Business Database (`SPEC-070`) |
| Browser QR表示状態 | Authorityではない |
| Staff UI previous scan result | Authorityではない |

**TQR-SEC-011:** Ticket / Check-inの最終状態をBrowser local state、QR画像、Staff端末cache、Stripe objectだけから決定してはならない。

---

## 50. Web / API / Database boundary

上流System Boundaryを維持する。

```text
Customer Browser / Staff Browser
          -> Next.js Web
          -> Hono API
          -> Business Database
```

- WebはQR表示 / Scanner UIを担う。
- Hono APIはAuthentication / Authorization、Token validation、Ticket state evaluation、Check-in Business Logicを担う。
- Business DatabaseはTicket / Token relation / Check-in current business truthを保持する。
- Next.js WebまたはBrowserからBusiness Databaseを直接更新しない。

# Part XIII — Downstream Canonical Owner Boundary

## 51. `SPEC-090 Karaoke Reservation`

`SPEC-090` は少なくとも以下を定義する。

- Karaoke Slot / Hold / Reservation詳細
- Reservation cancellation / Slot resale policy
- Karaoke通常Check-in windowの具体的算出Rule
- `usage_start` / `usage_end` と受付開始 / 終了の関係
- Ticket expirationへ渡すtime predicate

`SPEC-090` は本書のKaraoke Ticket single-use、purpose separation、Staff Authorization、atomic Check-inを弱化してはならない。

---

## 52. `SPEC-100 Database Design`

`SPEC-100` は少なくとも以下を本書から具体化する。

- Ticket / QR Token / Check-inのtable / column
- Token digest / protected material
- TicketごとのActive Token cardinality
- TicketごとのCheck-in最大1件
- Token lookup uniqueness
- `VALID -> USED` とCheck-in insertのtransaction / lock / constraint
- cancellation / check-in concurrencyを安全にするDB制約
- correlation integrity

本書は具体SQL / constraint名 / index名を定義しない。

---

## 53. `SPEC-110 API Specification`

`SPEC-110` は以下を定義する。

- Customer Ticket / QR取得Endpoint
- Staff Entry / Karaoke Scan / Check-in Endpoint
- Request / Response schema
- HTTP Status
- canonical error code
- request correlation / transport idempotency field
- QR Payload input validation schema

API contractは本書のBusiness Cause、Outcome、Authorization順序、atomicityを変更してはならない。

---

## 54. `SPEC-130 Admin / Staff Specification`

`SPEC-130` は以下を定義する。

- Staff QR Scanner画面
- Entry / Karaoke modeのUI
- Check-in result表示
- Staffへ表示する最小Customer情報の具体field
- AdministratorのTicket運用参照
- Token compromise recovery UIが必要な場合の操作画面

UIがServer-side purpose / permission / Ticket state checkを代替してはならない。

---

## 55. `SPEC-150 Reliability / Recovery`

`SPEC-150` は以下を定義する。

- DB transaction failure retry
- Auth / API / DB outage recovery
- Token correlation不整合のRunbook
- Ticket / Check-in inconsistency review
- Refund成功 / Ticket cancellation未完了のRunbook
- QR Token compromise reporting / operator procedure

本書はrunbook手順やretry回数を先取りしない。

---

## 56. `SPEC-160 Observability / Audit`

`SPEC-160` は以下のAudit Event schemaを定義する。

- successful Check-in
- already-used rescan
- invalid / wrong-purpose scan
- authorization failure
- token rotation / revocation
- cancellation
- consistency failure

本書はevent schema / retentionを定義しない。

# Part XIV — Traceability

## 57. Rule Group -> Functional Requirement

| 本書Rule | 主なFunctional Requirement |
|---|---|
| `TQR-TKT-001〜004` | `FR-TKT-014〜026`, `FR-MYP-003〜004`, `FR-XFN-013`, `FR-XFN-028〜029` |
| `TQR-TKT-005〜010` | `FR-KRK-022〜027`, `FR-MYP-005〜006`, `FR-XFN-013`, `FR-XFN-018` |
| `TQR-TOK-001〜020` | `FR-TKT-020`, `FR-KRK-025〜026`, `FR-MYP-004`, `FR-MYP-006`, `FR-XFN-015`, `FR-XFN-017〜018`, `FR-XFN-024` |
| `TQR-DSP-001〜010` | `FR-TKT-019〜024`, `FR-KRK-024〜027`, `FR-MYP-003〜006`, `FR-XFN-003`, `FR-XFN-017〜018`, `FR-XFN-028〜029` |
| `TQR-AZ-001〜004` | `FR-STF-001〜016`, `FR-XFN-004`, `FR-XFN-025`, `FR-XFN-032` |
| `TQR-CHK-001〜016` | `FR-STF-002〜015`, `FR-XFN-015`, `FR-XFN-018`, `FR-XFN-030〜031` |
| `TQR-IDM-001〜011` | `FR-STF-004〜007`, `FR-STF-010〜013`, `FR-XFN-015`, `FR-XFN-024`, `FR-XFN-031` |
| `TQR-OUT-001〜007` | `FR-STF-003〜016`, `FR-XFN-025`, `FR-XFN-030〜032` |
| `TQR-CAN-001〜019` | `FR-TKT-024`, `FR-KRK-024〜027`, `FR-ADM-007〜008`, `FR-XFN-020〜021`, `FR-XFN-024` |
| `TQR-REC-001〜014` | `FR-XFN-020〜021`, `FR-XFN-024〜025`, `FR-XFN-030〜032`, `FR-AUTH-014` |
| `TQR-SEC-001〜011` | `FR-XFN-003〜004`, `FR-XFN-007`, `FR-XFN-015`, `FR-XFN-017〜018`, `FR-XFN-033` |

---

## 58. Rule Group -> Domain Rule / Invariant

| 本書Rule | 主なDomain Trace |
|---|---|
| Ticket issuance / cardinality | `BR-TKT-005〜008`, `BR-KRK-013〜021`, `DI-030-003`, `DI-030-009` |
| Ticket state / display | `BR-TKT-009〜011`, `BR-KRK-021〜024`, `DI-030-007`, `DI-030-010` |
| purpose separation | `BR-KRK-022`, `BR-CHK-001`, `DI-030-007` |
| Check-in precondition | `BR-TKT-009`, `BR-KRK-023〜024`, `BR-CHK-001〜008` |
| atomicity | `BR-CHK-003〜004`, `DI-030-007`, `DI-030-012` |
| retry / rescan | `BR-CHK-004〜005`, `DI-030-007`, `DI-030-012` |
| cancellation | `BR-TKT-010〜011`, `BR-KRK-017`, `BR-KRK-024` |
| ownership | `BR-USR-001`, `BR-USR-004〜007`, `BR-TKT-008`, `BR-KRK-021`, `DI-030-010` |
| recovery | `BR-ORD-010`, `DI-030-012` |

---

## 59. Rule Group -> User Flow / Page

| 本書Rule | Flow / Page Trace |
|---|---|
| Entry Ticket / QR display | `UF-MYP-001〜002`, `UF-CHK-001`, `PG-MYP-005〜007`, `PG-XFN-003` |
| Karaoke Ticket / QR display | `UF-MYP-001〜002`, `UF-KRK-003`, `UF-CHK-002`, `PG-MYP-008〜010`, `PG-XFN-003` |
| Entry Check-in | `UF-CHK-001` |
| Karaoke Check-in | `UF-CHK-002` |
| response loss / retry / service failure | `UF-XFN-003〜004`, `UF-CHK-001〜002` |
| Ownership failure | `UF-MYP-002`, `PG-XFN-003` |

本書はStaff個別Page IDを新設しない。Staff Pageは `SPEC-130` がCanonical Ownerである。

---

## 60. Rule Group -> Authentication / Authorization

| 本書Rule | `SPEC-060` Trace |
|---|---|
| Customer QR表示 | `AR-SES-*`, `AR-ID-*`, `AR-OWN-001〜008`, `AR-AZ-007`, `AR-FAIL-*` |
| Entry Check-in | `AR-ROLE-001〜005`, `AR-ROLE-012`, `AR-ROLE-015`, `AR-AZ-013`, `AR-FAIL-001〜006` |
| Karaoke Check-in | `AR-ROLE-001〜005`, `AR-ROLE-012`, `AR-ROLE-015`, `AR-AZ-014`, `AR-FAIL-001〜006` |
| Token recovery | `AR-ROLE-002〜005`, `AR-ROLE-014`, `recovery.exception.execute` |
| Staff data minimization | `AR-ROLE-015`, `AR-FAIL-006` |

`AR-AZ-015` はGoods Handoff用であり、本書のTicket Check-inへ誤適用しない。

---

## 61. Rule Group -> Payment / Refund

| 本書Rule | `SPEC-070` Trace |
|---|---|
| Entry Ticket source | `PAY-CFM-001〜007`, `PAY-IDM-*` |
| Karaoke Ticket source | `PAY-CFM-001〜005`, `PAY-CFM-008〜009`, `PAY-IDM-*` |
| 支払未確定Ticket禁止 | `PAY-BRW-001〜003`, `PAY-CFM-002〜004` |
| Refund / Entry cancellation | `PAY-RFD-001〜007`, 特に `PAY-RFD-003`, `PAY-RFD-006〜007` |
| Refund / Karaoke cancellation | `PAY-RFD-001〜007`, `PAY-RFD-003`, `PAY-RFD-006〜007` |
| Payment / cancellation inconsistency | `PAY-REC-001〜004`, `PAY-RFD-007` |

---

## 62. Rule Group -> System Invariant

| System Invariant | 本書での具体化 |
|---|---|
| `INV-010-03` Ticketを二重発行しない | Token provisioning / QR reload / retryは既存Ticketを再利用し、Ticketを新規発行しない |
| `INV-010-05` QR Ticketを二重利用させない | Ticket単位のCheck-in Business Cause、atomic `VALID -> USED` + Check-in、最大1件 |
| `INV-010-07` 決済確定と権利発行を中途半端に残さない | `PAY-CFM-*` 正規Ticketだけを利用し、Ticket / Check-inも部分Commit禁止 |
| `INV-010-08` 所有権と権限をServer-sideで検証 | Owner QR表示、Staff Role / Capability、purpose / Ticket typeをServer-side検証 |
| `INV-010-10` 外部処理の再送に耐える | Scan retry / response loss / concurrent devicesで2件目のCheck-inを作らない |

---

## 63. Required upstream trace coverage

本書の主要Ruleは少なくとも次の上流IDへ追跡可能である。

### Functional Requirements

- `FR-TKT-014〜026`
- `FR-KRK-022〜027`
- `FR-MYP-003〜006`
- `FR-ADM-007〜008`
- `FR-STF-001〜016`
- `FR-XFN-003〜004`
- `FR-XFN-013`
- `FR-XFN-015`
- `FR-XFN-017〜018`
- `FR-XFN-020〜021`
- `FR-XFN-024〜025`
- `FR-XFN-030〜032`

### Domain Rules / Invariants

- `BR-TKT-005〜011`
- `BR-KRK-013〜024`
- `BR-CHK-001〜008`
- `BR-USR-001`, `BR-USR-004〜007`
- `DI-030-003`
- `DI-030-007`
- `DI-030-009〜010`
- `DI-030-012`

### User Flow / Page

- `UF-MYP-001〜002`
- `UF-CHK-001〜002`
- `UF-XFN-003〜004`
- `PG-MYP-005〜010`
- `PG-XFN-003`

### Authentication / Authorization

- `AR-OWN-001〜008`
- `AR-ROLE-001〜015`
- `AR-AZ-013〜014`
- `AR-FAIL-001〜006`

`AR-AZ-015` はGoods Handoffであり、Ticket Check-inの直接Ruleではないため、同一用途としては参照しない。

### Payment

- `PAY-CFM-001〜009`
- `PAY-RFD-001〜007`
- `PAY-REC-001〜004`

### System Invariants

- `INV-010-03`
- `INV-010-05`
- `INV-010-07〜08`
- `INV-010-10`

# Part XV — Acceptance Criteria

## 64. Ticket / QR acceptance

実装は少なくとも以下を満たさなければならない。

1. Order `CONFIRMED` 前にEntry / Karaokeの有効Ticket / QRを返さない。
2. Entry Ticketは正規購入数量単位ごとに最大1件である。
3. Karaoke TicketはReservationごとに最大1件である。
4. Ticket Stateは `VALID / USED / CANCELED / EXPIRED` 以外を追加しない。
5. Ticket OwnerをQR TokenやClient owner inputから決定しない。
6. QR Tokenは `r39x1.ent.*` / `r39x1.krk.*` のpurpose-separated 256-bit opaque tokenである。
7. QR TokenにTicket ID、Order ID、個人情報を直接encodeしない。
8. Entry / Karaoke purposeをPayload markerだけでなくServer-side relation / Ticket Typeでも確認する。
9. QR page reloadで通常Tokenをrotateしない。
10. 同一Ticketに通常Active Tokenを最大1件にする。
11. compromise rotation後の旧Tokenは利用不可である。
12. Customer QR表示でAuthentication / Business Profile / Ownership / current stateをServer-side確認する。
13. `USED` / `CANCELED` / `EXPIRED` Ticketへ利用可能QRを返さない。

---

## 65. Check-in acceptance

1. Entry Check-inはverified Identity + active `STAFF` + `entry_checkin.execute` を要求する。
2. Karaoke Check-inはverified Identity + active `STAFF` + `karaoke_checkin.execute` を要求する。
3. `ADMINISTRATOR` 単独ではCheck-inできない。
4. Staff authorization前にQR validityを不必要に開示しない。
5. Entry QRをKaraokeへ、Karaoke QRをEntryへ使用できない。
6. malformed / unknown / wrong purposeでTicket stateを変更しない。
7. `VALID -> USED` とCheck-in recordを同一atomic operationで成立させる。
8. 1 TicketにつきCheck-inは最大1件である。
9. double tap / retry / response lossで2件目を作らない。
10. 複数Staff端末の同時Scanで最大1件だけ初回成功する。
11. Loserは既存Check-inを `ALREADY_USED` として再利用する。
12. `USED` Ticketを再Check-inしない。
13. `CANCELED` / `EXPIRED` Ticketを受付成功にしない。
14. Karaoke Reservation `CANCELED` を受付成功にしない。
15. Karaoke通常受付時間条件外を通常Staff Capabilityで成功させない。
16. Check-in成功後のreload / rescanで重複利用を成立させない。
17. transaction failure時にTicketだけ `USED` またはCheck-inだけ存在する部分成功を残さない。
18. Ticket `USED` とCheck-in relationが矛盾する場合は自動で帳尻を合わせずReviewへ送る。

---

## 66. Payment / cancellation / failure acceptance

1. Refund `SUCCEEDED` だけでTicketを自動 `CANCELED` にしない。
2. `PAY-RFD-*` から正規Domain cancellationが要求された場合だけTicket cancellationを適用する。
3. `USED` Ticketを通常Cancellationへ進めない。
4. Entry Ticket cancellationだけでsales capacityを自動回復しない。
5. Karaoke Ticket cancellationだけでSlot再販売を成立させない。
6. Payment / Refund不整合で既存Check-inを削除しない。
7. Auth Service障害時に未検証StaffへCheck-inを許可しない。
8. Auth障害で既存Ticket / Check-inを削除・取消しない。
9. Business Database障害時にClient cacheだけでCheck-in成功を確定しない。
10. offline Staff端末だけでCheck-in成功を確定しない。
11. Token correlation不整合、Ticket / Check-in不整合をConsistency Reviewへ送る。
12. Recoveryで既存の正規Ticket / Check-in / Payment履歴を破壊して整合したように見せない。

# Part XVI — Prohibited Implementations

## 67. 禁止事項

以下は本仕様違反である。

- Ticket IDまたはDB serialをQR値としてそのまま表示する
- QR TokenをOwner authenticationに使う
- QR TokenをURL queryへ入れてOwner QR pageを開けるようにする
- ClientでTokenを生成する
- Entry / Karaokeで同じpurpose relationを使う
- Staff UIのscan modeだけでTicket typeを決める
- QR検証APIの「valid」結果を後続consumeのauthorization tokenとして使い、state再評価を省略する
- Ticketを先に `USED` にCommitしてからCheck-inを別transactionで作る
- Check-inを先に作ってからTicketを別transactionで `USED` にする
- Request IDごとに別Check-inを許す
- retry時に `USED` Ticketへ2件目のCheck-inを追加する
- `ADMINISTRATOR` だからStaff Check-inを許可する
- Auth障害時に「当日運用優先」で未検証Check-inを許可する
- QR ScanからCustomer全Order履歴を返す
- Refund成功EventだけでTicketをcancelする
- Entry cancellationだけでcapacityを戻す
- Karaoke Ticket cancellationだけでSlotを再販売する
- BrowserのQR表示状態をTicket有効性の権威値にする
- offline端末のlocal used listだけで最終Check-inを確定する
- Ticket / Check-in不整合を履歴削除で隠す
- QR page reloadごとに無条件rotationして旧QRを即時無効化する

# Part XVII — Output / Implementation Handoff

## 68. AI実装エージェントへの必須解釈

実装エージェントは本書を実装する際、少なくとも次を一つの設計単位として扱う。

1. Ticketは上流State Machineを変更しない。
2. QR TokenはTicket IDではなく、Ticketへ相関する別security objectである。
3. purposeはPayloadとServer-side relationの両方で検証する。
4. Owner QR表示とStaff Scan authorizationは別経路である。
5. Check-inのidempotency keyは本質的にはTicket single-use identityであり、Request IDだけではない。
6. `VALID -> USED` とCheck-in recordをtransaction境界で分離しない。
7. retry / concurrent scanでは既存Check-inを再利用する。
8. Refund financial stateとTicket stateを混同しない。
9. Ticket cancellationはcapacity / Slot resaleまで自動決定しない。
10. 物理DB / API / Staff UI / Runbook / Audit schemaは各下流Canonical Ownerへ委譲する。

---

## 69. 上流仕様変更要求

なし。

本書の策定にあたり、`SPEC-000`〜`SPEC-070` のState、Requirement、Business Rule、User Flow、Page、Authentication / Authorization、Payment / Refund境界を変更しなければ成立しない矛盾は確認されなかった。

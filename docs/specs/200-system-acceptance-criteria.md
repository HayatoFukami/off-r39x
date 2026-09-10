---
spec_id: SPEC-200
title: System Acceptance Criteria
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
  - SPEC-020
  - SPEC-030
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
related_specs:
  - SPEC-040
  - SPEC-050
---

# 200 System Acceptance Criteria

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形について、個別仕様でCanonical化されたBusiness、Domain、Authentication / Authorization、Order / Payment、Ticket / QR / Check-in、Karaoke、Goods、Email、Administrator / Staff、Database、API、Security、Reliability / Recovery、Observability / Audit、Test、Infrastructure / Deployment、AI Development Guidelineを横断し、**1つのreleaseをProductionで受入可能と判定するためのSystem-level Acceptance Criteria、Evidence contract、Blocking rule、および最終判定方法**を定義する。

本書は少なくとも次のCanonical Ownerである。

- System-level Acceptance Criteria
- Release Acceptance Boundary
- Production Acceptance Boundary
- Cross-spec Acceptance Matrix
- System Invariant Acceptance
- Business Capability Acceptance aggregation
- Security Acceptance aggregation
- Reliability / Recovery Acceptance aggregation
- Observability / Audit Acceptance aggregation
- Infrastructure / Deployment Acceptance aggregation
- Test EvidenceからSystem Acceptanceへの接続
- Production Release Evidence contract
- Acceptance failure / blocking rule
- Acceptance evidence identification / retention contract
- Canonical specification completenessをSystem Acceptanceへ接続するrule

本書は、上流Canonical Ownerが既に定義したBusiness Rule、Domain State、Page、API Contract、Database Physical Schema、Security Control、retry / timeout / reconciliation cadence、Observability taxonomy、Test Case、Infrastructure topology、AI implementation ruleを変更または再定義しない。

**SPEC-200の責務は「何を実装するか」を追加することではなく、既存Canonical Ruleを満たしたことを、同一releaseに紐づく再現可能なEvidenceでどのように判定するかを固定すること**である。

本書はMVP、Step1、Step2、初期リリース等でAcceptanceを分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は次へ適用する。

- Pull Request / merge candidateからProduction releaseまでのacceptance evidence chain
- release identity、source commit、spec version set、migration set、build artifact identity
- `INV-010-01〜10`
- Current Canonical `FR-*`, `BR-*`, `DI-030-*`
- `AR-*`, `PAY-*`, `TQR-*`, `KRK-*`, `DB-*`, `API-*`, `EML-*`
- `ADM-*`, `STF-*`, `OPS-*`
- `SEC-*`, `REL-*`, `OBS-*`, `TST-*`, `TC-*`, `INF-*`, `DEV-*`
- staging pre-release evidence
- Production promotion evidence
- Production deployment / readiness / post-deploy evidence
- backup / restore / reconciliation readiness evidence
- implementation traceability / self-verification evidence
- open Upstream Change RequestのAcceptance影響判定

本書は次をCanonicalには定義しない。

- User Flow詳細: `SPEC-040`
- Page / Screen詳細: `SPEC-050`
- Domain State / Business Rule: `SPEC-030`
- Role / Capability: `SPEC-060`
- Payment / Refund lifecycle: `SPEC-070`
- QR / Check-in semantics: `SPEC-080`
- Karaoke Slot / Hold / Reservation rule: `SPEC-090`
- DB table / column / constraint / transaction primitive: `SPEC-100`
- API endpoint / schema / HTTP status: `SPEC-110`
- Email lifecycle / worker algorithm: `SPEC-120`
- Administrator / Staff Page / Operation UX: `SPEC-130`
- Security Control値: `SPEC-140`
- timeout / retry / backoff / reconciliation / Recovery Runbook: `SPEC-150`
- log / metric / alert / Audit taxonomyとretention値: `SPEC-160`
- Test Case contract / Test Group / runner policy: `SPEC-170`
- hosting / runtime / secret placement / migration procedure / deployment procedure: `SPEC-180`
- repository / source dependency / implementation workflow: `SPEC-190`

---

## 3. 依存仕様と採用理由

`depends_on` はSystem Acceptance判定の直接入力となるCanonical Ownerだけを採用する。本書では、完成システム横断のAcceptanceを判定するため、次の18仕様を直接利用する。

| Spec | Acceptance Criteriaへの入力 | 接続する主なEvidence | SPEC-200が再定義しないCanonical value |
|---|---|---|---|
| `SPEC-000` | Canonical Owner、依存、情報源優先順位、UCR、仕様改訂規則 | spec set validation、UCR status | Governance rule |
| `SPEC-010` | System Boundary、System of Record、`INV-010-01〜10` | Invariant test evidence、release architecture validation | System Boundary / Invariant本文 |
| `SPEC-020` | Current `FR-*` | semantic coverage、capability E2E/API evidence | Functional Requirement本文 |
| `SPEC-030` | `BR-*`, `DI-030-*`, Domain State | domain / DB / integration evidence | State / Rule / Invariant本文 |
| `SPEC-060` | `AR-*`, Role / Capability / ownership | auth/security/API evidence | Authentication / Authorization semantics |
| `SPEC-070` | `PAY-*` | payment / refund / webhook / reliability evidence | Payment lifecycle / idempotency semantics |
| `SPEC-080` | `TQR-*` | QR / check-in / concurrency / security evidence | QR / Ticket / Check-in semantics |
| `SPEC-090` | `KRK-*` | hold / slot / reservation / concurrency evidence | Karaoke time / hold / no-resale等の値 |
| `SPEC-100` | `DB-*`, named constraints / migration / lock semantics | G2/G3/G10、Production migration evidence | Physical schema / isolation / locks |
| `SPEC-110` | `API-*`, Hono RPC / Zod / Operation contract | G4/G5、route manifest、runtime schema evidence | Method / path / schema / error contract |
| `SPEC-120` | `EML-*` | email worker / provider / failure / recovery evidence | Notification lifecycle / claim / provider semantics |
| `SPEC-130` | `ADM-*`, `STF-*`, `OPS-*` | Admin / Staff E2E/API/security evidence | Admin / Staff UI / operation contract |
| `SPEC-140` | `SEC-*` | G5、config validation、secret / crypto evidence | Security Control / Fail Closed values |
| `SPEC-150` | `REL-*` | G6、fault injection、reconciliation / recovery evidence | timeout / retry / cadence / Runbook values |
| `SPEC-160` | `OBS-*` | G7、audit atomicity、dashboard / alert / retention evidence | taxonomy / threshold / retention values |
| `SPEC-170` | `TST-*`, `TC-*`, G1〜G10、traceability | test-manifest、test run result | Test contract / retry / quarantine policy |
| `SPEC-180` | `INF-*`, release / environment / deployment contract | release-manifest、staging / Production deployment evidence | topology / major version / secret placement / gate |
| `SPEC-190` | `DEV-*`, self-verification / traceability | completion report、rule-code-map、static validation | repository / implementation rule |

`SPEC-040` と `SPEC-050` はCurrent User Flow / Page acceptanceの背景として強く関連するが、本書はそれらのRuleを直接再評価せず、`SPEC-170` のE2E / traceability evidenceおよびCurrent Canonical spec set経由で検証するため `related_specs` とする。

**ACC-GEN-001:** System Acceptance evaluatorは、Acceptance Matrixが参照するCanonical Ownerを直接dependencyとして認識し、単に「過去に存在する」ことを理由にdependencyを追加しない。

**ACC-GEN-002:** 上流仕様間の矛盾はSPEC-200内で解釈変更して解消せず、`SPEC-000` のUpstream Change Request規則へ送る。

---

## 4. Current UCR statusとAcceptanceへの影響

本書作成時点では次を**未反映**として扱う。

```text
UCR-130-001〜006
UCR-150-001〜002
UCR-170-001
```

**ACC-GEN-003:** UCRは対象Canonical Owner本文へ反映されるまでCanonical behaviorではない。UCR-only Capability、API、Recovery command、UI、Index、Operation IDをSystem Acceptanceの必須実装として先取りしない。

**ACC-GEN-004:** open UCRはAcceptance Manifestへ必ず記録し、少なくとも `ucr_id`, `target_spec`, `current_status`, `acceptance_impact`, `affected_current_rule_ids[]`, `blocking` を持たせる。

### 4.1 `UCR-130-001〜006`

`UCR-130-001〜006` は、Current Canonical `FR-ADM-*` / `FR-STF-*` の一部を完成実装するためのCapability / API / read / query / index不足を明示している。

**ACC-GEN-005:** Current Canonical Requirementを満たすために未反映 `UCR-130-*` の内容が必要であり、現行Canonical contractだけでは該当Requirementの実装・検証が成立しないreleaseは、UCR内容を仮実装してAcceptanceしてはならず、該当 `ACC-BIZ-*` をFAILとしてSystem Acceptanceを `REJECTED` とする。

特に `FR-ADM-014〜015` は `UCR-130-001〜002` 未反映のまま安全なmutation contractを成立させられないことが `SPEC-130` で明示されているため、Current Canonical setが同じ状態であるreleaseは該当Business Capabilityをpassにできない。

### 4.2 `UCR-150-001〜002`

`UCR-150-001〜002` は、対象別dedicated manual recovery commandとそれに接続するUIを要求する未反映UCRである。

**ACC-GEN-006:** `UCR-150-001〜002` だけに存在するdedicated Recovery API / UIをAcceptance対象として発明しない。ただしCurrent `SPEC-150` が要求するmanual recovery capabilityが現行Canonical operationだけでは完成システムとして成立しないことがEvidence上確認された場合、そのCurrent Canonical gap自体をAcceptance blockerとして記録する。

### 4.3 `UCR-170-001`

`UCR-170-001` は、Current API routeの一部にOperation IDが不足するCanonical completeness gapを記録する。

**ACC-GEN-007:** `UCR-170-001` 未反映中は不足Operation IDをSPEC-200または実装が発明しない。`SPEC-170` が明示するmethod + path + capability単位のTestをCurrent evidenceとして使用する。

**ACC-GEN-008:** `UCR-170-001` の対象routeについてOperation IDベースの完全coverageを「達成済み」と偽装してはならない。Acceptance Manifestは当該gapをopen UCRとして保持する。

---

# Part I — System Acceptance Model

## 5. Canonical Terms

| Term | 意味 |
|---|---|
| Release | 1つのsource commit、migration set、build artifact set、spec version setから構成される受入対象 |
| Release Ref | `SPEC-180` のimmutable release identifier。source commit SHAを基礎とする |
| Release Manifest | `SPEC-180` の `release-manifest.json`。artifact identityのCanonical evidence |
| Spec Version Set | 当該releaseの実装・Test・Acceptanceが参照したCanonical specification IDとversionの集合 |
| Acceptance Evidence | Acceptance RuleのPass / Failを再現可能に判断するmachine-readable resultまたはimmutable artifact |
| Acceptance Manifest | 本書が定義する、既存release / test / deployment / development evidenceを参照して最終判定を束ねるmachine-readable artifact |
| Blocking Criterion | Fail / missing / identity mismatch時に次stageまたはSystem Acceptanceを通過させないcriterion |
| Informational Finding | Canonical MUST違反を示さず、必須Acceptance Evidenceを代替しない非blocking finding |
| Evidence Identity Match | Evidenceが同一release_ref / git_sha / migration set / spec setへ帰属すると検証できる状態 |
| Re-evaluation | 同一または新releaseについてAcceptance criteriaを再実行し、新しいEvidence setで判定すること |
| Production Promotion | staged / validated artifactをProduction traffic対象へ昇格する操作 |
| System Acceptance | Production deploy後のrequired evidenceを含め、全Blocking CriterionがPassした最終状態 |

---

## 6. Rule ID体系

本書のNormative Ruleは次のPrefixを使用する。

| Prefix | Category |
|---|---|
| `ACC-GEN-*` | General acceptance / evidence model |
| `ACC-INV-*` | System Invariant |
| `ACC-BIZ-*` | Functional / Business capability |
| `ACC-AUTH-*` | Authentication / Authorization |
| `ACC-PAY-*` | Order / Payment / Refund |
| `ACC-TQR-*` | Ticket / QR / Check-in |
| `ACC-KRK-*` | Karaoke |
| `ACC-GDS-*` | Goods |
| `ACC-EML-*` | Email / Notification |
| `ACC-DB-*` | Database |
| `ACC-API-*` | API |
| `ACC-SEC-*` | Security |
| `ACC-REL-*` | Reliability / Recovery |
| `ACC-OBS-*` | Observability / Audit |
| `ACC-TST-*` | Test evidence |
| `ACC-INF-*` | Infrastructure / Deployment |
| `ACC-DEV-*` | Development guideline evidence |
| `ACC-RELSE-*` | Release / Production acceptance |
| `ACC-TRC-*` | Cross-spec traceability |

Rule IDは永続かつ一意とし、別意味へ再利用しない。

---

## 7. Acceptance対象releaseのIdentity

### 7.1 Release identity

System Acceptance対象は、最低限次で一意に識別されなければならない。

```text
release_ref
release_manifest_sha256
git_sha
migration_set_sha256
api_image_digest
Vercel deployment identity
Railway deployment identity set
spec_versions
```

`release_ref`, `git_sha`, `migration_set_sha256`, `api_image_digest` 等のartifact identity値は `SPEC-180` のRelease ManifestをCanonical sourceとし、Acceptance Manifestは参照・一致検証を行う。

**ACC-GEN-009:** Acceptance Manifest内のrelease identity fieldがRelease Manifestと一致しない場合はEvidence Identity Match失敗とし、System Acceptanceを `REJECTED` とする。

**ACC-GEN-010:** 別commit、別migration set、別OCI digest、別spec version setのTest resultを同一releaseのEvidenceとして混在させない。

**ACC-GEN-011:** VercelとRailwayでEnvironment別buildが存在しても、`SPEC-180` が要求する共通identity fieldが一致しない場合は同一releaseとみなさない。

### 7.2 Spec Version Set

Spec Version Setには次を含める。

1. 本書の`depends_on`。
2. `tests/traceability/test-manifest.json`が参照するCurrent Canonical spec。
3. `traceability/rule-code-map.json`が参照するCurrent Canonical spec。
4. Current releaseの変更対象behaviorを所有するspec。
5. `SPEC-200`自身。

**ACC-TRC-001:** Spec Version Setに存在しないRule IDをAcceptance Evidenceが参照してはならない。

**ACC-TRC-002:** deprecated specをCurrent Canonical behaviorとして採用しない。provisional / approvedの優先解釈は `SPEC-000` に従う。

### 7.3 Migration set

**ACC-DB-001:** Acceptance対象migration setはRelease Manifestの `migration_set_sha256` と一致し、G2 migration testおよびProduction migration evidenceが同じmigration setを参照しなければならない。

### 7.4 Build artifact

**ACC-INF-001:** Railway API / Email Worker / Reconciliation WorkerのProduction artifactは `SPEC-180` が定義するimmutable digest / deployment identityで識別し、`latest` 等のmutable aliasだけをEvidenceにしない。

---

## 8. Acceptance stage model

次の5段階は同義ではない。

| Stage | 意味 | 必須Evidenceの中心 | 次へ進めない主な条件 |
|---|---|---|---|
| Mergeable | merge candidateがsource / test gateを満たす | `SPEC-170/190/180` merge gate、static validation、traceability | G1〜G8 failure、Critical failure、static / traceability failure |
| Staging Deployable | merge commitをstagingへ配置できる | immutable release identity、migration applicability、staging config | artifact / migration / config identity failure |
| Production Promotable | same releaseをProductionへpromoteしてよい | staging G1〜G10 required evidence、G9、security / infra / backup / approval | required suite failure、G9 unavailable/fail、backup/config mismatch |
| Production Deployed | Productionへの配置・healthが成功 | migration、readiness、staged smoke、domain promotion、post-deploy smoke | readiness / migration / smoke / critical alert failure |
| System Accepted | Production deployment後も全System Acceptanceが成立 | 全Blocking ACC rule、post-deploy evidence、identity一致 | Critical invariant/security/reliability/infra/test/evidence failure |

**ACC-RELSE-001:** Merge可能であることをSystem Acceptedとみなさない。

**ACC-RELSE-002:** staging deploy成功をProduction promotion permissionとみなさない。

**ACC-RELSE-003:** Productionへdeployできた事実だけでSystem Acceptanceを成立させない。

**ACC-RELSE-004:** System AcceptanceはProduction deploy後に必要なdeployment health / observability / environment evidenceを含めて初めて成立する。

---

## 9. Acceptance result semantics

最終System Acceptance resultはexactに次の2つとする。

```text
ACCEPTED
REJECTED
```

Pre-production評価では次を別fieldとして持ってよい。

```text
gate_result = PASS | FAIL
production_promotion_allowed = true | false
acceptance_result = null | ACCEPTED | REJECTED
```

`acceptance_result = null` はfinal Production post-deploy evaluation前にのみ許可する。finalized Acceptance Manifestでは `null` を禁止する。

**ACC-GEN-012:** final System AcceptanceはBlocking Criterionが1件でもFAIL / missing / stale / identity mismatchなら `REJECTED` とする。

**ACC-GEN-013:** Critical Invariant、Critical Test、Security Fail Closed、Production migration、required Infrastructure identity、Production secret separation、required Provider Contract Smokeのfailureをknown issue / waiver / warningへ変換して `ACCEPTED` にしない。

**ACC-GEN-014:** `ACCEPTED_WITH_WARNINGS`、`CONDITIONALLY_ACCEPTED` 等の第三のfinal statusを導入しない。

### 9.1 Informational findingの境界

Informational Findingは次をすべて満たす場合だけ非blockingにできる。

- Canonical MUST / Invariant / Security / Reliability / Infrastructure rule違反ではない。
- どのBlocking Acceptance IDの唯一Evidenceにもなっていない。
- skipped / quarantined Critical Testを含まない。
- issue reference、owner、説明が存在する。
- System of Record、money、entitlement、authorization、audit、backup / restore safetyへ影響しない。

**ACC-GEN-015:** Non-critical Test quarantineが `SPEC-170` の範囲で存在しても、そのTestがBlocking Acceptance IDの必要Evidenceなら当該criterionはPassにしない。

---

# Part II — Acceptance Evidence Model

## 10. Acceptance Manifest

System Acceptanceはmachine-readable `system-acceptance-manifest.json` で記録する。これはCanonical specificationではなく**release evidence artifact**であり、既存Release Manifest / Test Manifest / deployment evidenceへのreferenceを束ねる。

Canonical logical schemaは次とする。

```json
{
  "schema_version": 1,
  "acceptance_manifest_id": "<uuid>",
  "evaluation_phase": "PRODUCTION_POST_DEPLOY",
  "generated_at": "<UTC timestamp>",
  "release": {
    "release_manifest_ref": "<immutable artifact ref>",
    "release_manifest_sha256": "<hex>",
    "release_ref": "<must match SPEC-180 manifest>",
    "git_sha": "<must match SPEC-180 manifest>"
  },
  "spec_set": {
    "spec_versions": {
      "SPEC-000": "1.0.0",
      "SPEC-200": "1.0.0"
    },
    "spec_set_sha256": "<canonical normalized set hash>"
  },
  "migrations": {
    "migration_set_sha256": "<must match release manifest>",
    "production_migration_evidence_ref": "<immutable ref>"
  },
  "tests": {
    "test_manifest_sha256": "<hex>",
    "group_runs": {
      "G1": ["<run ref>"],
      "G2": ["<run ref>"],
      "G3": ["<run ref>"],
      "G4": ["<run ref>"],
      "G5": ["<run ref>"],
      "G6": ["<run ref>"],
      "G7": ["<run ref>"],
      "G8": ["<run ref>"],
      "G9": ["<run ref>"],
      "G10": ["<run ref>"]
    },
    "critical_runner_retry_count": 0,
    "critical_quarantine_count": 0
  },
  "development_evidence": {
    "completion_report_ref": "<immutable ref>",
    "rule_code_map_sha256": "<hex>",
    "static_validation_ref": "<immutable ref>",
    "secret_scan_ref": "<immutable ref>"
  },
  "staging": {
    "deployment_evidence_ref": "<immutable ref>",
    "provider_smoke_evidence_ref": "<immutable ref>"
  },
  "production": {
    "deployment_evidence_ref": "<immutable ref>",
    "readiness_evidence_ref": "<immutable ref>",
    "post_deploy_evidence_ref": "<immutable ref>",
    "backup_readiness_evidence_ref": "<immutable ref>",
    "observability_validation_ref": "<immutable ref>"
  },
  "open_ucrs": [],
  "criteria": [
    {
      "acceptance_id": "ACC-INV-001",
      "status": "PASS",
      "canonical_rule_ids": ["INV-010-01"],
      "evidence_refs": ["<immutable ref>"],
      "blocking": true
    }
  ],
  "gate_result": "PASS",
  "production_promotion_allowed": true,
  "acceptance_result": "ACCEPTED"
}
```

具体的なartifact URI / CI storage productは `SPEC-180` のInfrastructure責務に従う。SPEC-200は製品を追加しない。

**ACC-GEN-016:** Acceptance Manifestは既存Release Manifestのartifact identityを複製authorityにせず、reference + hash + equality validationを行う。

**ACC-GEN-017:** Evidence referenceはmutable dashboard URLだけでなく、run ID / deployment ID / object digest / checksum等、後から同一artifactを識別できる値を含まなければならない。

**ACC-GEN-018:** Evidenceのhuman-readable screenshotだけを唯一の根拠にしない。machine-readable result、provider/deployment ID、manifest、checksumのいずれかへ接続する。

---

## 11. Evidence validity

Acceptance Evidenceは次を満たす場合だけ有効とする。

1. same release identityへjoin可能。
2. 実行時刻とEnvironmentが記録される。
3. tool / suite / validator identityが記録される。
4. resultをPASS / FAILへ機械判定可能。
5. skipped / quarantined / diagnostic-onlyを区別できる。
6. Security上の禁止情報を含まない。
7. underlying artifactがtamper detection可能なhashまたはimmutable IDを持つ。

**ACC-GEN-019:** `git_sha`が異なるTest runを流用しない。

**ACC-GEN-020:** source commitは同じでもmigration setまたはrelease artifact digestが変わった場合、変更後artifactのEvidenceを再取得する。

**ACC-GEN-021:** diagnostic rerun passはoriginal gating failureを消去せず、修正後clean gating runだけを新しいPass Evidenceとして扱う。

---

## 12. Evidence retention / identification

Acceptance Manifest、Release Manifest、最終gate summary、approval reference、spec set hash、test manifest hash、deployment identity、migration evidence checksumは、**Production releaseがactiveまたはrollback候補である期間中必ず保持し、さらにその状態を外れてから730日間保持する**。

大容量のraw test log / build log / diagnostic traceは各Infrastructure / Observability retentionに従ってよいが、最終Acceptance Manifestは少なくとも次を保持する。

- immutable run / deployment / artifact identifier
- result summary
- hash
- executed rule / test IDs
- start / end timestamp
- Environment
- tool / suite versionまたはcontainer image / workflow ref
- original failureとdiagnostic rerunの区別

**ACC-GEN-022:** raw underlying artifactのretentionが終了しても、Acceptance Manifest上で「過去にpassした」とだけ残し、現在のreleaseを新規再評価するEvidenceへ流用しない。

**ACC-GEN-023:** Acceptance Evidence retentionを理由にraw QR、Secret、Session credential、Password、reset token、不要なPIIを保存しない。

---

# Part III — System Invariant Acceptance

## 13. `INV-010-01〜10` Acceptance Matrix

全System InvariantはCritical Blocking Criterionとする。

| Acceptance ID | Invariant | Canonical Rule | Required Test Case / Group | Required Evidence | Acceptance Failure outcome |
|---|---|---|---|---|---|
| `ACC-INV-001` | 購入情報を失わない | `INV-010-01` + related `PAY-*`, `DB-*`, `REL-*` | `TC-INV-010-01-001`, `TC-INV-010-01-002`; G3/G4/G6 | Order先行永続化、Checkout response loss後のOrder保持、release-matched DB/API evidence | `REJECTED` |
| `ACC-INV-002` | Orderを二重確定しない | `INV-010-02` + `PAY-CFM-*`, `PAY-IDM-*`, `DB-*` | `TC-INV-010-02-001`, `TC-INV-010-02-002`; G3/G4/G10 | duplicate webhook / parallel confirmationで1 confirmationのみ | `REJECTED` |
| `ACC-INV-003` | Ticketを二重発行しない | `INV-010-03` + `TQR-TKT-*`, `DB-*` | `TC-INV-010-03-001`; G3/G10 | same cause replay後も正規購入数量を超えるTicketなし | `REJECTED` |
| `ACC-INV-004` | Karaoke Slotを二重販売しない | `INV-010-04` + `KRK-*`, `DB-KRK-*` | `TC-INV-010-04-001`, `TC-INV-010-04-002`; G2/G3/G10 | `btree_gist` / exclusion、parallel Hold one winner、real PostgreSQL evidence | `REJECTED` |
| `ACC-INV-005` | QR Ticketを二重利用させない | `INV-010-05` + `TQR-CHK-*`, `TQR-IDM-*`, `SEC-QR-*` | `TC-INV-010-05-001`, `TC-INV-010-05-002`; G3/G4/G5/G8/G10 | parallel scan one consume、response loss rescan convergence、Audit整合 | `REJECTED` |
| `ACC-INV-006` | Email失敗で購入確定をRollbackしない | `INV-010-06` + `EML-*`, `REL-EML-*` | `TC-INV-010-06-001`; G3/G6 | Resend failureでもOrder / Ticket / Reservation / Goods確定保持 | `REJECTED` |
| `ACC-INV-007` | 決済確定と権利発行を中途半端に残さない | `INV-010-07` + `PAY-CFM-*`, `DB-*`, `REL-DB-*` | `TC-INV-010-07-001`, `TC-INV-010-07-002`; G3/G6/G10 | confirmation mid-transaction rollback、commit ack loss reconciliation | `REJECTED` |
| `ACC-INV-008` | Ownership / AuthorizationをServer-side検証 | `INV-010-08` + `AR-*`, `SEC-AZ-*`, `API-*` | `TC-INV-010-08-001`, `TC-INV-010-08-002`; G4/G5/G8 | IDOR deny、role revoke後retry deny、no side effect | `REJECTED` |
| `ACC-INV-009` | Client入力だけで金額確定しない | `INV-010-09` + `PAY-ORD-*`, `DB-MNY-*`, `API-*` | `TC-INV-010-09-001`; G1/G3/G4/G5 | tampered amountがAuthorityにならない、server snapshot / provider exact compare | `REJECTED` |
| `ACC-INV-010` | external side effectのretry / replayへ耐える | `INV-010-10` + `PAY-IDM-*`, `EML-IDM-*`, `REL-*` | `TC-INV-010-10-001`, `TC-INV-010-10-002`; G3/G4/G6/G10 | same Cause / same Provider key convergence、duplicate side effectなし | `REJECTED` |

**ACC-INV-011:** `INV-010-01〜10` のいずれかにRequired Critical Testがない、skipされる、quarantineされる、identity不一致である場合はwarning-onlyにせず `REJECTED` とする。

**ACC-INV-012:** line coverage、E2E success、manual confirmationをSystem Invariant Critical Testの代替にしない。

---

# Part IV — Functional / Business Acceptance

## 14. Functional / Domain semantic coverage

**ACC-BIZ-001:** Current Canonical `FR-*` は100% Acceptance traceを持たなければならない。各`FR-*`は少なくとも1つの `ACC-BIZ-*` またはdomain-specific `ACC-*` にmapし、そのAcceptance IDはnon-quarantined Test / config / provider / deployment evidenceへ到達しなければならない。

**ACC-BIZ-002:** `DI-030-001〜012` はすべて`SPEC-170`のsemantic coverageを満たし、Acceptance Manifestから対応Test Caseへjoinできなければならない。

**ACC-BIZ-003:** Critical `BR-*` はstate / invariant groupごとにpositive + negative evidenceを持つ。Business RuleをUIの見た目だけでacceptしない。

**ACC-TRC-003:** `FR-* -> BR-* / DI-* -> implementation / API / DB -> TC-* -> ACC-* -> release evidence` のどこかが切れているCurrent mandatory behaviorはSystem AcceptanceをBlockする。

---

## 15. Major Business Capability Acceptance

| Acceptance ID | Capability | Canonical Rule families | Required Test Groups / Evidence | Pass condition |
|---|---|---|---|---|
| `ACC-BIZ-010` | Public information | `FR-PUB-*`, `BR-EVT-*`, relevant `API-*` | G4/G8 + deployment smoke | 公開対象情報がcanonical stateから取得され、failureをsuccess/emptyへ偽装せず、非公開stateを漏らさない |
| `ACC-BIZ-011` | Authentication | `FR-AUTH-*`, `AR-AUTH-*`, `AR-SES-*`, `SEC-AUTH-*` | G4/G5/G8 + Auth contract evidence | valid/invalid/expired/unverified stateがserver-sideで正しく分離される |
| `ACC-BIZ-012` | Profile / ownership | `FR-MYP-*`, `BR-USR-*`, `AR-ID-*`, `AR-OWN-*` | G3/G4/G5/G8 | verified subjectからBusiness Profileへ一意解決し、owner-safe accessのみ成立 |
| `ACC-BIZ-013` | Entry Ticket purchase | `FR-TKT-*`, `BR-ORD-*`, `BR-TKT-*`, `PAY-*` | G3/G4/G6/G8/G10 | purchase start→payment→confirmation→Ticketがsame Causeへ収束し二重発行なし |
| `ACC-BIZ-014` | Karaoke purchase / reservation | `FR-KRK-*`, `BR-KRK-*`, `KRK-*`, `PAY-*` | G3/G4/G6/G8/G10 | Slot availability / Hold / payment / Reservation / Ticketがcanonical ruleどおりで二重販売なし |
| `ACC-BIZ-015` | Goods purchase | `FR-GDS-*`, `BR-GDS-*`, `BR-ORD-*`, `DB-GDS-*`, `API-*` | G3/G4/G6/G8/G10 | inventory allocation / confirmationがcapacityを超えず、history / handoffへ正しく接続 |
| `ACC-BIZ-016` | Mypage | `FR-MYP-*`, `AR-OWN-*`, relevant `API-*` | G4/G5/G8 | 自己所有Order / Ticket / Reservation / Goodsのみ表示し、未確定を確定済みと表示しない |
| `ACC-BIZ-017` | Payment / Refund | `FR-XFN-*`, `PAY-*` | G3/G4/G5/G6/G9/G10 | authority / idempotency / verified webhook / refund current-state rule / unknown resultを維持 |
| `ACC-BIZ-018` | Entry Check-in | `FR-STF-*`, `BR-CHK-*`, `TQR-*` | G3/G4/G5/G8/G10 | correct purpose / Staff auth / current Ticket state / single-useが成立 |
| `ACC-BIZ-019` | Karaoke Check-in | `FR-KRK-*`, `FR-STF-*`, `BR-CHK-*`, `KRK-CHK-*`, `TQR-*` | G3/G4/G5/G8/G10 | canonical time predicate + purpose + single-use + Staff authが成立 |
| `ACC-BIZ-020` | Goods Handoff | `FR-GDS-*`, `FR-STF-*`, `BR-GDS-*`, `ADM-*`, `STF-*` | G3/G4/G5/G8/G10 | authorized targetに最大1回のhandoffが成立し、concurrent repeatで重複しない |
| `ACC-BIZ-021` | Email Notification | `FR-EML-*`, `BR-NTF-*`, `EML-*` | G3/G4/G6/G9 | Notification Request永続化、recipient authority、worker/provider semantics、business rollback分離 |
| `ACC-BIZ-022` | Administrator operation | `FR-ADM-*`, `ADM-*`, `OPS-*`, `AR-ROLE-*` | G4/G5/G8 + Audit evidence | Current Canonical capabilityだけでrequired operationを実行し、generic superuser / direct DB bypassなし |
| `ACC-BIZ-023` | Staff operation | `FR-STF-*`, `STF-*`, `AR-ROLE-*` | G4/G5/G8/G10 | Staff namespace / capability / minimal data / current stateをserver-side再評価 |
| `ACC-BIZ-024` | Consistency / recovery | `FR-XFN-*`, `REL-*`, `OBS-REC-*` | G3/G6/G7/G10 | safe automatic convergenceまたはConsistency Reviewへ移行し、blind repair / generic state editなし |

**ACC-BIZ-025:** UCR-only endpoint / capabilityを仮実装してBusiness CapabilityをPassにしない。

**ACC-BIZ-026:** Current Canonical `FR-*` の未実装を「今回releaseの対象外」としてSystem Acceptanceから除外しない。完成システムAcceptanceではmandatory Current Requirementは全件対象である。

---

# Part V — Authentication / Authorization Acceptance

## 16. Authentication / Authorization

**ACC-AUTH-001:** Supabase Auth identity / sessionはHono APIでServer-side verificationされ、Browser / Next.jsの「ログイン済み」表示だけをBusiness authorization根拠にしないことをG4/G5 evidenceで証明する。

**ACC-AUTH-002:** Auth SubjectからBusiness Profileを一意に解決し、owner resourceはPublic Reference単独ではなくverified Profile relationを含むowner-safe lookupを使用することを証明する。

**ACC-AUTH-003:** Administrator / Staff operationはcurrent Role Assignment + operation-specific CapabilityをRequestごとに再評価する。

**ACC-AUTH-004:** `ADMINISTRATOR` はgeneric superuserではなく、Domain Rule / System Invariantを迂回できないことをSecurity / API negative testで証明する。

**ACC-AUTH-005:** `ADMINISTRATOR` が `STAFF` を暗黙継承しないことをRole matrix / route / mutation testで証明する。両Capabilityが必要なら明示Role Assignmentを要求する。

**ACC-AUTH-006:** role revoke / session invalidation / Auth dependency failure後のretryで古いUI stateをAuthorityにせずFail Closedする。

**ACC-AUTH-007:** last Administrator protection等のconcurrency-sensitive authorization ruleはreal PostgreSQL advisory lock / transaction semanticsを含むEvidenceで検証する。

**ACC-AUTH-008:** Authentication / Authorization acceptanceのCritical negative test failureはwaiveしない。

---

# Part VI — Order / Payment / Refund Acceptance

## 17. Payment authority

**ACC-PAY-001:** Payment successはBrowser Returnではなく`SPEC-070`のPayment Authorityからのみ確定されることをTest / Provider Contract Evidenceで証明する。

**ACC-PAY-002:** Checkout / Refund Provider callのIdempotency Key、Business Cause、Transport Idempotencyを混同せず、同一side effectがretry / response lossで重複しないことを証明する。

**ACC-PAY-003:** amount / currencyはserver-side Order Item snapshot / trusted configurationから導出し、Client値をAuthorityにしない。Stripe側結果との不一致は成功扱いしない。

**ACC-PAY-004:** Stripe Webhookはraw bodyで署名検証し、duplicate / out-of-order eventでもOrder / entitlementを二重確定しない。

**ACC-PAY-005:** Business ConfirmationはOrder `CONFIRMED` と必須Domain effectをCanonical DB transaction boundaryでatomicに成立させる。

**ACC-PAY-006:** Provider Result Unknownは新Business Cause / new provider keyでblind retryせず、same correlationでreconciliationへ進む。

**ACC-PAY-007:** response loss / commit acknowledgement lossからcurrent authorityへ再照合し、既に確定済みならexisting resultへ収束する。

**ACC-PAY-008:** Refundは`SPEC-070`のCurrent financial / domain boundaryを満たし、duplicate Refundを発生させず、Result Unknownを成功扱いしない。

**ACC-PAY-009:** Payment / Refund acceptanceにはG3/G4/G5/G6/G9/G10の該当Critical evidenceを要求し、Unit mockだけで成立させない。

---

# Part VII — Ticket / QR / Check-in Acceptance

## 18. Ticket / QR

**ACC-TQR-001:** Entry TicketとKaraoke TicketのQR Purposeを分離し、wrong-purpose scanをCheck-in成功へ変換しない。

**ACC-TQR-002:** Customer QR表示はverified Session + owner-safe lookup + current valid stateを要求する。

**ACC-TQR-003:** raw QR token / payloadをURL、log、Audit Event、metric label、alert payload、Admin view、Email、persistent Browser storageへ残さない。

**ACC-TQR-004:** QR protectionは`SPEC-140`のHMAC lookup、AEAD protected material、key version / rotation / fail-closed contractに一致するEvidenceを持つ。

**ACC-TQR-005:** Entry / Karaoke Check-inはactive Staff Role + correct Capability + purpose + current stateをServer-sideで検証する。

**ACC-TQR-006:** Ticket consumeとimmutable Check-in insertはreal PostgreSQL transaction / lock / uniquenessで最大1回に収束する。

**ACC-TQR-007:** parallel scan / double submit / response loss / rescanはone winner + canonical loser / already-used resultへ収束する。

**ACC-TQR-008:** CANCELED / EXPIRED / USED / revoked / malformed / unknown QRを新規Check-in成功にしない。

**ACC-TQR-009:** QR key rotation failureやAEAD authentication failureでplaintext fallback / silent reissueを行わずFail Closed / Consistency Reviewへ接続する。

---

# Part VIII — Karaoke Acceptance

## 19. Karaoke

**ACC-KRK-001:** Karaoke Slot / Exclusive Scope / Occupancy Interval / Hold / Reservation / Check-in time predicateは`SPEC-090`のCanonical値を使用し、SPEC-200独自値を持たない。

**ACC-KRK-002:** same Exclusive Scope overlapをDB exclusion constraintとreal PostgreSQL G2/G3 evidenceで拒否する。

**ACC-KRK-003:** concurrent Hold / purchaseは1 winnerへ収束し、loserが別CustomerのSlotをsoldへできない。

**ACC-KRK-004:** Payment Result Unknown中にSlotを安全性確認なしでrelease / resaleしない。

**ACC-KRK-005:** Reservation confirmationとKaraoke Ticket発行はPayment Business Confirmationのatomic effectとして検証する。

**ACC-KRK-006:** Normal Cancellation / resale policy / Slot edit / sales stopは`KRK-*`のCurrent Canonical behaviorどおりであり、Admin UI都合でgeneric state editを追加しない。

**ACC-KRK-007:** Karaoke Check-inは`KRK-CHK-*`のcanonical time predicateと`TQR-*`のsingle-useを両方満たす。

---

# Part IX — Goods Acceptance

## 20. Goods

**ACC-GDS-001:** Goods purchase amount / inventory / availabilityはClient inputではなくBusiness Database current stateをAuthorityとする。

**ACC-GDS-002:** finite inventory acquisition / confirmation / releaseは`DB-GDS-*`のrow lock / counter / allocation semanticsによりoversellしない。

**ACC-GDS-003:** confirmed Goods Order ItemとGoods Handoff historyをretry / deployment / rollbackで消去しない。

**ACC-GDS-004:** Goods HandoffはStaff / AdministratorのCurrent Canonical capabilityでServer-side authorizationし、同一Goods Order Itemへ最大1回成立する。

**ACC-GDS-005:** inventory inconsistencyをblind counter overwriteで修復せずConsistency Reviewへ送る。

**ACC-GDS-006:** `UCR-130-003〜006` にだけ存在するread / manage contractを既にCurrent APIにあると仮定しない。Current FRを満たせない場合は該当AcceptanceをFAILとする。

---

# Part X — Email / Notification Acceptance

## 21. Email

**ACC-EML-001:** Business ConfirmationからNotification Requestが永続化され、Resend Provider AcceptanceをBusiness ConfirmationのPreconditionにしない。

**ACC-EML-002:** Notification retry / recoveryは元Order / Refund / Reservation / Ticket / Goods transactionを再実行しない。

**ACC-EML-003:** recipient authorityはBusiness Profile → Auth Subject → Supabase Auth server-side lookupであり、Client email / Stripe emailをauthorityにしない。

**ACC-EML-004:** first provider send前にrecipient snapshot / template contractをCurrent Canonical semanticsどおり固定し、自動retryで暗黙変更しない。

**ACC-EML-005:** React Email renderingはversioned template + validated non-secret contextを使用する。

**ACC-EML-006:** Email Workerはclaim lease / `FOR UPDATE SKIP LOCKED` / transaction外Provider callを使用し、duplicate workerが同一jobを重複送信しない。

**ACC-EML-007:** Resend Provider Idempotency Keyをsame Attemptで維持し、timeout / 5xx / response lossをUnknown Resultとしてreconcileする。

**ACC-EML-008:** Email provider failure時も確定済みBusiness stateは保持され、`TC-INV-010-06-001`を含むCritical EvidenceがPassする。

**ACC-EML-009:** Resend Webhookはraw body signature verificationを行い、provider eventをBusiness Domain Authorityへ誤昇格しない。

---

# Part XI — API / Database Acceptance

## 22. API Acceptance

**ACC-API-001:** Current Canonical API method / path / Operation IDは`SPEC-170` semantic coverageを100%満たす。Operation IDがCurrent specに存在するoperationは全件API Testを持つ。

**ACC-API-002:** `UCR-170-001`対象のOperation ID未付与routeはCurrent `SPEC-170`どおりmethod + path + capability単位でTestし、欠落IDを発明しない。

**ACC-API-003:** Hono RPC type boundaryとZod runtime validationが有効であり、path / query / body /主要success response / common error contractをcompile-time typeだけに依存しない。

**ACC-API-004:** protected operationは`SPEC-110`のVerification ordering、すなわちPublic / protected判定 → token presence / verification → Email verified check → Auth Subject取得 → Business Profile resolution / provisioning requirement判定 → self operationのowner relation → staff/admin operationのRole Assignment + Capability → Domain precondition → mutation、を満たすEvidenceを持つ。Zod runtime validationも`SPEC-110`の各operation contractどおり実施し、SPEC-200独自の順序へ変更しない。

**ACC-API-005:** owner-safe lookupはPublic Referenceだけでresourceを取得しない。

**ACC-API-006:** common error contractはexpected HTTP status / error code / retryabilityをCurrent `SPEC-110`どおり返し、stack / SQL / Internal ID / Secret / raw QR / full Emailを含めない。

**ACC-API-007:** Transport Idempotency KeyはBusiness Cause / Provider Idempotency Keyと分離される。

**ACC-API-008:** Stripe / Resend webhook routeはraw body preservationとprovider signature verificationを満たし、通常Browser RPC auth modelへ混在させない。

---

## 23. Database Acceptance

Database AcceptanceはUnit mockだけでは成立しない。

**ACC-DB-002:** G2/G3/G10は`SPEC-180`が指定するCurrent PostgreSQL majorと同等のreal PostgreSQL semanticsで実行する。

**ACC-DB-003:** `pgcrypto` と `btree_gist` がmigration / readiness / G2で有効であり、`btree_gist`欠落をapplication-only overlap checkへfallbackしない。

**ACC-DB-004:** `SPEC-100`のcritical named PRIMARY KEY / FK / UNIQUE / CHECK / EXCLUDE / partial unique / index contractがmigration outputと実DB catalogで一致し、critical constraintごとにreal DB Testが存在する。

**ACC-DB-005:** Current standard transaction isolationは`SPEC-100`の`READ COMMITTED`であり、required explicit row lock / conditional update / named constraintと組み合わせたwinner / loser semanticsをG3/G10で検証する。

**ACC-DB-006:** required `FOR UPDATE`、transaction-scoped advisory lock、`FOR UPDATE SKIP LOCKED` の各Canonical利用箇所がreal DB Testで検証される。

**ACC-DB-007:** `40001`, `40P01`, lock timeout, statement timeout, pool acquisition failure等のCurrent Canonical handlingをfault injection / real DB evidenceで検証する。

**ACC-DB-008:** Internal ID / Moneyの`bigint`をJavaScript unsafe `number`へlossy変換せず、wire Moneyは`SPEC-110`のlossless representationを維持する。

**ACC-DB-009:** financial / entitlement / payment / check-in / role / QR correlation等のHistorical Rowを通常operation / rollback / cleanupでhard deleteしない。

**ACC-DB-010:** Production application startupでmigrationを自動実行しない。Migrationは`SPEC-180`のdedicated migration identity / deployment sequenceで実行したEvidenceを要求する。

**ACC-DB-011:** 0から全migration、supported prior schemaからforward migration、schema readiness、grant / extension validationがG2 / Production migration evidenceでPassする。

**ACC-DB-012:** Production migration set hashとRelease Manifest / Acceptance Manifest / deployed schema evidenceが一致する。

---

# Part XII — Security Acceptance

## 24. Security Acceptance boundary

Security AcceptanceはCritical Blocking Criterionである。

**ACC-SEC-001:** Supabase Auth token / Sessionはserver-sideでissuer / signature / expiry等を検証し、安全に検証できない場合Fail Closedする。

**ACC-SEC-002:** Session / Credential / Password / reset token / verification tokenをBusiness Database、Application Log、Client-readable persistent storageへ不必要に保存しない。

**ACC-SEC-003:** owner-safe authorization、Administrator / Staff current Capability enforcement、Administrator非generic-superuser、Administrator非Staff暗黙継承をG5でnegative testする。

**ACC-SEC-004:** Browser / Next.jsのCSRF、CORS、XSS / escaping、CSP / Security Headerが`SEC-*`のCurrent Canonical controlと一致するconfig / E2E / security evidenceを持つ。

**ACC-SEC-005:** credentialed CORSにwildcard originを使用せず、state-changing Browser requestのCSRF / exact origin等のCurrent controlを維持する。

**ACC-SEC-006:** Secret placement / reader boundaryは`SPEC-140/180`どおりで、Browser bundle / HTML / public source mapにServer Secretが存在しないことをbuild artifact scanで証明する。

**ACC-SEC-007:** Runtime DB credential、migration credential、audit reader / purger、backup reader、emergency identity等のleast-privilege separationをInfrastructure evidenceで証明する。

**ACC-SEC-008:** Stripe / Resend webhookはraw body署名検証を行い、invalid signature / timestamp / replay conditionをBusiness successへ変換しない。

**ACC-SEC-009:** QR lookup / protected materialはCurrent `SEC-QR-*` のHMAC / AEAD / key separation / key version / rotation contractを満たす。

**ACC-SEC-010:** QR key / security config欠落、AEAD verification failure、invalid secret、Auth verification failure等でplaintext / default secret / bypassへfallbackしない。

**ACC-SEC-011:** PII minimization / masking / redactionはClient error、Application Log、Audit summary、dashboard、support exportでCurrent Canonical boundaryを維持する。

**ACC-SEC-012:** Production / staging / development / testのSecret / Provider credential / QR key / correlation key / Business DataがCanonical Environmentごとに分離される。

**ACC-SEC-013:** G5でCurrent executable/configurable `SEC-*` が100% test manifestへmapされ、Critical Security Test retry=0 / quarantine禁止を満たす。

**ACC-SEC-014:** Critical Security acceptance failureに一般的waiver、temporary bypass、availability fallbackを設けない。

---

# Part XIII — Reliability / Recovery Acceptance

## 25. Reliability / Recovery

SPEC-200はretry count、backoff、jitter、timeout、reconciliation cadence、claim lease、safe window等の値を再定義しない。Acceptance evaluatorは`SPEC-150`および各domain ownerが定義するCurrent valueと実装config / test resultの一致を検証する。

**ACC-REL-001:** operation / dependency timeoutはCurrent `REL-TMO-*` に一致し、timeoutを無条件failureとせずresult authority不明時は`UNKNOWN_RESULT`へ分類する。

**ACC-REL-002:** retryはCurrent `REL-RTY-*` のexponential backoff / jitter / retry budget / layer ownershipを維持し、duplicate side effect防止が証明できる場合だけ行う。

**ACC-REL-003:** DB transaction retryはsame Business Cause / normalized input / current authorization re-evaluationを使用し、retryごとにnew Order / Hold / Refund等を作らない。

**ACC-REL-004:** Provider Result Unknownはsame Business Cause / same Provider key / current correlationでreconciliationし、blind write retryしない。

**ACC-REL-005:** automatic repairはCurrent authorityとInvariantから一意に決定できる範囲だけに限定し、それ以外をConsistency Reviewへ送る。

**ACC-REL-006:** stuck processing detector / scheduled recovery / reconciliation workerが`SPEC-150/180`のCurrent cadence / scheduler wiringで稼働し、missed-run / worker failureを観測可能にする。

**ACC-REL-007:** worker item failureを他itemへ伝播させず、claim / lease / lock / retry semanticsでitem isolationを維持する。

**ACC-REL-008:** graceful shutdown時にin-flight transaction / provider call / claimをCurrent Canonical ruleどおり安全に終了・再発見可能にする。

**ACC-REL-009:** recoveryは元Transactionを最初から再実行せず、current state / Business Cause / Provider correlation / DB uniquenessを取得して不足処理だけを行う。

**ACC-REL-010:** G6のrequired fault injection / response loss / provider failure / DB failure / recovery testがPassし、Critical recovery testにretry / quarantineがない。

**ACC-REL-011:** `UCR-150-001〜002`だけのmanual recovery commandをcurrent implementation requirementとして先取りしない。

---

# Part XIV — Observability / Audit Acceptance

## 26. Observability

**ACC-OBS-001:** structured Application Logは`SPEC-160`のschema、severity、event taxonomyを使用し、free-form only loggingへ置換しない。

**ACC-OBS-002:** request / Operation / Business Cause / target Public Reference / Provider Reference / Consistency Review / Recovery Execution IDの該当correlationをincident investigationで辿れる。

**ACC-OBS-003:** Operation Execution IDはretryごとに別executionを識別し、Business Causeと混同しない。

**ACC-OBS-004:** replay可能key / sensitive correlationはraw値で記録せずCurrent HMAC fingerprint contractを使用し、Production / nonproduction key separationを維持する。

**ACC-OBS-005:** deployment resource attributeはRelease Ref / git SHA / Vercel deployment / Railway deployment / image digestへjoin可能である。

**ACC-OBS-006:** Metric labelはbounded cardinalityを維持し、Public Reference、raw provider event、Email等をunbounded labelへ入れない。

**ACC-OBS-007:** Required Dashboard / Alertは`SPEC-160`のname / query / threshold / sampling / retention semanticsを変更せずInfrastructureへprovisionされる。

**ACC-OBS-008:** Audit EventはBusiness Databaseのappend-only persistenceを持ち、Application Log / Better Stackのみで代替しない。

**ACC-OBS-009:** required high-risk local mutationとAudit persistenceにCurrent Canonical atomicity要件がある場合、同一DB transactionで成立することをreal DB / concurrency Testで証明する。

**ACC-OBS-010:** Observability sink failureでBusiness transactionを不必要に延長せず、Audit persistence failure時はCurrent Canonical high-risk failure behaviorを維持する。

**ACC-OBS-011:** retention / purge / temporary exportは`SPEC-160/180`のCurrent retention / access / purge contractを満たし、Business history retentionと混同しない。

**ACC-OBS-012:** incident investigation drillまたはsynthetic evidenceでrelease → request → operation → business cause → provider / DB / Auditのcorrelationが再現可能である。

### 26.1 Prohibited observability content

Application Log、Audit Event、Metric label、Alert payload、Dashboard、Acceptance Evidenceへ次のraw内容が存在しないことをG5/G7/secret-redaction scanで検証する。

```text
raw QR
Secret
Session credential
Password
reset token
verification token
prohibited full recipient Email
raw webhook body
full provider error object
SQL bind dump
JWT payload dump
unnecessary PII
```

**ACC-OBS-013:** 上記prohibited contentの検出はCritical Security / Observability failureとして扱い、release evidenceから削除するだけでPassに変換しない。原因を修正しclean evidenceを再取得する。

---

# Part XV — Test Evidence Acceptance

## 27. Canonical Test Groups

`SPEC-170`のgroupをexactに使用する。

```text
G1 unit
G2 db-migration
G3 db-integration
G4 api
G5 security
G6 reliability-recovery
G7 observability
G8 e2e
G9 provider-contract-smoke
G10 hot-concurrency
```

**ACC-TST-001:** merge / staging / Production gateは`SPEC-170/180`のCurrent required groupを弱めない。

**ACC-TST-002:** Production promotionにはsame release SHAのG1〜G8 + G10 + G9 evidenceを要求する。G9をProduction credentialで実行して代替しない。

**ACC-TST-003:** Critical Test runner retryは0、Critical quarantine countは0でなければならない。

**ACC-TST-004:** diagnostic rerunはoriginal gating failureを上書きしない。

**ACC-TST-005:** DB constraint / transaction race / lock semanticsはreal PostgreSQL requirementを満たす。

**ACC-TST-006:** Provider Test DoubleはProvider contract surfaceとfailure injectionに使用し、Provider Contract Smokeの代替にしない。

**ACC-TST-007:** Provider Contract Smokeはprotected nonproduction credentialでStripe / Resend / Supabase AuthのCurrent contract surfaceを確認する。

**ACC-TST-008:** Deterministic Clock / deterministic Random / fixed seed / barrier等を利用し、time / randomness / concurrency-sensitive Testを再現可能にする。

**ACC-TST-009:** fault injectionはDB failure、Provider timeout / response loss、Auth failure、observability failure等のCurrent canonical Fault Pointを検証する。

**ACC-TST-010:** concurrency-sensitive operationはexplicit parallel Testを持ち、winner / loser countとpostconditionをmachine判定する。

**ACC-TST-011:** `tests/traceability/test-manifest.json` はduplicate ID、unknown upstream ID、UCR-only active feature、orphan Critical ruleを含まない。

**ACC-TST-012:** `TST-*` / `TC-*` runtime resultとTest Manifestをjoin可能にする。

**ACC-TST-013:** Semantic Coverageは`SPEC-170`のCurrent 100% manifest coverage requirementを満たす。line coverage percentageだけをSystem Acceptance代替にしない。

---

# Part XVI — Infrastructure / Production Release Acceptance

## 28. Environment / runtime identity

**ACC-INF-002:** `production`, `staging`, `development`, `test` のCanonical EnvironmentがVercel / Railway / Supabase / Stripe / Resend / observability / secretで分離される。

**ACC-INF-003:** deployed Node / PostgreSQL major、extensions、runtime process identityは`SPEC-180`のCurrent Canonical valueと一致する。SPEC-200はmajor version値を所有しない。

**ACC-INF-004:** API runtime、Email Worker、Reconciliation Worker、migration、Audit read / purge、backup、emergency recoveryのDB role / machine identity separationがCurrent `INF-*`に一致する。

**ACC-INF-005:** Secret reader matrixに違反するcross-component secret accessがない。

---

## 29. Migration / health / worker

**ACC-INF-006:** Production migrationはGitHub protected deployment flowのdedicated migration identityで実行し、startup auto-migrationを使用しない。

**ACC-INF-007:** migration failure / partial application / schema readiness failure時はProduction promotionを停止し、application-only fallbackを行わない。

**ACC-INF-008:** Railway API / Email Worker / Reconciliation WorkerがCurrent health/readiness contractをPassし、new deployment activation前にrequired readinessを満たす。

**ACC-INF-009:** scheduler wiringはCurrent `REL-*` cadenceと`INF-WRK-*` topologyをそのまま使用し、feature都合でworker / reconciliationを省略しない。

---

## 30. Observability / alert infrastructure

**ACC-INF-010:** Primary Observability Backendが`SPEC-180`のCurrent backendとして正しくwireされ、Production / nonproduction dataset / token / dashboard / routingが分離される。

**ACC-INF-011:** independent alert delivery health pathがCurrent `INF-OBS-*` contractで機能し、primary alert path failureを同じbroken pathだけへ通知しない。

**ACC-INF-012:** Audit retention / purge infrastructureはCurrent principal / schedule / function / retention contractを満たすEvidenceを持つ。

---

## 31. Backup / restore

**ACC-INF-013:** Production backup architecture、provider-native recovery、Cloudflare R2 Backup Archive、encryption、credential scopeが`INF-BKP-*`に一致する。

**ACC-INF-014:** latest required backup freshness / object existence / checksum / retention drift validationがProduction promotion前にPassする。

**ACC-INF-015:** monthly / quarterly等のCurrent restore rehearsal contractを満たしたlatest required evidenceが有効であり、restore手順がschema / extension / constraint / Audit / financial / entitlement preservationを検証する。

**ACC-INF-016:** restoreでStripe charge / Refund / Resend acceptance等のProvider side effectを巻き戻したとみなさず、post-restore reconciliationへ接続する。

---

## 32. Production deployment

**ACC-INF-017:** Production deployはapproved protected Environmentからimmutable release identityを使用する。

**ACC-INF-018:** Production deployment sequenceはCurrent `SPEC-180`のmigration → Railway API / workers → readiness → Vercel staged deployment → smoke → domain promotion → post-deploy observation順序を維持する。

**ACC-INF-019:** staging evidenceとProduction deploymentがsame release identityを参照する。

**ACC-INF-020:** rollback target / previous known-good artifactを識別でき、rollbackでProvider side effect / Check-in / Business historyを消去しない。

**ACC-INF-021:** Production access boundary / project-owner approval / break-glass evidenceがCurrent `INF-SEC-*`に一致する。

**ACC-INF-022:** active Critical/High condition、readiness failure、schema mismatch、Critical smoke failure等、Current `SPEC-180`がrelease acceptanceを停止すると定義したconditionが存在する間はSystem Acceptanceしない。

---

# Part XVII — SPEC-190 Development Guideline Acceptance

## 33. Repository / dependency / language evidence

**ACC-DEV-001:** pnpm workspace / monorepo structureおよびmodule boundaryが`SPEC-190`のCurrent repository contractと一致する。

**ACC-DEV-002:** forbidden import / dependency checkがpassし、Web→DB direct edge、cycle、Test Harness→Production逆流等の禁止edgeが0である。

**ACC-DEV-003:** 全workspaceのstrict TypeScript configurationがCurrent `DEV-TS-*`を満たし、typecheck error 0である。

**ACC-DEV-004:** runtime input / wire boundaryはZod等のCurrent runtime validation ruleを満たす。

**ACC-DEV-005:** Browser / WebからBusiness Database / Drizzle / `pg`へのBusiness direct accessが存在しないことをsource graph / import / code scanで証明する。

**ACC-DEV-006:** DB transaction中にStripe / Resend / Supabase Auth等のexternal network callを実行しないことをcode review / static rule / integration evidenceで確認する。

---

## 34. Security / migration / traceability self-verification

**ACC-DEV-007:** Secret scanがpassし、repository / generated artifact / Browser bundleへProduction credential / Secretが存在しない。

**ACC-DEV-008:** raw QR / PII / Secret / raw webhook / full provider error logging reviewがpassする。

**ACC-DEV-009:** generated migrationが存在する場合、named constraints、no destructive drift、compatible sequence、review evidenceを持つ。

**ACC-DEV-010:** behavior changeはTest-first workflowへtraceされ、bug fixは再現case、新behaviorはcontract Testを先行または同一change evidenceとして持つ。

**ACC-DEV-011:** `traceability/rule-code-map.json` のhashをAcceptance Manifestへ記録し、changed behavioral sourceがCanonical Rule IDへtraceされる。

**ACC-DEV-012:** `rule-code-map.json` をCanonical behavior sourceとして扱わず、UCR-only IDへactive code pathをmapしない。

**ACC-DEV-013:** AI completion reportが`SPEC-190`のfixed formatを満たし、changed scope / canonical rules / files / migrations / Test Cases / Test Groups / security-reliability implications / traceability / known UCR / exceptionsを含む。

**ACC-DEV-014:** Git diff self-reviewが行われ、unintended file、generated noise、secret、spec drift、test-only bypassがない。

**ACC-DEV-015:** UCR protection reviewがpassし、`UCR-130-*`, `UCR-150-*`, `UCR-170-001` をCurrent Canonicalとして仮実装していない。

**ACC-DEV-016:** `format`, `lint`, `typecheck`, forbidden-import check、required Test、secret scan、traceability validationの未実行を「完了」と報告しない。未実行required itemはSystem Acceptance blockerである。

---

# Part XVIII — Cross-Spec Traceability

## 35. Traceability graph

System AcceptanceのCanonical trace方向は次とする。

```text
SPEC Rule / Requirement
  -> Acceptance ID
  -> Test Case / config / provider / deployment validation
  -> Test / Release / Deployment Evidence ID
  -> Acceptance Manifest
  -> final ACCEPTED / REJECTED
```

Implementation側は次を追加joinとして使用する。

```text
Rule ID
  -> traceability/rule-code-map.json
  -> source path
  -> TC-*
  -> test-manifest.json
```

**ACC-TRC-004:** Rule commentだけをTraceability source of truthにしない。

**ACC-TRC-005:** unknown Rule ID、deleted Rule ID、UCR-only active IDをAcceptance Matrix / Test Manifest / rule-code-mapへ登録しない。

**ACC-TRC-006:** Current Canonical Ruleがdocumentation-only / external factで直接executeできない場合、`verification_method=document_review|config_validation|provider_contract|deployment_validation` 等の明示方法を持たせ、coverageから無言で除外しない。

---

## 36. Rule family mapping

| Acceptance family | Primary Canonical trace |
|---|---|
| `ACC-INV-*` | `INV-010-*`, related `BR-*`, `PAY-*`, `TQR-*`, `KRK-*`, `DB-*`, `REL-*` |
| `ACC-BIZ-*` | `FR-*`, `BR-*`, `DI-030-*` |
| `ACC-AUTH-*` | `AR-*`, `SEC-AUTH-*`, `SEC-AZ-*`, `DB-AUTH-*`, `API-*` |
| `ACC-PAY-*` | `PAY-*`, `DB-PAY-*`, `API-*`, `SEC-PAY-*`, `REL-PAY-*`, `REL-RFD-*` |
| `ACC-TQR-*` | `TQR-*`, `SEC-QR-*`, `DB-TQR-*`, `REL-TQR-*` |
| `ACC-KRK-*` | `KRK-*`, `DB-KRK-*`, `REL-KRK-*` |
| `ACC-GDS-*` | `FR-GDS-*`, `BR-GDS-*`, `DB-GDS-*`, related `API-*`, `REL-GDS-*` |
| `ACC-EML-*` | `EML-*`, `DB` email support rules, `REL-EML-*`, `OBS-EML-*` |
| `ACC-DB-*` | `DB-*`, `TST-DB-*`, `TST-CON-*`, `INF-DB-*` |
| `ACC-API-*` | `API-*`, `AR-*`, `SEC-API-*`, `TST-API-*`, `OBS-COR-*` |
| `ACC-SEC-*` | `SEC-*`, `TST-SEC-*`, `INF-SEC-*` |
| `ACC-REL-*` | `REL-*`, `TST-REL-*`, `TST-REC-*`, `INF-WRK-*` |
| `ACC-OBS-*` | `OBS-*`, `TST-OBS-*`, `INF-OBS-*`, `INF-AUD-*` |
| `ACC-TST-*` | `TST-*`, `TC-*`, `tests/traceability/test-manifest.json` |
| `ACC-INF-*` | `INF-*`, Release Manifest / deployment evidence |
| `ACC-DEV-*` | `DEV-*`, `rule-code-map.json`, completion evidence |

---

# Part XIX — Machine-readable Acceptance Matrix

## 37. Acceptance Matrix contract

Acceptance Matrixは少なくとも次のfieldへ変換可能でなければならない。

```text
acceptance_id
capability_or_invariant
canonical_rule_ids[]
required_test_case_ids[]
required_test_groups[]
required_configuration_evidence[]
required_deployment_evidence[]
verification_method[]
blocking:boolean
pass_condition
failure_outcome
```

**ACC-TRC-007:** Acceptance Matrixで`blocking=true`のrowは、必要Evidenceが0件またはmissingの場合にPassへdefaultしない。

**ACC-TRC-008:** `NOT_APPLICABLE`はCurrent Canonical behaviorが当該releaseに存在しないことをRule IDで証明できるcriterionだけに許可する。Current mandatory `FR-*`, `INV-*`, `SEC-*`, required infrastructure gateへ使用しない。

---

## 38. Canonical Acceptance Matrix

| Acceptance ID | Capability / invariant | Canonical Rule IDs | Required Test Cases / Groups | Required config evidence | Required deployment evidence | Blocking | Pass condition |
|---|---|---|---|---|---|---|---|
| `ACC-GEN-009` | Release identity | `INF-DEP-*` | manifest validator | release-manifest hash | staging + Production IDs | Yes | all identity joins equal |
| `ACC-TRC-001` | Spec set completeness | `SPEC-000`, `TST-TRC-*`, `DEV-TRC-*` | manifest validation | spec set hash | none | Yes | no unknown / missing Current rule owner |
| `ACC-INV-001〜010` | System invariants | `INV-010-01〜10` | §13 exact cases + G3/G4/G5/G6/G8/G10 as applicable | DB/provider config as applicable | same release deployment | Yes | all invariant criteria PASS |
| `ACC-BIZ-001〜024` | Functional / Domain capability | `FR-*`, `BR-*`, `DI-030-*` | G1/G3/G4/G8 + domain required groups | feature/current config | staging smoke | Yes | semantic coverage + observable outcome PASS |
| `ACC-AUTH-001〜008` | Authentication / Authorization | `AR-*`, `SEC-AUTH-*`, `SEC-AZ-*` | G4/G5/G8/G10 | Auth / role / secret config | environment identity | Yes | server-side fail-closed + owner-safe |
| `ACC-PAY-001〜009` | Payment / Refund | `PAY-*` | G3/G4/G5/G6/G9/G10 | Stripe nonprod smoke config / Prod secret identity | webhook + Production deploy evidence | Yes | authority/idempotency/atomicity/unknown PASS |
| `ACC-TQR-001〜009` | Ticket / QR / Check-in | `TQR-*`, `SEC-QR-*` | G3/G4/G5/G8/G10 | QR keyring config validation | Production secret identity | Yes | purpose/single-use/crypto/fail-closed PASS |
| `ACC-KRK-001〜007` | Karaoke | `KRK-*`, `DB-KRK-*` | G2/G3/G4/G6/G8/G10 | DB extension / sales config validation | schema readiness | Yes | no overlap/double-sale + canonical timing behavior |
| `ACC-GDS-001〜006` | Goods | `FR-GDS-*`, `BR-GDS-*`, `DB-GDS-*` | G3/G4/G5/G8/G10 | inventory/current-state config | staging/Prod smoke as applicable | Yes | no oversell/double-handoff |
| `ACC-EML-001〜009` | Email | `EML-*` | G3/G4/G6/G9 | Resend / worker config | Email Worker readiness | Yes | persistence/recipient/idempotency/unknown/no rollback |
| `ACC-DB-001〜012` | Database | `DB-*` | G2/G3/G10 | extension / role / migration validation | Production migration evidence | Yes | real PostgreSQL contract PASS |
| `ACC-API-001〜008` | API | `API-*` | G4/G5 | route/schema/auth manifest | API readiness | Yes | current route contract 100% + runtime validation |
| `ACC-SEC-001〜014` | Security | `SEC-*` | G5 + config scans | secret / headers / crypto / origin validation | Prod environment separation | Yes | all Critical security controls PASS |
| `ACC-REL-001〜011` | Reliability / Recovery | `REL-*` | G6/G10 | policy registry / scheduler config | worker readiness / scheduler evidence | Yes | timeout/retry/unknown/recovery converge safely |
| `ACC-OBS-001〜013` | Observability / Audit | `OBS-*` | G7 + DB atomicity cases | dashboard/alert/retention config | Better Stack / independent alert / purge evidence | Yes | schema/correlation/redaction/audit PASS |
| `ACC-TST-001〜013` | Test evidence | `TST-*`, `TC-*` | G1〜G10 required | runner retry/quarantine manifest | staging gate evidence | Yes | group policy + semantic coverage PASS |
| `ACC-INF-002〜022` | Infrastructure / deployment | `INF-*` | infra validation + required suites | env / identity / backup / health config | staging + Production deployment | Yes | Current INF contract PASS |
| `ACC-DEV-001〜016` | Development guideline | `DEV-*` | static + required test groups | tsconfig/import/secret/traceability | completion evidence | Yes | self-verification all required PASS |
| `ACC-RELSE-001〜004` | Production acceptance boundary | `INF-DEP-*`, `INF-TST-*` | required release suite | approval / backup / config drift | Production post-deploy | Yes | phase distinction + final evidence complete |

---

# Part XX — Production Promotion / Acceptance Algorithm

## 39. Pre-production promotion decision

Production promotionを許可するには、少なくとも次をすべて満たす。

1. same release identityのRelease Manifestが確定している。
2. Current Spec Version Setが確定している。
3. Merge gate required groupsがclean passしている。
4. staging pre-release required groupsがclean passしている。
5. G9 Provider Contract Smokeがprotected nonproduction credentialでpassしている。
6. Critical retry=0 / Critical quarantine=0。
7. G2 / Production migration pre-validationがpassしている。
8. Security / secret / environment dry validationがpassしている。
9. Production backup freshness / recovery pointがCurrent `SPEC-180` requirementを満たす。
10. required approval actor referenceがある。
11. open UCRがCurrent mandatory Acceptanceを成立不能にしていない。

**ACC-RELSE-005:** 1項目でも満たさない場合 `production_promotion_allowed=false` とする。

---

## 40. Final System Acceptance decision

Production deploy後、System Acceptanceは次の論理式で判定する。

```text
ACCEPTED :=
  production_deployment_identity_matches_release
  AND all_required_production_migrations_passed
  AND all_required_services_ready
  AND production_smoke_passed
  AND required_post_deploy_observation_passed
  AND no_blocking_infrastructure_alert_condition
  AND all_blocking_ACC_criteria == PASS
  AND critical_test_retry_count == 0
  AND critical_quarantine_count == 0
  AND no_acceptance_blocking_open_ucr
  AND all_evidence_identity_matches_release
```

上記のどれかがfalseなら:

```text
acceptance_result = REJECTED
```

すべてtrueなら:

```text
acceptance_result = ACCEPTED
```

**ACC-RELSE-006:** evaluator実装が例外 / parse failure / missing evidence / unknown criterion statusへ遭遇した場合、default ACCEPTEDにせずFail Closedで`REJECTED`とする。

---

# Part XXI — Acceptance Failure / Re-evaluation

## 41. Acceptance Failure record

Acceptance failureは最低限次をmachine-readableに記録する。

```text
failure_id
acceptance_id
canonical_rule_ids[]
release_ref
git_sha
evidence_ref
failure_class
observed_result
expected_result
required_rerun_test_case_ids[]
required_rerun_groups[]
new_release_required:boolean
same_artifact_reevaluation_allowed:boolean
open_ucr_ref|null
created_at
```

**ACC-GEN-024:** Failure Evidenceを削除、上書き、別commitのPassへ差し替えて履歴から消さない。

**ACC-GEN-025:** test runner retry / quarantine / rerunでoriginal Failure RecordをPassへ書き換えない。

---

## 42. New releaseが必要な変更

次のいずれかが変わる場合、原則として新しいRelease Ref / Release Evidenceを生成する。

- source code
- lockfile / resolved dependency
- migration source / migration set
- generated production artifact
- behaviorを変えるbuild-time config
- Canonical spec version setのbehavioral rule

**ACC-GEN-026:** 修正commitのTest結果を失敗releaseへ遡及適用しない。

---

## 43. Same artifactで再評価可能な場合

binary / source / migration / spec setが同一で、失敗原因が次のようなEnvironment / Evidenceだけである場合は同一artifactで再評価してよい。

- staging / Productionの誤ったnon-code configurationをCanonical値へ修正した。
- deployment identity / readiness / alert routing / dashboard provisioningを修復した。
- Provider nonproduction credential outageが解消し同じartifactでG9を再実行した。
- backup freshness / restore rehearsal / external support evidenceが更新された。

この場合も新しいrun / deployment / validation Evidenceを生成し、旧failureを保持する。

**ACC-GEN-027:** same artifact再評価可否は「コードを変えていない」だけでは決めず、migration set / spec set / build artifact hash / runtime config impactを比較する。

---

## 44. Acceptance再評価Trigger

次が発生した場合、該当scopeのAcceptanceを再評価する。

- new release candidate
- Canonical spec revision
- UCRが対象Canonical Ownerへ反映された
- migration set変更
- Production config / Secret / key rotation
- Provider contract change / drift detection
- security incident / credential compromise
- restore / rollback / disaster recovery
- required Evidence expiry / loss
- Critical alertがreleaseと相関し、acceptance assumptionを無効化した
- Test manifest / rule-code-mapの変更

再評価はCurrent Canonical versionを使用し、過去versionのPassを無条件継承しない。

---

# Part XXII — UCR-aware Production Acceptance

## 45. UCR impact classification

Open UCRの`acceptance_impact`は次から選ぶ。

```text
CURRENT_REQUIREMENT_BLOCKED
CURRENT_TRACEABILITY_GAP
FUTURE_ONLY_REQUEST
NON_BLOCKING_CLARIFICATION
```

判定rule:

- `CURRENT_REQUIREMENT_BLOCKED`: Current Canonical `FR-*` / `REL-*`等を現行owner contractだけで完成実装・検証できない。`blocking=true`。
- `CURRENT_TRACEABILITY_GAP`: behaviorはCurrent contractでTest可能だがCanonical identifier等が不完全。Current ownerが明示fallbackを認める場合のみ`blocking=false`にできる。
- `FUTURE_ONLY_REQUEST`: UCRだけに存在する新behavior。Acceptance対象外。
- `NON_BLOCKING_CLARIFICATION`: Current behavior / evidenceに影響しない説明改善。

**ACC-TRC-009:** UCRのclassificationはUCR本文の「変更しない場合の影響」と対象Canonical OwnerのCurrent ruleから決定し、将来の採用を推測しない。

**ACC-TRC-010:** `CURRENT_REQUIREMENT_BLOCKED`が1件でも未解消ならfinal System Acceptanceは`REJECTED`である。

---

# Part XXIII — Acceptance Evidence Security

## 46. Evidence redaction

Acceptance artifact / CI artifact / release noteは次を含めてはならない。

- raw QR token / payload / decrypted QR material
- Supabase access / refresh token
- Password / reset / verification token
- Stripe / Resend / Supabase / DB Secret
- QR HMAC / AEAD key
- raw webhook body
- full provider response / error object
- SQL bind values / full DB dump
- full recipient Email unlessCurrent secure support contractで明示的に必要かつrestricted artifactである場合
- Production Business Data fixture
- unnecessary PII

**ACC-SEC-015:** Evidence generator自体をsecurity-sensitive sourceとして扱い、redaction failureはCritical acceptance failureとする。

---

# Part XXIV — SPEC-200 Self Acceptance Criteria

## 47. SPEC-200自身のAcceptance Criteria

本仕様書は少なくとも次をすべて満たすことを要求する。

1. `INV-010-01〜10`すべてにSystem Acceptance IDが存在する。
2. 各InvariantがCanonical Rule → Test Case / Group → Required Evidence → Failure outcomeへ接続される。
3. Critical Invariant未検証をwarning-onlyでProduction Acceptanceできない。
4. Current `FR-*`からsystem-level Acceptanceへ100% traceできる。
5. `BR-*` / `DI-030-*`からTest / Acceptanceへtraceできる。
6. Authentication / Authorization acceptanceが存在する。
7. Administrator非generic-superuser、Administrator非Staff暗黙継承を維持する。
8. Payment / Refund acceptanceが存在する。
9. Payment Authority、verified Webhook、amount authority、Business Confirmation atomicity、Result Unknownを受入可能である。
10. Ticket / QR / Check-in purpose separation / single-use / concurrency acceptanceが存在する。
11. Karaoke二重販売防止 / Hold / Reservation / Check-in acceptanceが存在する。
12. Goods oversell / Handoff duplication acceptanceが存在する。
13. Email failureがBusiness rollbackを引き起こさないことを受入可能である。
14. Notification Request / recipient / worker / claim / Provider Idempotency / Unknown Result acceptanceが存在する。
15. API current contract / Hono RPC / Zod / owner-safe / common error / idempotency acceptanceが存在する。
16. Database named constraint / migration / extension / isolation / lock / bigint / history acceptanceが存在する。
17. Database acceptanceをUnit mockだけで成立させない。
18. Security acceptanceがFail Closedを維持する。
19. Browser bundle secret absence、DB credential isolation、Production environment separationを検証する。
20. QR HMAC / AEAD / key rotation / no raw QR artifactを検証する。
21. Reliability / timeout / retry / jitter / budget / Result Unknown / reconciliation / recovery acceptanceが存在する。
22. recoveryで元Transactionを最初から再実行しないことを検証する。
23. Observability / Audit / correlation / bounded metric / dashboard / alert / retention acceptanceが存在する。
24. raw QR / Secret / Session / Password / token / prohibited Email / raw webhook / provider full object / SQL bind / JWT dump / unnecessary PII absenceを検証する。
25. Test EvidenceとAcceptance Criteriaがmachine-readableに接続される。
26. G1〜G10をCurrent `SPEC-170/180`どおり扱う。
27. Critical Test retry=0 / Critical quarantine禁止を維持する。
28. diagnostic rerunでoriginal failureを上書きしない。
29. real PostgreSQL / Provider Test Double / Provider Contract Smoke / deterministic Clock / Random / fault injection / concurrencyをAcceptanceへ接続する。
30. `tests/traceability/test-manifest.json` をAcceptanceへ接続する。
31. Infrastructure environment / deployment / migration / readiness / scheduler acceptanceが存在する。
32. Better Stack / Healthchecks.io / Audit purge infrastructure acceptanceが存在する。
33. backup / restore / rollback readiness acceptanceが存在する。
34. Production approval / immutable release identity / staging evidence / deployment health evidenceを要求する。
35. SPEC-190 repository / dependency / strict TypeScript / runtime validation / forbidden import acceptanceへ接続する。
36. Browser direct DB禁止、external network inside DB transaction禁止をAcceptanceへ接続する。
37. Secret scan / raw QR・PII・Secret logging review / generated migration reviewをAcceptanceへ接続する。
38. Test-first / `rule-code-map.json` / completion evidence / git diff self-review / UCR protectionへ接続する。
39. release identityとEvidenceを別release間で混同しない。
40. Acceptance ManifestはRelease Manifestを別authorityとして複製せずreferenceする。
41. merge / staging deploy / Production promotion / Production deploy / System Acceptanceを区別する。
42. final resultは`ACCEPTED` / `REJECTED`だけである。
43. Critical failure / migration failure / infrastructure identity mismatch / Critical Invariant未証明をknown issueでAcceptanceしない。
44. Acceptance failureがaffected Acceptance ID / Canonical Rule / release / rerun / new release requirementへtraceできる。
45. UCR-only仕様をCanonicalとして扱わない。
46. `UCR-130-001〜006`を反映済みと仮定しない。
47. `UCR-150-001〜002`を反映済みと仮定しない。
48. `UCR-170-001`を反映済みと仮定しない。
49. Current requirementを未反映UCRなしでは満たせない場合、そのgapをAcceptance failureとして明示する。
50. Canonical Owner / `depends_on` /情報源優先順位 / UCRを守る。
51. 長期運用される完成システムを対象とする。
52. MVP / Step1 / Step2等を理由にSecurity / Payment / DB / QR / Reliability / Observability / Audit / Test / Infrastructure / Backup / Development traceability acceptanceを省略しない。
53. 正式仕様として判断を保留する未確定表現を残さない。

---

# Part XXV — Upstream Change Requests

## 48. 新規Upstream Change Request

本書から新規UCRは発行しない。

本書は次の既存UCRを未反映として継承し、Acceptance Manifestでimpactを分類する。

```text
UCR-130-001〜006
UCR-150-001〜002
UCR-170-001
```

対象Canonical Ownerが改訂され本文へ反映された場合、その改訂版をCurrent CanonicalとしてSpec Version Setを更新し、影響するAcceptance ID / Test Manifest / rule-code-map / release evidenceを再評価する。

---

# Part XXVI — Specification Series Completion Handoff

## 49. 標準仕様系列完了後の運用

`SPEC-200` は現在予定されている標準仕様系列の最終System Acceptance仕様である。存在しない後続SPEC番号を自動的に作成予定とはしない。

### 49.1 新たな正式仕様が必要になる条件

新規仕様書は、次をすべて評価したうえで既存Canonical Ownerへ安全に吸収できない独立責務が生じた場合だけ追加する。

- 既存specのCanonical Scopeへ自然に追加可能か。
- 既存specへ追加するとCanonical Ownerが複数責務へ肥大化し、依存関係が不明瞭になるか。
- 新しいexternal provider / subsystem / domain capability / compliance boundary等、独立したauthorityが本当に存在するか。
- 既存Rule ID familyで一意に追跡できるか。

単なる実装詳細、1つのfeature task、temporary migration、MVP段階を理由に新規正式仕様を作らない。

### 49.2 既存仕様改訂時

既存Canonical behaviorを変更する必要がある場合は、変更元specをversioned revisionし、`SPEC-000`のUCR / impact trackingに従って影響specを列挙する。

変更後は最低限次を再評価する。

- downstream specification consistency
- Test Manifest semantic coverage
- rule-code-map
- migration / API / Security / Reliability impact
- Acceptance Matrix
- Release Evidence compatibility

### 49.3 実装agentへ渡すCanonical specification set

実装agentへは全仕様を無条件に渡すのではなく、`SPEC-000` + 実装対象Canonical Owner + その`depends_on` + change categoryに直接必要なSecurity / Reliability / Test / Infrastructure / Development ownerを選定する。

Production releaseを最終判定するAcceptance agentは、本書の`depends_on`と、Test Manifest / rule-code-mapが実際に参照するCurrent Canonical spec setを使用する。

---

## 50. 最終確認

本書は次を意図的に行っていない。

- System Boundaryの変更
- Business Rule / Domain Stateの追加
- Page / Routeの追加
- API endpoint / Operation IDの先取り追加
- DB table / constraint / indexの先取り追加
- Payment / Refund / QR / Email state machineの変更
- retry count / timeout / reconciliation cadenceの再定義
- Observability event / metric / alert threshold / retentionの再定義
- Infrastructure topology / provider productの変更
- AI Development Guidelineの再定義
- Administrator generic superuserの追加
- Administrator → Staff role inheritanceの追加
- UCR-only Capability / API / Recovery command / UI / Index / Operation IDのCanonical化
- Critical failureをwarning-onlyでProduction Acceptedへ変換するfallback

System Acceptanceは、**同一release identityに紐づくCurrent Canonical Ruleと実行Evidenceが、Blocking Criterionをすべて満たした場合だけ `ACCEPTED` とする**。

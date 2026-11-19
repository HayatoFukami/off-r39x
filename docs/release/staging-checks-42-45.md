# staging での外部事実の確認: Railway ingress の forwarded header（#42）と Redis の `noeviction` / `maxmemory`（#45）

- 作成日: 2026-11-19
- 位置づけ: **仕様ではない**（正式仕様は `docs/specs/`。食い違ったら仕様が正）。`SPEC-180 §17.2` の表の #1（forwarded header と `TRUSTED_PROXY_HOPS`）と #4（`maxmemory-policy noeviction` と `maxmemory`）を、staging で確かめる手順書。**実行者は担当2**。
- 関連: [手順書](release-runbook.md)（§3.1 順2、§4.2、§4.4）、Issue #42・#45。#43（Redis の TLS）と #44（Redis の実バージョン）は本書の対象外。
- 根拠: `docs/specs/` と実装（`origin/dev` `17f6f76`）、Railway の公式資料（2026-11-19 に閲覧。**実機では未確認**。資料の記載は断定しない）。
- 書かないもの: Secret の値、接続文字列・password、本システムの実際のホスト名、IP アドレス（自分の回線・peer・Railway 内部のアドレスを含む）、counter key 名、実在のメールアドレス。ホストの例は `https://api.staging.example.com`、IP の例は文書用の `192.0.2.0/24`・`198.51.100.0/24`・`203.0.113.0/24` だけを使う（例外は、container の中から自分自身に送るための loopback の `127.0.0.1` だけ）。

---

## 0. 要点

1. **#42**: API の未一致 path（`GET /ops-check/not-found`）に、毎回異なる偽の `X-Forwarded-For` を付けて送る。429 が予定の回数（B+1 回目）で出れば、偽の header は Client IP に使われていない。別の回線から送って 429 にならなければ、利用者が 1 つの IP に集約されていない。`TRUSTED_PROXY_HOPS` を 1 つ大きくして同じ試験をすると、Railway が header を**追記**するか**上書き**するかがわかる。ログもデバッグ用の endpoint も使わない。
2. **#45**: Redis の start command で `maxmemory`・`maxmemory-policy noeviction` を固定し、restart 後と再デプロイ後に `CONFIG GET` で値が残ることを確かめる。合成 key で 1 件あたりのメモリを実測して `maxmemory` を決める。最後に staging でだけ Redis を満杯の状態にして、API が `503 TEMPORARY_UNAVAILABLE` を返すことを確かめ、元に戻す。
3. 合格なら、staging の `TRUSTED_PROXY_HOPS` の値、header の扱い（追記・上書き）、`maxmemory` の値とその根拠が決まる。
4. **不合格なら、Production promotion を止めたまま**（`INF-RLS-008`）、観測結果を Issue に記録する。担当1 が UCR 案（`SPEC-000 §15.2` 形式）を作り、利用者が判断する。担当2 は仕様・実装を変えない。
5. 順序は §2 準備 → §3 #45 構成と設定 → §4 #42 → §5 #45 実測 → §6 #45 満杯試験 → §7 後片付け → §8 記録。§3 を先に行うのは、Redis の再起動で counter が消え、#42 の試験の前提（counter が空）を作り直す必要があるため。
6. 各手順は「**やること／期待する観測結果／合否／不合格のとき**」の 4 項目で書く。

---

## 1. Railway の資料の記載（2026-11-19 閲覧、実機では未確認）

| 資料 | 記載 | 本書で確かめること |
| --- | --- | --- |
| [Public networking の specs and limits](https://docs.railway.com/networking/public-networking/specs-and-limits) | Request Headers に `X-Real-IP`、`X-Forwarded-Proto`、`X-Forwarded-Host`、`X-Railway-Edge`、`X-Request-Start`、`X-Railway-Request-Id` がある。**`X-Forwarded-For` の記載はない**。上書きか追記か、段数の記載もない | 実装は `X-Forwarded-For` だけを使う（`SEC-API-031`）。§4 で、`X-Forwarded-For` の有無と形を挙動から判定する |
| [Redis](https://docs.railway.com/databases/redis) | 公式 `redis` Docker image の単一ノード。image・start command・variables を変えると利用者が管理する扱いになる。外部公開は Settings → Networking の Public Access（TCP Proxy） | §3。TCP Proxy・Public Access は付けない（`INF-RLS-002`） |
| [Redis を cache / store として使う guide](https://railway.com/guides/redis-cache-vs-store) | 既定は image の RDB snapshot。redis-server の設定は start command で渡す（cache の例は `--save "" --appendonly no --maxmemory … --maxmemory-policy allkeys-lru`）。`maxmemory` は想定ピークの container メモリのおおむね半分を推奨 | §3・§5。本システムは `allkeys-*` を使わない（`INF-RLS-004`） |
| [Start command](https://docs.railway.com/deployments/start-command) | image のデプロイでは、start command が ENTRYPOINT を exec 形式で置き換える。変数を展開するには `/bin/sh -c "exec …"` が要る | §3.4 |
| [`railway ssh`](https://docs.railway.com/cli/ssh)、[`railway connect`](https://docs.railway.com/cli/connect) | `railway ssh` は SSH 鍵の登録が必要。`railway connect` は TCP Proxy がなければ SSH でトンネルする（ローカルに `redis-cli` が要る） | §3.2 |
| [Variables](https://docs.railway.com/variables)、[Staged changes](https://docs.railway.com/deployments/staged-changes) | 変数の変更は staged になり、Deploy で影響する service が再デプロイされる | §4.7 |
| [Plans](https://docs.railway.com/pricing/plans) | プランごとの service のメモリ上限 | §5.4 |

資料と実機の挙動が違ったら、**実機の観測を記録し、資料との差を Issue に書く**。

---

## 2. 作業前の準備

### 2.1 告知

- **やること:** staging を使う人（担当1・運営者）に、日時と影響を事前に知らせる。影響は次のとおり。
  - API の再デプロイ。
  - `TRUSTED_PROXY_HOPS` を一時的に変える間、IP を偽装できる状態になるか、全員が 1 つの IP に集約されて 429 になることがある。
  - 満杯試験の間は、rate limit を通る全 request が 503 になる。
  - Redis の再起動で counter が消える（`INF-RLS-003` で許容されている）。
- **期待:** 試験の時間帯に、他の人が staging を使わない。
- **合否:** 告知が済んでいれば次へ進む。
- **不合格のとき:** 日時を改める。

### 2.2 道具

- **やること:**
  - bash（Windows は Git Bash でよい）、curl **7.84 以上**（`-w '%header{retry-after}'` を使う。`curl --version` で確かめる）、Railway CLI（ログイン済み、SSH 鍵を Railway に登録済み）を用意する。
  - **回線A 用と回線B 用に、同時に使える端末を 1 台ずつ用意する**（例: 固定回線の PC と、モバイル回線にテザリングした 2 台目の PC）。§4.3 の T3 では、一方の回線が 429 を受けてから 10 秒以内に、もう一方の回線から送る必要がある。1 台の PC で回線を切り替えると間に合わない。両方の端末で、§2.3 の `export` と §4.6 の関数の定義を済ませておく。
- **期待:** `curl --version` が 7.84 以上。`railway whoami` が成功する。2 台の端末の両方で、§4.6 の関数が使える。
- **合否:** すべてそろえば次へ進む。
- **不合格のとき:** curl を更新する。古い curl しかなければ、§4.6 の `retry-after=` の表示を省いて status だけで判定する（`Retry-After` の確認は別に `curl -sS -D - -o /dev/null …` で 1 回行う）。

### 2.3 変数と上限値

- **やること:**
  1. 自分のシェルで `export STAGING_API_ORIGIN=<staging API の origin>` を設定する（例 `https://api.staging.example.com`。実際の値は本書・記録に書かない）。
  2. Railway の画面で、environment が **staging** であることを確かめてから、staging environment の api service の Variables で `RATE_LIMIT_CONFIG`（Secret ではない JSON）を開き、`public_read` の `burst_limit` と `sustained_limit` を読む。**B = min(burst_limit, sustained_limit)** とし、`export B=<数>` で設定する。
  3. 同じ画面で `TRUSTED_PROXY_HOPS` の現在値を読む。
- **期待:** B は 1 以上 20 以下（`SPEC-140 §68` の ceiling は burst 20・sustained 120）。`TRUSTED_PROXY_HOPS` は 0 以上の整数。
- **合否:** 値が読めれば次へ進む。B・burst_limit・sustained_limit・`TRUSTED_PROXY_HOPS` の値は記録してよい。B が 1、または `sustained_limit` が `burst_limit` + 1 のときは、§4.3 の T3 の前提を満たさず T3 を判定できないので、§4 に進む前に担当1 に連絡する。
- **不合格のとき:** `RATE_LIMIT_CONFIG` や `TRUSTED_PROXY_HOPS` がない、または ceiling を超えている場合は、API が Ready にならないはず（`SEC-ABU-010`、`SEC-API-030`）。担当1 に連絡して止める。

### 2.4 回線

- **やること:** 回線A（例: 固定回線）と回線B（例: スマートフォンのモバイル回線、またはそのテザリング）を、§2.2 の 2 台の端末にそれぞれつなぐ。両方の**グローバル IP が異なること**を確かめる（手段は問わない。値は記録せず、「異なる」とだけ記録する）。
- **期待:** 回線A と回線B のグローバル IP が異なる。どちらの回線でも、staging Web を開いたブラウザなど、他の staging への通信が流れていない。
- **合否:** 異なれば次へ進む。
- **不合格のとき:** 同じなら別の回線を用意する。
- **注意:** 未一致 path と公開 API（`API-PUB-*`）は、同じ `public_read` の IP ごとの counter を使う。同じ回線の他の通信が混ざると件数がずれる。

### 2.5 staging と production の構成

- **やること:** staging と production の API について、次の 3 点が同じかを確かめて記録する。
  - API host の DNS が Cloudflare の proxy を通るか（DNS only か）
  - API host が Cloudflare Access の対象か
  - Railway での custom domain の付け方と region
- **期待:** 3 点とも同じ。
- **合否:** 同じなら、staging で決めた `TRUSTED_PROXY_HOPS` を production にも使える見込みになる。
- **不合格のとき:** どれかが違えば、proxy の段数が変わりうるので、**staging の結果を production に流用しない**。差を Issue #42 に記録し、担当1 に連絡する。
- **production での確認（推奨）:** 構成が同じでも、production の API をデプロイした後、promotion の前に、§4 の T1〜T3 と、Redis の `CONFIG GET`（§3.5 の 4 項目）を行うことを推奨する。満杯試験（§6）と合成 key の実測（§5）は production では行わない。
  - **T1〜T3 の影響:** T1〜T3 は、未一致 path と公開 API（`API-PUB-*`）が共有する `public_read` の IP ごとの counter を、わざと上限まで使う（§2.4 の注意）。検証の端末と出口の IP を共有する利用者（同じ NAT の内側など）がいれば、その利用者の公開 API の request も、最長で 60 秒ほど 429 になる。`TRUSTED_PROXY_HOPS` が誤っていて全員が 1 つの IP に集約されている場合は、全利用者に及ぶ。
  - **実施の条件:** production の T1〜T3 は、production API に利用者の通信が来ていないことを確かめられるとき（公開の前で、production Web からの通信も流れていないときなど）だけ行う。確かめ方は運営者が決める。
  - **実施の方法:** 本書の接続手順（§3.2 は staging 以外なら切断する）とコマンド（§4.6 は `STAGING_API_ORIGIN` を使う）は staging 用である。production で行うときの接続先の選び方と origin の変数は、担当1 と運営者が決める。
  - **条件を満たせないとき:** T1〜T3 は行わず、`CONFIG GET` だけを行う。Issue #42 に「production の T1〜T3 は未実施」と理由を記録する。その状態で promotion してよいかは本書では決めない（`SPEC-180 §17.2` が求めるのは staging での確認で、production での確認は本書の推奨にとどまる）。担当1 と利用者が判断する。

### 2.6 API への到達

- **やること:** 回線A から次を 1 回ずつ実行する。

  ```bash
  curl -sS -o /dev/null -D - "$STAGING_API_ORIGIN/ops-check/not-found" | grep -i -E '^(HTTP|x-request-id)'
  curl -sS -o /dev/null -w '%{http_code}\n' "$STAGING_API_ORIGIN/internal/health/ready"
  ```

- **期待:** 1 つ目は status `404` で、`X-Request-Id` header が**ある**。この header は API が全応答に付けるもので、header があれば応答が API から来ていることがわかる。header の値は記録しない。2 つ目は `200`。
- **合否:** 両方とも期待どおりなら次へ進む。
- **不合格のとき:**
  - 302・403、Cloudflare Access のログイン画面、`X-Request-Id` のない 404 が返った場合は、その経路では本書の手順を実行できない。staging API が Cloudflare Access の背後にある場合の実行方法（一時的に対象から外す、Access の service token を担当2 の端末の環境変数だけで使う、など）は、担当2 と運営者が決める。service token は Secret なので、本書や記録には書かない。Access 経由で試験するなら Cloudflare の 1 段が加わるので、§2.5 の構成の比較に含める。
  - `/internal/health/ready` だけが外部から到達できない構成なら、以後の readiness の確認は、§2.6.1 の内部経路で行う。Railway 上の deployment の状態では代えない（deployment が Active のまま、稼働中の readiness だけが 503 に変わることがあるため）。

#### 2.6.1 readiness を内部経路で確かめる（外部から到達できない場合）

- **やること:**
  1. ローカル端末で `railway status` を実行し、environment が staging であることを確かめる。`railway ssh` で、staging environment の **api** service の container に入る（environment は staging を明示して選ぶ）。
  2. container 内で次を実行する。API の process と同じ container の中から、待受の port（`PORT` 変数）に直接送る。環境変数の一覧（`env` など）は表示しない。

     ```sh
     node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/internal/health/ready").then((r) => console.log(r.status), () => console.log("error"))'
     ```

- **期待:** `200`（Ready のとき）または `503` が表示される。
- **合否:** status が表示されれば、以後この経路で readiness を確かめる。
- **不合格のとき:** `error` になる、SSH が使えない、または container に `node` がない場合は（API は IPv4 の全アドレスで待ち受けるので、IPv6 の loopback では試さない）、readiness は**観測できない**ものとして記録する。§3.4・§3.6・§6.4 の ready の確認は、未一致 path の status だけで判定する。§6.3 の ready の項目は「観測不能」とし、§6.3 の合否に従う。

### 2.7 記録の準備

- **やること:** 日付（UTC）、API の commit SHA、API と rate-limit-redis の deployment ID を控える。記録は §8 のテンプレートに書き込んでいく。
- **期待:** 3 つとも控えてある。
- **合否:** 控えてあれば §3 へ進む。
- **不合格のとき:** 控えてから進む。

---

## 3. #45 Redis の構成の確認と設定（§4 より先に行う）

### 3.1 構成の確認

- **やること:** Railway の画面で environment が **staging** であることを確かめてから、staging environment の rate-limit-redis service について次を確かめる。
  - service が 1 つだけある（`INF-RLS-001`）
  - Settings → Networking に public domain・TCP Proxy・Public Access が**ない**（`INF-RLS-002`）
  - Volume が**ない**（`INF-RLS-003`）
  - replicas が 1（`INF-RLS-005`）
  - email-worker と reconciliation-worker の Variables が、Redis の接続情報（`RATE_LIMIT_REDIS_URL` など）を参照していない（`INF-RLS-002`。実装も、worker に `RATE_LIMIT_REDIS_URL` があると起動を拒否する）
- **期待:** すべて満たす。
- **合否:** すべて満たせば次へ進む。
- **不合格のとき:** staging ではその場で直してよい（Volume を外す、TCP Proxy を消す、など。counter は消えてよい）。直せない場合は、理由を Issue #45 に記録して担当1 に連絡する。

### 3.2 Redis への接続

- **やること:**
  1. 第一候補は `railway ssh` で rate-limit-redis の container に入り、container 内の `redis-cli` を使う方法（project・environment・service の選び方は `railway ssh --help` で確かめる）。`railway ssh` を実行する**前に**、同じローカル端末で `railway status` を実行し、environment が staging であることを確かめて記録する。`railway ssh` でも environment は staging を明示して選ぶ。production を選んでいたら、何も実行せずに切断する。第二候補は `railway connect`（SSH でトンネルし、ローカルの `redis-cli` を使う）。`railway connect` は、端末やプロセスの引数に接続情報が出るおそれがあるので第二候補にしている。
  2. **TCP Proxy・Public Access は一時的にも付けない**（`INF-RLS-002`）。
  3. password は画面・コマンド履歴・記録に残さない。container 内では、rate-limit-redis の Variables にある password の変数（変数名は Variables で確かめる。以下では例として `REDIS_PASSWORD` と書く）から渡す。値を `echo` せず、`-a <値>` も使わない。

     ```sh
     export REDISCLI_AUTH="$REDIS_PASSWORD"
     redis-cli PING
     ```

  4. restart・再デプロイで SSH の接続が切れた後など、**接続し直すたびに手順 1 と手順 3 を行う**。
- **期待:** `PONG` が返る。
- **合否:** `PONG` が返れば次へ進む。この接続は「保守のための一時的な接続」として記録する。業務の接続元（`INF-RLS-002` の「接続元は API service だけ」）として扱うかどうかの解釈は、担当1 が UCR 案で扱う（利用者の決定、2026-11-19）。
- **不合格のとき:** SSH が使えない、または container に `redis-cli` がない場合は、TCP Proxy を付ける代わりに、状況を Issue #45 に記録して担当1 に連絡する。

### 3.3 現在の設定を読む

- **やること:** 次を実行し、出力を控える。

  ```sh
  redis-cli INFO server | grep -E '^(redis_version|redis_mode):'
  redis-cli CONFIG GET maxmemory
  redis-cli CONFIG GET maxmemory-policy
  redis-cli CONFIG GET save
  redis-cli CONFIG GET appendonly
  redis-cli CONFIG GET zset-max-listpack-entries
  redis-cli INFO persistence | grep -E '^(rdb_bgsave_in_progress|rdb_last_save_time|aof_enabled):'
  redis-cli INFO memory | grep -E '^(used_memory|used_memory_rss|used_memory_peak|maxmemory|maxmemory_policy|mem_fragmentation_ratio):'
  ```

  あわせて、Railway の画面で rate-limit-redis の現在の start command を確かめる。
- **期待:** 値が読める。設定前なので、`maxmemory` は `0`（無制限）、`maxmemory-policy` は `noeviction` 以外、`save` は空でない、のいずれかでもよい。
- **合否:** 読めれば次へ進む。記録してよいのは、`CONFIG GET` と `INFO` の数値、start command のうち Secret でない引数。`redis_version` は #44 の確認にも使えるが、#44 への記録は #44 の手順で行う。
  - ここで控えた start command（Secret でない引数）と `maxmemory` を「**元の設定**」として記録する。§3.5 が合格する前に中断したときの戻し先になる（§7）。
- **不合格のとき:** `CONFIG` が使えない（rename・無効化されている）場合は、**§3.4 以降に進まず、何も変えずに中断する。** `INFO` だけでは `save`（RDB を使わないこと: `INF-RLS-003`）を確かめられず、§6 で上限を一時的に下げて戻すこともできないため。`CONFIG` が使えないことと、`INFO memory` の `maxmemory`・`maxmemory_policy` の値を Issue #45 に記録し、担当1 に連絡する。続け方（`CONFIG` を使える構成にする、確認の方法を変える、など）は担当1 と利用者が決める。

### 3.4 start command を変える

- **やること:** Railway の画面で environment が **staging** であることを確かめてから、staging environment の rate-limit-redis の start command を次の形にする。
  - **認証の引数（password など）は残す。**
  - 既存の `--save`・`--appendonly`・`--dir`（Volume のパスを指すもの）・`--maxmemory`・`--maxmemory-policy` は**削除して**、次の引数に置き換える。後ろの引数で上書きされることに頼らない（Volume を外した後に、残った `--dir` で起動に失敗しうるため）。

  ```text
  <redis-server と認証の引数> --maxmemory <仮の値> --maxmemory-policy noeviction --save "" --appendonly no
  ```

  - 変数を展開する必要がある場合（例: password を変数から渡している場合）は、資料の記載に従い `/bin/sh -c "exec redis-server … "` の形にする。このとき、追加する引数は**引用符の内側**（`redis-server` の後ろ）に入れる。
  - `<仮の値>` は、service のメモリ上限の**半分以下**で担当2 が決める（例 `256mb`）。§5 の実測の後、確定値に置き換える。
  - `allkeys-*` などの eviction policy は使わない（`INF-RLS-004`）。
  - Railway では、start command を変えると利用者が管理する扱いになる（資料の記載）。`INF-RLS-003`・`INF-RLS-004` を満たすために必要なので受け入れる（利用者の決定、2026-11-19）。
  - Deploy して、rate-limit-redis の deployment ID を控える。変えた後の start command（Secret でない引数）と仮の値を「**仮の設定**」として記録する。§3.5 の合格の後、§5.4 で確定する前に中断したときの戻し先になる（§7）。
- **期待:** rate-limit-redis が起動する。API の readiness が、30 秒あまり（背景の probe の間隔）で 200 に戻る。
- **合否:** 起動すれば §3.5 へ進む。
- **不合格のとき:** 起動しない場合は、§7 の表の「§3.4 の後、§3.5 が合格する前」の戻し先（元の設定。§3.1 で Volume を外したなら、Volume を指す引数を除く）に戻して、状況を Issue #45 に記録し、担当1 に連絡する。

### 3.5 設定が再起動後も残ることの確認

- **やること:** 次の 3 回、それぞれ同じ確認を行う。(a) §3.4 の Deploy の後、(b) rate-limit-redis の **restart** の後、(c) rate-limit-redis の**再デプロイ**の後。(b)・(c) の restart と再デプロイは、それぞれ Railway の画面で environment が **staging** であることを確かめてから、staging environment の rate-limit-redis に対して行う。

  ```sh
  redis-cli CONFIG GET maxmemory
  redis-cli CONFIG GET maxmemory-policy
  redis-cli CONFIG GET save
  redis-cli CONFIG GET appendonly
  redis-cli INFO persistence | grep -E '^(aof_enabled|rdb_changes_since_last_save):'
  redis-cli INFO stats | grep -E '^evicted_keys:'
  ```

- **期待:** 3 回とも次のとおり。
  - `maxmemory` が指定した値（bytes で表示される）
  - `maxmemory-policy` が `noeviction`
  - `save` が空
  - `appendonly` が `no`、`aof_enabled:0`
  - `evicted_keys:0`
- **合否:** **restart の後と再デプロイの後の両方で一致すれば合格。** `CONFIG SET` だけで作った設定は再起動で消えるので、合格にしない。`CONFIG REWRITE` は使わない。
- **不合格のとき:** `save` だけが空にならない場合は、exec 形式で空文字の引数が渡っていない可能性がある（資料に記載がない）。`/bin/sh -c "exec redis-server … --save '' …"` の形を試してから判定する。それでも start command の引数が効かない、または Railway の制約で設定できない場合は、§7 の表の「§3.4 の後、§3.5 が合格する前」の戻し先に戻し、Production promotion を止めたまま観測を Issue #45 に記録し、担当1 に連絡する（`SPEC-180 §17.2` #4 は「設定できること」自体を確認する項目）。担当1 が store の方針を再検討する UCR 案を作る。

### 3.6 API が戻ることの確認

- **やること:** 回線A から次を実行する。

  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' "$STAGING_API_ORIGIN/internal/health/ready"
  curl -sS -o /dev/null -w '%{http_code}\n' "$STAGING_API_ORIGIN/ops-check/not-found"
  ```

- **期待:** Redis の再起動から 45 秒以内に、ready が `200`、未一致 path が `404` になる。
- **合否:** 両方とも期待どおりなら、この確認から **61 秒以上**空けて §4 へ進む（未一致 path に 1 回 admit されるので、すぐ始めると件数が 1 つずれる）。
- **不合格のとき:** 503 が続く場合は、API と Redis の接続（`RATE_LIMIT_REDIS_URL` の参照先）を確かめる。直らなければ担当1 に連絡する。

---

## 4. #42 forwarded header と `TRUSTED_PROXY_HOPS`

### 4.1 観測の方法と理由

- 送る先は、未一致 path の `GET /ops-check/not-found`（`/api/v1/*` と `/auth/*` 以外の、どの route にも一致しない path）にする。
- 理由: 未一致 path は、404 を返す前に `public_read` の IP ごとの burst・sustained の rule だけで評価される（`SEC-ABU-018`）。global rule・DB・認証・Provider に触れないので、副作用がない。上限が低い `auth_form_proxy` は、Provider への中継とメール送信の副作用があるので使わない。
- 判定は HTTP status と `Retry-After` header だけで行う。応答本文の形には依存しない。ログ、デバッグ用の endpoint、仕様にない endpoint は使わない。
- 実装の要点: Client IP は `X-Forwarded-For` をカンマで区切った要素の、**右から `TRUSTED_PROXY_HOPS` 番目**。`TRUSTED_PROXY_HOPS` が 0、header がない、要素が足りない、IP として解釈できない、のいずれかなら、API の接続相手（peer）のアドレスを使う（`SEC-API-031`）。

### 4.2 共通の規則

1. 試行と試行の間は **61 秒以上**空ける。burst（10 秒）と sustained（60 秒）の両方の window を空にするため。拒否された評価は counter に記録されない（`SEC-ABU-013`）。
2. 逐次版（§4.6）では、1 回の request ごとに curl を 1 回起動する（毎回新しい接続になる）。
3. 「ちょうど B+1 回目で 429」を判定するには、B+1 回を **9 秒以内**に送り終える必要がある（burst の window が 10 秒のため）。表示された `elapsed` が 9 秒を超えたら、その試行は無効とし、61 秒後にやり直す。回線が遅くて間に合わない場合は、並列版（§4.6）で B+1 本を同時に送り、「404 が B 件、429 が 1 件」という**件数**で判定する。評価は atomic なので、並列でも 429 はちょうど 1 件になる。**並列版も最後に `elapsed` を表示する。並列版でも 9 秒を超えた試行は無効とする**（T3 では、さらに §4.3 の T3 の条件を満たす必要がある）。
4. 429 には整数で 1 以上の `Retry-After` がある（`SEC-ABU-007`）。値は、超過した rule のうち、再び admit されるまでが最も長いものの秒数である。`burst_limit < sustained_limit` なら burst で拒否され、1〜10 程度（逐次版なら、おおよそ 10 − `elapsed`）になる。`burst_limit ≥ sustained_limit` なら sustained も超過するので、最大 60 程度になる。合否は「整数で 1 以上」だけで判定する。
5. B 回以内に 429 が出た場合は、同じ IP の他の通信と counter を共有している疑いがある。他の通信を止め、61 秒後にやり直す。
6. 503 が出た場合は、store の障害か drain 中である。§4 を中断し、§3.6 で readiness と Redis を確かめる。
7. 404・429・503 以外（`000` = curl の失敗、502・504 など）が 1 件でも出た試行は無効とし、61 秒後にやり直す。続くようなら §2.6 の到達確認からやり直す。
8. API host が IPv4 と IPv6 の両方のアドレスを持つと、curl を起動するたびに接続の family が変わり、counter が 2 つに分かれることがある（`SEC-API-032`）。T1 で 429 が出ないと ✗偽 と読み違えるので、`export CURL_OPTS=-4` を設定して IPv4 にそろえることを推奨する（IPv6 だけの回線では `-6`）。§4.6 の関数は `CURL_OPTS` を全ての curl に付ける。

### 4.3 試行

T1〜T4 は観測を集める手順であり、合否は §4.5 でまとめて判定する。

**値の探し方と順序**

1. 最初に試す値 x は、§2.3 で読んだ現在値とする（値が決まっていなければ 1）。x で T1〜T3 を行う。
2. x が ✓ でなければ、次の規則で次の値を選ぶ。範囲は 0〜3 とし、一度試した値はもう試さない。
   - 直前の結果が ✗共 なら、まだ試していない値のうち、より**大きい**方で最も近い値。✗偽 なら、より**小さい**方で最も近い値（§4.4 の表で、✗共 は段数が足りない側、✗偽 は段数が多すぎる側に出る）。
   - その向きにまだ試していない値がなければ、反対の向きで最も近い、まだ試していない値。
   - T1 で 429 が出ない値（✗?。peer が接続ごとに変わる場合など）は向きを示さないので、まだ試していない値を小さい順に試す。
   - ✓ になる値が見つかったら、それを h とする。0〜3 をすべて試しても ✓ がなければ不合格（§4.5）。
   - 例: 上書き型（H3）で x=2 なら、2（✗共）→ 3（✗共）→ 1（✓）。H4 で x=1 なら、1（✗偽）→ 0（✗共）→ 2（✗偽）→ 3（✗偽）で、すべて試して不合格。
3. h が決まったら、次の順に行う。
   1. h で T1〜T3 を行う（手順 2 で済んでいれば省略してよい）。
   2. h+1 に変えて T4 を行う。
   3. h に戻す。
   4. h が 1 以上なら、h−1 に変えて T1〜T3 を行う（手順 2 で済んでいれば省略してよい）。
   5. h に戻す。戻したことは、staging environment の api service の Variables の値が h で、staged change が残っておらず、Active な deployment が、h に戻した後の §4.7 の Deploy で作られたもの（§4.7 手順 4 で控えた ID）と一致することで確かめる（T1 は h±1 と結果が同じになりうるので、確認に使わない）。挙動でも確かめる場合は、T2 と T3 の手順 1〜2 を行う。

   値を変えるたびに §4.7 の手順で再デプロイし、Ready になるのを待つ。試す値は h−1・h・h+1 を必須とし、0〜3 の残りは任意とする（利用者の決定、2026-11-19）。

**T1（偽 header なし）**

- **やること:** 回線A から、`X-Forwarded-For` を付けずに B+1 回送る（`run_trial none`）。
- **期待:** 1〜B 回目は `404`、B+1 回目だけ `429`（整数の `retry-after`）。

**T2（毎回異なる偽 header）**

- **やること:** 61 秒後、回線A から、毎回異なる偽の `X-Forwarded-For` を付けて B+1 回送る（`run_trial vary`）。偽の値は 1 要素（`203.0.113.<i>`）、2 要素（`198.51.100.<i>, 192.0.2.<i>`）、3 要素を順に入れ替える。
- **期待:** T1 と同じく、ちょうど B+1 回目で `429`。偽の値が counter の key に使われていれば、毎回別の key になるので 429 は出ない。

**T3（別の回線との独立）**

回線A と回線B の 2 台の端末を同時に使う（§2.2）。

- **やること:**
  1. 61 秒後、回線A の端末から並列版で B+1 本送る（`run_parallel none`。1 秒ほどで終わる）。`elapsed` を見る。T3 は回線どうしが独立しているかの確認で、偽装の確認は T2 が受け持つので、偽の header は付けない。T2 で ✗偽 になった値では T3 を省き、その値を ✗偽 としてよい。
  2. 続けて、回線B の端末から 1 回送る（**本番の 1 回**）。その結果が表示されたらすぐに、回線A の端末からも 1 回送る（**対照の 1 回**）。両方の端末に次のコマンドを入力しておき、Enter を押すだけにしておく。

     ```bash
     curl -sS -o /dev/null ${CURL_OPTS:-} -w '%{http_code} retry-after=%header{retry-after}\n' "$STAGING_API_ORIGIN/ops-check/not-found"
     ```

     次の 3 つをすべて満たす試行だけを有効とする。満たさなければ無効とし、61 秒後に手順 1 からやり直す。
     - 手順 1 の `elapsed` が 9 秒以下で、`404` が B 件、`429` が 1 件。
     - 対照の 1 回が、本番の 1 回の結果が出た**後**に送られている。
     - 対照の 1 回が `429` で、その `retry-after` が「手順 1 の `elapsed` + 2」以上（例: `elapsed=1s` なら 3 以上）。間に合わない場合は、手順 1 の直後に本番の 1 回を送るよう、入力を済ませておく。

     **対照が要る理由:** 本番の 1 回が `404` でも、回線A の counter の entry がすでに失効し始めていたなら、counter を共有していても 404 になりうる。`Retry-After` は、超過した rule ごとに「(件数 − 上限 + 1) 番目に古い entry が window から出るまでの時間」を求め、その最長を秒に切り上げたもの（`SEC-ABU-007`、`evaluate.lua`、`limiter.ts`）。下の前提のもとでは、対照の時点で超過している rule の件数はちょうど上限なので、これは残っている entry のうち最も古いものになる。手順 1 の B 件の entry は、手順 1 の間（`elapsed` + 1 秒未満）に記録され、ほぼ同時に失効する。counter を共有していて、本番の 1 回が entry の失効の後に admit されたとすると、対照の時点で残っている最も古い entry は手順 1 の間に記録されたものなので、対照の `retry-after` は「`elapsed` + 1」以下になる。対照の `retry-after` がそれより大きければ、本番の 1 回の時点で手順 1 の B 件がすべて window の中にあったことになる。その場合、counter を共有していれば本番の 1 回も 429 だったはずなので、本番の `404` は counter が別であることを示す。

     **前提:** この論証は、**B ≥ 2** で、かつ **`sustained_limit` ≠ `burst_limit` + 1** のときだけ成り立つ（§2.3 で読んだ値で確かめる）。B = 1 だと、残っている entry が本番の 1 回だけになり、対照の `retry-after` がそれで決まる。`sustained_limit` = `burst_limit` + 1 だと、本番の 1 回で sustained がちょうど上限に達し、対照の `retry-after` が sustained の window（60 秒）で決まる。どちらも、共有していても対照の `retry-after` が大きくなる。前提を満たさない設定では、T3 は**判定できない**ものとして記録し、担当1 に連絡する（§4.5 の合格にしない）。
  3. 61 秒後、回線B の端末だけで T2（`run_trial vary`）を行う。
  4. 61 秒後、役割を入れ替えて手順 1・2 を行う。回線B の端末が並列版（`run_parallel none`）で B+1 本送り、本番の 1 回を回線A の端末から、対照の 1 回を回線B の端末から送る。有効な試行の条件は手順 2 と同じ。
- **期待:** 手順 2 と手順 4 の本番の 1 回は `404`（429 でない。回線A と回線B が別の counter）。対照の 1 回は `429`。手順 3 は、ちょうど B+1 回目で `429`。
- **注意:** 手順 3 で 429 がいつまでも出ない場合は、回線B の送信元 IP が接続ごとに変わっている可能性（携帯回線の CGNAT）を先に疑い、別の回線でやり直す。仕様に照らした不合格と即断しない。

**T4（追記か上書きかの判定）**

- **やること:** `TRUSTED_PROXY_HOPS` を **h+1** に変え（§4.7）、Ready になるのを待ってから次を行う。
  - T4a: 回線A から、**同じ**偽の値（`203.0.113.200`）を付けて B+1 回送る（`run_trial fixed`）。
  - T4b: 61 秒後、回線A から、**毎回異なる**偽の値を付けて B+1 回送る（`run_trial vary`）。
- **期待（判定）:** T4a と T4b は、それぞれ §4.2 の規則で有効な試行であること。
  - **T4a は、どちらの型でも、1〜B 回目が `404`、B+1 回目が `429` になる**（追記型なら固定の偽の値が key になり、上書き型なら peer が key になるため）。T4a がこうならなければ（429 が出ない、B 回以内に 429 が出る）、T4 の結果は**分類できない**（例: peer が接続ごとに変わる）。
  - **追記型**（Railway などの proxy が、client の送った値の右に、自分の観測した IP を足す）なら、h+1 では偽の値が key になる。T4a は上のとおり、T4b は 429 が出ない（h+1 では偽装できる = ✗偽）。
  - **上書き型**（client の値を捨てる）なら、h+1 では要素が足りず peer が使われる。T4a と T4b は**どちらも** 1〜B 回目が `404`、B+1 回目が `429` になり（✗共）、偽の値の影響を受けない。
  - T4a と T4b が**どちらも 429 なし**の場合は、counter の働きを観測できていないので、どちらの型にも分類しない（**分類できない**）。
  - T4 は h+1 での T1〜T3 の代わりになる。追記型なら h+1 は ✗偽、上書き型なら h+1 は peer（✗共）として扱う。
- **やること（後始末）:** 判定の後、**必ず `TRUSTED_PROXY_HOPS` を h に戻して**再デプロイする。

**h−1（h が 1 以上のとき）**

- **やること:** `TRUSTED_PROXY_HOPS` を **h−1** にして T1〜T3 を行い、その後 h に戻す（戻したことの確かめ方は、上の「値の探し方と順序」の手順 3-5 と同じ）。
- **期待:** h−1 は ✓ にならない（多くの場合、T3 で回線B も 429 になる。全員が 1 つの IP に集約される）。

### 4.4 期待結果の表（仮説 × `TRUSTED_PROXY_HOPS`）

凡例:

- ✓: T1〜T3 がすべて期待どおり
- ✗共: 回線A と回線B が同じ counter を使う（T3 で回線B も 429）
- ✗偽: T2 で 429 が出ない（偽装できる）
- ✗?: peer の性質によって結果が定まらない

ここでは peer を「Railway 内部の proxy のアドレス」と仮定する。peer が全利用者で共通なら ✗共になる。接続ごとに変わるなら、T1 でも 429 が出ないことがある。

| 仮説（`X-Forwarded-For` の扱い） | HOPS=0 | HOPS=1 | HOPS=2 | HOPS=3 | T4（h+1）の結果 |
| --- | --- | --- | --- | --- | --- |
| H1: 追記、1 段（Railway の edge だけ） | ✗共 | **✓** | ✗偽（1 要素の偽装が効く。T1 は peer） | ✗偽（2 要素の偽装が効く） | 追記型 |
| H2: 追記、2 段（API host が Cloudflare の proxy を通る、または Railway の中で 2 段追記される） | ✗共 | ✗共 または ✗?（1 段目の proxy の出口 IP が key になる） | **✓** | ✗偽 | 追記型 |
| H3: 上書き（`X-Forwarded-For` = client の 1 要素） | ✗共 | **✓** | ✗共（要素が足りず peer。偽装は効かない） | ✗共 | 上書き型 |
| H3': 上書きの後に 1 段追記（`X-Forwarded-For` = client と proxy の 2 要素） | ✗共 | ✗共 または ✗? | **✓** | ✗共（要素が足りず peer） | 上書き型 |
| H4: 付けない（client の送った値をそのまま通す） | ✗共 | ✗偽（T1 は peer） | ✗偽 | ✗偽 | — |
| H5: `X-Forwarded-For` を消し、`X-Real-IP` だけを付ける | ✗共 | ✗共（常に peer） | ✗共 | ✗共 | — |
| H6: 上書き、Cloudflare の proxy を通る（`X-Forwarded-For` = Cloudflare の出口） | ✗共 | ✗共 または ✗? | ✗共 | ✗共 | — |

HOPS=0 で ✓ になるのは、peer が利用者自身の IP である場合だけで、Railway の L7 proxy の背後では考えにくい。そう観測されたら、そのまま記録する。

### 4.5 合否

- **合格:** 次の 3 つをすべて満たす。
  - 試した値のうち、T1〜T3 が ✓ になる値がちょうど 1 つ（h）ある。h+1 は T4 の結果で判定する（§4.3 の T4）。
  - h が 1 以上なら、h−1 は ✓ にならない。
  - T4a が有効な試行で、1〜B 回目が `404`、B+1 回目が `429` になり、T4b の結果で次のどちらかに分類できる。**追記型**（T4b は 429 なし）か、**上書き型**（T4b も 1〜B 回目が `404`、B+1 回目が `429`）。T4a に 429 が出ない場合（T4a と T4b がどちらも 429 なしの場合を含む）は分類できないので、合格にしない。

  記録するもの: h、追記型か上書き型か、当てはまる仮説（H1・H2・H3・H3' のどれか。どれにも当てはまらなければ観測をそのまま書く）。staging の `TRUSTED_PROXY_HOPS` は h のままにする。
- **不合格:** 次のどれか。
  - どの値も ✓ にならない（H4〜H6 のように、どの HOPS でも ✗共 か ✗偽 になる場合。H5 は Railway が `X-Forwarded-For` を付けず `X-Real-IP` だけを付ける場合）
  - ✓ になる値が 2 つ以上ある
  - T4 の結果が、追記型にも上書き型にも分類できない

- **判定できない:** T3 の前提（§4.3 の T3。B ≥ 2 かつ `sustained_limit` ≠ `burst_limit` + 1）を満たさない場合。合格にも不合格にもせず、観測を Issue #42 に記録して担当1 に連絡する。Production promotion は止めたままにする。

  不合格のときは、Production promotion を止めたまま（`INF-RLS-008`）、観測を Issue #42 に記録する。担当1 が `SEC-API-031` と `SPEC-180 §17.2` #1 の UCR 案を作り、利用者が判断する。**担当2 は仕様・実装を変えない。** staging の `TRUSTED_PROXY_HOPS` は、確認を始める前の値に戻す。

### 4.6 コマンド（bash。Git Bash でも動く）

最初に一度だけ、次を貼り付ける。表示は「回数・status・`Retry-After`」だけで、header 全体（`X-Request-Id` の値を含む）は保存しない。

```bash
set -u
: "${STAGING_API_ORIGIN:?例: export STAGING_API_ORIGIN=https://api.staging.example.com}"
: "${B:?§2.3 で求めた値を export B=<数> で設定する}"
CHECK_PATH=/ops-check/not-found
export CURL_OPTS="${CURL_OPTS:-}"   # 例: export CURL_OPTS=-4（§4.2-8）

# 偽の X-Forwarded-For（文書用のアドレスだけ）。1〜3 要素を i ごとに入れ替える。
xff_for() {
  case $(($1 % 3)) in
    1) printf '203.0.113.%s' "$1" ;;
    2) printf '198.51.100.%s, 192.0.2.%s' "$1" "$1" ;;
    0) printf '198.51.100.%s, 192.0.2.%s, 203.0.113.%s' "$1" "$1" "$1" ;;
  esac
}

# 逐次版: run_trial none|vary|fixed
run_trial() {
  mode=$1
  start=$(date +%s)
  for i in $(seq 1 $((B + 1))); do
    case "$mode" in
      none)  xff= ;;
      vary)  xff=$(xff_for "$i") ;;
      fixed) xff=203.0.113.200 ;;
    esac
    if [ -n "$xff" ]; then
      curl -sS -o /dev/null --max-time 10 $CURL_OPTS -H "X-Forwarded-For: $xff" \
        -w "$i %{http_code} retry-after=%header{retry-after}\n" "$STAGING_API_ORIGIN$CHECK_PATH"
    else
      curl -sS -o /dev/null --max-time 10 $CURL_OPTS \
        -w "$i %{http_code} retry-after=%header{retry-after}\n" "$STAGING_API_ORIGIN$CHECK_PATH"
    fi
  done
  echo "elapsed=$(( $(date +%s) - start ))s"
}

# 並列版: run_parallel none|vary|fixed。status と retry-after の組を件数で数え、最後に経過秒を表示する。
run_parallel() {
  mode=$1
  start=$(date +%s)
  for i in $(seq 1 $((B + 1))); do
    case "$mode" in
      none)  echo "$i -" ;;
      vary)  echo "$i $(xff_for "$i" | tr -d ' ')" ;;
      fixed) echo "$i 203.0.113.200" ;;
    esac
  done | xargs -P 8 -L 1 sh -c '
    # $0 = URL, $1 = 回数, $2 = 偽の値（"-" は付けない）
    if [ "$2" = "-" ]; then
      curl -sS -o /dev/null --max-time 10 $CURL_OPTS -w "%{http_code} retry-after=%header{retry-after}\n" "$0"
    else
      curl -sS -o /dev/null --max-time 10 $CURL_OPTS -H "X-Forwarded-For: $2" \
        -w "%{http_code} retry-after=%header{retry-after}\n" "$0"
    fi' "$STAGING_API_ORIGIN$CHECK_PATH" | sort | uniq -c
  echo "elapsed=$(( $(date +%s) - start ))s"
}
```

使い方の例:

```bash
run_trial none      # T1
sleep 61; run_trial vary    # T2
sleep 61; run_parallel none # T3 の手順 1（直後に回線B から本番の 1 回、続けて回線A から対照の 1 回）
```

- 逐次版の期待される出力の形（B=20 の例）: `1 404 retry-after=` から `20 404 retry-after=` までが並び、`21 429 retry-after=4`、最後に `elapsed=6s`（`burst_limit < sustained_limit` の場合。§4.2-4）。
- 並列版の期待される出力の形: `20 404 retry-after=` と `1 429 retry-after=<1 以上の整数>`（burst で拒否されたときは 10 前後）、最後に `elapsed=1s` など。
- 並列版の偽の値はカンマの後の空白を除いて送る（`198.51.100.2,192.0.2.2`）。要素の区切りはカンマなので、実装の解釈（前後の空白は除いて読む）は変わらない。

### 4.7 `TRUSTED_PROXY_HOPS` の変え方

- **やること:**
  1. Railway の画面で environment が **staging** であることを確かめてから、staging environment の api service の Variables で `TRUSTED_PROXY_HOPS` を変える。
  2. staged change を Deploy する。
  3. deployment が Active になる（deploy healthcheck の `/internal/health/ready` が 2xx を返す）まで待つ。古い deployment が止まったことも Railway の画面で確かめる（古い deployment が request を受けていると、試行の結果が混ざる）。
  4. deployment ID と、変えた値を控える。変更の前後で、§2.1 の相手に知らせる。
- **期待:** 新しい deployment が Active になり、§2.6 の 2 つのコマンドが `404` と `200` を返す。
- **合否:** そうなれば、この確認から **61 秒以上**空けてから試行に進む（§2.6 のコマンドは未一致 path に 1 回 admit されるので、すぐ始めると件数が 1 つずれる）。
- **不合格のとき:** Active にならない場合は、元の値に戻して担当1 に連絡する（`TRUSTED_PROXY_HOPS` の不正は Ready にならない: `SEC-API-030`）。

---

## 5. #45 `maxmemory` の実測と決定（staging 専用）

### 5.1 baseline

- **やること:** API が動いていて、試験の通信を送っていない状態で、`INFO memory` の `used_memory` を 3 回読み、中央値をとる。`used_memory_rss`、`used_memory_peak`、`mem_fragmentation_ratio` も記録する。
- **期待:** 数値が読める（数 MB 程度を想定）。
- **合否:** 読めれば次へ進む。
- **不合格のとき:** 値が大きく揺れる場合は、他の通信を止めて読み直す。

### 5.2 合成 key で 1 件あたりのメモリを測る

実際の counter の key は `rl:v<version>:<rule ID>:<64 桁の hex>`（version が 1 桁なら全長 83〜108 文字。rule ID の長さで変わる）、member は 36 文字の UUID、score は ms の時刻で、TTL が付いている。合成 key もこれと同じ形にする（88〜90 文字）。最長の key との差は約 18 bytes なので、安全側に k1 へ 18 を足してもよい。

**やることの前に:** 接続している container が staging の rate-limit-redis であることを確かめるため、いったん `exit` し、§3.2 の手順 1（`railway status` で staging であることを確かめる）と手順 3（`REDISCLI_AUTH` の設定）で接続し直す。

(i)〜(iii) の合否は、末尾の「後片付け」でまとめて判定する。

- prefix は `rl:` **以外**にする（例 `opscheck:`）。実際の counter と readiness の key に触れないため。
- `PEXPIRE` を 10 分付ける。削除を忘れても消える安全網になる。
- 1 回の `EVAL` は 1,000 件に分け、Redis を長く止めない。
- `FLUSHALL`・`KEYS` は使わない。

**(i) 小さい key（1 member）を 10,000 個 → 小 key 1 個あたり（k1）**

- **やること:** container 内で次を実行する。

  ```sh
  SMALL='local n, base = tonumber(ARGV[1]), tonumber(ARGV[2])
  local t = redis.call("TIME"); local now = tonumber(t[1]) * 1000
  for i = base + 1, base + n do
    local key = string.format("opscheck:v1:measure.small:%064x", i)
    redis.call("ZADD", key, now, string.format("%08x-0000-4000-8000-%012x", i, i))
    redis.call("PEXPIRE", key, 600000)
  end
  return n'
  redis-cli INFO memory | grep -E '^used_memory:'
  for b in $(seq 0 1000 9000); do redis-cli EVAL "$SMALL" 0 1000 "$b"; done
  redis-cli INFO memory | grep -E '^used_memory:'
  ```

- **期待:** `used_memory` が増える。k1 = 増えた分 ÷ 10,000（1 個あたり数百 bytes を想定）。照合として `redis-cli MEMORY USAGE opscheck:v1:measure.small:<64 桁の hex>` を 1 つ見てもよい。

**(ii) 大きい key（10,000 member）を 1 個 → 大きい sorted set の 1 member あたり（m1）**

- **やること:**

  ```sh
  LARGE='local n, base = tonumber(ARGV[1]), tonumber(ARGV[2])
  local t = redis.call("TIME"); local now = tonumber(t[1]) * 1000
  local key = string.format("opscheck:v1:measure.large:%064x", 0)
  for i = base + 1, base + n do
    redis.call("ZADD", key, now + i, string.format("%08x-0000-4000-8000-%012x", i, i))
  end
  redis.call("PEXPIRE", key, 600000)
  return n'
  redis-cli INFO memory | grep -E '^used_memory:'
  for b in $(seq 0 1000 9000); do redis-cli EVAL "$LARGE" 0 1000 "$b"; done
  redis-cli INFO memory | grep -E '^used_memory:'
  ```

- **期待:** m1 = 増えた分 ÷ 10,000（1 member あたり 100 bytes 前後を想定。要素数が多い sorted set は skiplist で表現されるため）。

**(iii) 任意: 120 member の key を 100 個**

- 要素数が少ない sorted set（listpack 表現）の 1 member あたりを測る。IP ごとの sustained の key の大きさの目安になる。§3.3 で読んだ `zset-max-listpack-entries` と一緒に記録する。
- **やること:**

  ```sh
  MID='local keys, members = tonumber(ARGV[1]), tonumber(ARGV[2])
  local t = redis.call("TIME"); local now = tonumber(t[1]) * 1000
  for k = 1, keys do
    local key = string.format("opscheck:v1:measure.mid:%064x", k)
    for i = 1, members do
      redis.call("ZADD", key, now + i, string.format("%08x-0000-4000-8000-%012x", k, i))
    end
    redis.call("PEXPIRE", key, 600000)
  end
  return keys * members'
  redis-cli INFO memory | grep -E '^used_memory:'
  redis-cli EVAL "$MID" 0 100 120
  redis-cli INFO memory | grep -E '^used_memory:'
  ```

- **期待:** listpack の 1 member あたり = 増えた分 ÷ 12,000。

**後片付け**

- **やること:**

  後片付けの**前に**、合成 key が入った状態の値を控える（§5.4 の手順 1 で使う）。

  ```sh
  redis-cli INFO memory | grep -E '^(used_memory|used_memory_rss|mem_fragmentation_ratio):'
  ```

  続けて、合成 key を消す。

  ```sh
  DEL_SMALL='for i = tonumber(ARGV[2]) + 1, tonumber(ARGV[2]) + tonumber(ARGV[1]) do
    redis.call("UNLINK", string.format("opscheck:v1:measure.small:%064x", i))
  end
  return 1'
  for b in $(seq 0 1000 9000); do redis-cli EVAL "$DEL_SMALL" 0 1000 "$b"; done
  redis-cli UNLINK "opscheck:v1:measure.large:$(printf '%064x' 0)"
  redis-cli INFO memory | grep -E '^used_memory:'
  ```

  (iii) を行った場合は、次も実行する。

  ```sh
  DEL_MID='for k = 1, tonumber(ARGV[1]) do
    redis.call("UNLINK", string.format("opscheck:v1:measure.mid:%064x", k))
  end
  return 1'
  redis-cli EVAL "$DEL_MID" 0 100
  ```

  最後に、合成 key が残っていないことを確かめる（`KEYS` は使わない）。

  ```sh
  redis-cli --scan --pattern 'opscheck:*' | head
  ```

- **期待:** 数秒のうちに `used_memory` が baseline の近くに戻る（`UNLINK` は非同期に解放する）。`--scan` の出力がない。
- **合否:** (i)〜(iii) の値（k1・m1、任意で listpack の 1 member あたり）が求まり、合成 key が残っていなければ次へ進む。
- **不合格のとき:**
  - OOM のエラーが出た場合は、仮の `maxmemory` が小さすぎる。後片付けをしてから、§3.4 の仮の値を大きくしてやり直す。
  - 値が想定（k1 は数百 bytes、m1 は 100 bytes 前後）と桁違いの場合や、他の通信で `used_memory` が揺れている場合は、後片付けをしてから測り直す。
  - 合成 key が残っている場合は、削除の script をもう一度実行する（PEXPIRE により 10 分で消えるが、待たずに消す）。

### 5.3 作業集合の見積り

1 つの rule に生きている entry の数は、おおよそ「その rule の window（+1 秒）の間に admit される request の数」になる。最悪の場合は、全 request が別の IP から来て「1 key に 1 member」になる。

**仕様で上限が決まる部分**

| 部分 | entry 数の上限 |
| --- | --- |
| `public_read`（route に一致する公開 API）: IP の burst・IP の sustained・global の 3 rule。admit は global で 10,000 / 分まで | 3 × 10,000 = 30,000 |
| `stripe_webhook`・`resend_webhook` の署名検証後の global（各 3,000 / 分） | 2 × 3,000 = 6,000 |

**仕様で上限が決まらない部分**

global の上限がないので、運営者が見込むピークから見積もる。

- 未一致 path（`public_read` の IP ごとの rule だけで、global はない: `SEC-ABU-018`）
- webhook の署名検証前の IP ごとの rule
- `auth_*`・`self_read.ip`・`staff_checkin.ip`、guard、subject、resource の各 rule

window が長い rule は entry が長く生きるので、別の項にする。

- `auth_form_proxy.identifier`（600 秒）: 下の P_auth の項。
- `role_assignment` の対象 profile（600 秒）と `high_risk_recovery` の 1 時間の rule（3,600 秒）: どちらも Administrator の操作だけで、admit は Administrator ごとの sustained の上限で抑えられる（`role_assignment` は 10 / 60 秒なので 600 秒で 100 件、`high_risk_recovery` は 6 / 60 秒なので 3,600 秒で 360 件）。そのため Administrator の人数 A を掛けた A × 460 を上限とする。

**式**

```text
E = 30,000 + 6,000 + P × r + P_auth × 10 + A × 460
バイト数 = E × max(k1, m1)
maxmemory = baseline + バイト数 × 安全係数
```

- **P**: 当日ピークの全 request 数 / 分。全 class を合わせ、未一致 path と webhook の署名検証前を含める。scan や攻撃として想定する量も含める（利用者の決定、2026-11-19）。運営者が見込む。
- **r**: 1 request あたりの rule の数（window が 60 秒以下のもの）。§68 と `packages/security/src/rate-limit/registry.ts` から数えると、例えば次のとおり。
  - `public_read`・`auth_session`・`auth_callback`・`auth_form_proxy`・webhook（署名検証前）: IP の burst と sustained で 2
  - `self_read`: IP の 1 と subject の 2 で 3
  - `staff_checkin`: IP の 1、subject の 2、QR digest の 1 で 4
  - `purchase_checkout`: subject の 2 と、distinct な resource の数（cart は最大 50）
  - token の検証に失敗した request: guard の 2 が加わる

  当日の request の内訳から加重平均をとるか、安全側に最大値をとる。値は記入欄に書き、本書では決めない。
- **P_auth**: `auth_form_proxy` の POST のピーク / 分。identifier の rule が 600 秒生きるので 10 倍にする。
- **A**: Administrator の人数。
- **安全係数**: 案は 2。
- `public_read` が P と二重に数えられるが、安全側なのでそのままにする。

| 記入欄 | 値 |
| --- | --- |
| baseline（bytes） | |
| k1（bytes / key） | |
| m1（bytes / member） | |
| P（req / 分）と、その根拠 | |
| r | |
| P_auth（req / 分） | |
| A | |
| E | |
| 安全係数 | |
| 算出した `maxmemory` | |

- **期待:** 記入欄がすべて埋まる。
- **合否:** P と安全係数は利用者が確定する（本書では値を決めない）。値が確定したら §5.4 へ進む。
- **不合格のとき:** P などが決まらなければ §5.4 に進まず、利用者の判断を待つ。それまでは §3.4 の仮の設定のままにする。ここで作業を中断する場合は、§7 の「§3.5 の合格の後、§5.4 で確定する前」の戻し先に従う。
- **注意:** 満杯になると、rate limit を通る全 request が 503 で止まる（Fail Closed: `SEC-ABU-019`、`SEC-ABU-032` (4)）。eviction で counter を消すことはしない。

### 5.4 決定と反映

- **やること:**
  1. **反映の前に**、container のメモリ上限に収まるかを確かめる。Railway の画面で、staging environment の rate-limit-redis service のメモリ上限（L）を確かめて記録し、次の見込みを計算する。

     ```text
     見込みの RSS = maxmemory × max(1, F) + R0
     ```

     - F: §5.2 の後片付けの前に控えた `mem_fragmentation_ratio`。データが少ないと大きめに出るが、安全側なのでそのまま使う。
     - R0: §5.1 の baseline の `used_memory_rss`（Redis の process そのものと、接続のバッファなどの分）。
     - `maxmemory` は `used_memory`（データの量）の上限で、RSS（container が実際に使うメモリ）の上限ではない。上限を超えた書き込みは、1 回の評価の分だけ越えることがある（`evaluate.lua` の注記）が、counter の数件分なので見込みでは無視する。

     **見込みの RSS ≤ L** なら手順 2 へ進む。超える場合は反映せず、§3.4 の仮の設定のままにして、「不合格のとき」に従う。
  2. Railway の画面で environment が **staging** であることを確かめてから、確定した値で、staging environment の rate-limit-redis の start command の `--maxmemory` を置き換えて Deploy する。
  3. §3.5 の確認（restart の後と再デプロイの後）をもう一度行う。
  4. 資料の推奨（`maxmemory` は container のメモリのおおむね半分）に沿っているかも記録する。これは仕様の基準ではなく、合否には使わない。
- **期待:** 手順 1 で見込みの RSS が L 以下。手順 3 は §3.5 の期待どおり。
- **合否:** 手順 1 を満たし、手順 3 が §3.5 の合否で合格なら §6 へ進む。
- **不合格のとき:**
  - 手順 1 で見込みの RSS が L を超える場合は、確定を保留する。noeviction で書き込みを断る前に、container がメモリ上限で終了するおそれがあるため。見込みの値を Issue #45 に記録し、service のメモリ上限を上げるか、見積り（P・安全係数）を見直すかを、運営者・担当1・利用者が決める。決まるまで、§3.4 の仮の設定のままにする（§7）。
  - 手順 3 が不合格なら、§3.5 の不合格のときと同じ。

### 5.5 監視（本書では決めない）

`used_memory` が `maxmemory` に近づいたことの監視閾値と alert は、仕様に定めがない。本書では決めず、担当1 への follow-up として Issue #45 に書く。

---

## 6. #45 満杯試験（staging 専用。**production では行わない**）

試験中は API も Redis もデプロイしない（deploy healthcheck が失敗する）。

### 6.1 前提

- **やること:**
  1. §4・§5 から **61 秒以上**空けて、counter を空にする。超過で拒否される評価は書き込みをしないので、counter が上限に達したままだと、OOM の最中でも 429 が返って判定できない。
  2. §2.1 の告知が済んでいることを確かめる。
  3. 接続している container が staging の rate-limit-redis であることを確かめるため、いったん `exit` し、§3.2 の手順 1（`railway status` で staging であることを確かめる）と手順 3（`REDISCLI_AUTH` の設定）で接続し直す。
  4. 次の値を記録する。

     ```sh
     redis-cli INFO errorstats | grep -i oom
     redis-cli INFO stats | grep -E '^evicted_keys:'
     redis-cli INFO server | grep -E '^(run_id|uptime_in_seconds):'
     ```

     `run_id` は、§6.3 で Redis が再起動していないことを確かめるために控える（Secret ではないが、記録には「同じ／違う」だけを書く）。

- **期待:** 記録できる（`errorstat_OOM` はまだない、またはその件数）。
- **合否:** 61 秒以上空き、告知済みで、staging であることを確かめ、値を記録できれば §6.2 へ進む。
- **不合格のとき:** staging であることを確かめられない場合は、何も実行せずに中断する。告知が済んでいない場合は、日時を改める。

### 6.2 満杯にする

- **やること:** 既存のテスト（TC-RLM-001-003、TC-RLM-003-003）と同じ方法で、上限を現在の使用量より小さくする。`maxmemory-policy` は `noeviction` のままにする。

  ```sh
  redis-cli CONFIG SET maxmemory 1
  redis-cli CONFIG GET maxmemory
  ```

- **期待:** `CONFIG SET` が `OK` を返す。`CONFIG GET maxmemory` が `1`。
- **合否:** そうなれば §6.3 へ進む。
- **不合格のとき:** `CONFIG SET` がエラーになる場合は、§6.5 に従う。

### 6.3 観測

- **やること:** §6.2 の直後に、次の順で行う。手順 1〜3 は、背景の probe の書き込みが混ざりにくいよう、続けて手早く行う。
  1. container 内で、OOM の件数を読む（O1）。

     ```sh
     redis-cli INFO errorstats | grep -i oom
     ```

  2. 回線A から、未一致 path に 5 回、**3 秒ずつ空けて**送る。API は store の失敗が 3 回続くと、その後 2 秒間は Redis を呼ばずに 503 を返す（短絡: `SPEC-150 REL-SEC-005`、`limiter.ts` の `DEFAULT_CIRCUIT`）。3 秒空けると、4 回目以降も 2 秒が過ぎてから送られ、試しに 1 回ずつ Redis が呼ばれるので、5 回すべてが Redis に届く。

     ```bash
     for i in 1 2 3 4 5; do curl -sS -o /dev/null -w "$i %{http_code}\n" "$STAGING_API_ORIGIN/ops-check/not-found"; sleep 3; done
     ```

  3. container 内で、もう一度 OOM の件数を読む（O2）。
  4. 回線A から、ready を 5 秒ごとに 9 回読む。

     ```bash
     for i in $(seq 1 9); do curl -sS -o /dev/null -w "$i %{http_code}\n" "$STAGING_API_ORIGIN/internal/health/ready"; sleep 5; done
     ```

     外部から到達できない構成なら、Redis 用とは**別の端末**で、§6.2 の前に §2.6.1 の手順 1 で api service の container に入っておき、その中で次を実行する。

     ```sh
     for i in $(seq 1 9); do node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/internal/health/ready").then((r) => console.log(r.status), () => console.log("error"))'; sleep 5; done
     ```

  5. container 内で、Redis が動いていて、書き込みだけを断っていることを確かめる。`SET` が成功してしまった場合は、満杯の状態になっていないので、`redis-cli UNLINK opscheck:oom-probe` で消してから「不合格のとき」に従う。

     ```sh
     redis-cli PING
     redis-cli SET opscheck:oom-probe 1 PX 60000
     redis-cli INFO stats | grep -E '^evicted_keys:'
     redis-cli INFO server | grep -E '^(run_id|uptime_in_seconds):'
     ```

- **期待:**
  - 手順 2 の 5 回がすべて **`503`**（429 でも 404 でもない: `SEC-ABU-019`、`SEC-ABU-009`）。
  - O2 の `errorstat_OOM` の件数が、O1 より **5 以上**増えている。手順 2 を 3 秒ずつ空けて送った場合、1 回の request で Redis への評価（script の実行）は 1 回で、満杯の状態ではその書き込みが OOM で断られるため。空けずに送ると、短絡で Redis に届かない request があり、5 に届かない（その場合は「判定できない」ではなく、手順 1 からやり直す）。背景の probe（短絡を通らない）の書き込みが混ざると、さらに 1 つほど増える。
  - ready が 45 秒以内に `503` になる。背景の probe（30 秒以内の間隔）が、固定の readiness key への書き込みに失敗するため。
  - 手順 5 で、`PING` が `PONG`、`SET` が `OOM command not allowed …` のエラー、`evicted_keys` が §6.1 から増えていない（`noeviction`）、`run_id` が §6.1 と同じ（Redis が再起動していない）。
  - `OBS-ALT-041` / `042` の通知が配線されていれば、発火しうる。発火したかどうかを記録する（配線の確認ではない。現状、exporter と Better Stack への配線は未実装）。
- **合否:**
  - **合格:** 上の期待がすべてそろう（`OBS-ALT-041` / `042` は合否に使わない）。503 が、Redis が動いたまま、API の書き込みを Redis が OOM で断ったことによると確かめられる。
  - **判定できない:** 次のどれかの場合は、合格にも不合格にもせず、観測をそのまま Issue #45 に記録して担当1 に連絡する。
    - `INFO errorstats` が読めない、または手順 2 を 3 秒ずつ空けて送ったのに O2 が O1 より 5 以上増えていない（API の 503 が、OOM ではない別の原因、たとえば Redis への接続の失敗によるものかもしれない）。
    - ready を外部からも内部経路（§2.6.1）からも読めない（ready の項目が観測不能）。
    - 手順 5 の `SET` が成功した（満杯の状態になっていなかった）。
  - 上のどちらでもなければ不合格とし、§6.6 に従う。
- **不合格のとき・判定できないとき:** まず §6.4 で元に戻す。不合格なら §6.6 に従う。判定できない場合は、やり直すかどうかを担当1 と決める（やり直すときは §6.1 から）。

### 6.4 元に戻す

- **やること:**

  ```sh
  redis-cli CONFIG SET maxmemory <§5.4 で確定した値>
  redis-cli CONFIG GET maxmemory
  ```

  `CONFIG SET` の代わりに、Railway の画面で environment が **staging** であることを確かめてから、staging environment の rate-limit-redis を restart して、start command の値に戻してもよい。
- **期待:** `CONFIG GET maxmemory` が start command の値（§5.4 の確定値）と一致する（**1 のまま残さない**）。45 秒以内に、未一致 path が `404`、ready が `200` に戻る（ready が外部から到達できなければ §2.6.1 の内部経路で確かめる）。
- **合否:** 戻れば §7 へ進む。
- **不合格のとき:** 戻らない場合は、Railway の画面で environment が **staging** であることを確かめてから、staging environment の rate-limit-redis を restart し、§3.5 と §3.6 を行う。

### 6.5 `CONFIG SET` が使えない場合

`CONFIG` が使えない構成は §3.3 で中断しているので、ここに来るのは、§3.3〜§5.4 で `CONFIG GET` は使えたのに、§6.2 の `CONFIG SET` だけがエラーになった場合である。

- **やること:** 満杯試験を行わずに中断する。`CONFIG GET maxmemory` が §5.4 の確定値のままであることを確かめ、エラーの内容（Secret を含まない部分）を Issue #45 に記録して、担当1 に連絡する。start command を小さい `maxmemory` に変えて満杯にする方法などの代わりの手順は、本書では行わない（戻し先の管理が増え、確定値の確認をやり直すことになるため）。続け方は担当1 と利用者が決める。
- **期待:** `CONFIG GET maxmemory` が確定値。
- **合否:** 満杯試験は「判定できない」として記録する。#45 の満杯試験の項目は未了のままになる。
- **不合格のとき:** `CONFIG GET maxmemory` が確定値でなければ、§6.4 の「不合格のとき」と同じく restart し、§3.5 と §3.6 を行う。

### 6.6 不合格のとき

次のどれかが起きたら不合格とする。

- OOM の最中なのに（O2 が O1 より 5 以上増え、手順 5 の `SET` が OOM で断られているのに）、未一致 path が 429 か 404 のまま
- 同じく OOM の最中なのに、ready が 200 のまま
- `evicted_keys` が増える
- `PING` が返らない、または `run_id` が変わった（満杯で Redis が止まった、または再起動した）

不合格のときは、**すぐに §6.4 で元に戻す。** そのうえで Production promotion を止めたまま観測を Issue #45 に記録し、担当1 に連絡する（実装か構成が仕様と食い違っている疑い）。

---

## 7. 後片付け（中断したときも必ず行う）

**Redis の設定の戻し先**は、どこまで進んだかで決まる。§3.3 の「元の設定」と §3.4 の「仮の設定」は、記録に控えてある。

| 中断した時点 | 戻し先（start command と `maxmemory`） |
| --- | --- |
| §3.4 より前（§3.3 で中断した場合を含む） | 何も変えていないので、そのまま（元の設定） |
| §3.4 の後、§3.5 が合格する前 | 元の設定。ただし §3.1 で Volume を外した場合は、Volume を指す引数（`--dir` など）を除く（外した Volume を指したままだと起動に失敗しうるため。§3.4 を参照）。§3.4・§3.5 の不合格のときも同じ |
| §3.5 の合格の後、§5.4 で確定する前（§5.3 で P などを待つ間、§5.4 の手順 1 で保留した場合を含む） | 仮の設定。元の設定には戻さない（仮の設定は `noeviction` と永続化なしを満たし、§3.5 で残ることを確かめてあるため） |
| §5.4 で確定した後（§6 の最中を含む） | §5.4 の確定値 |

- [ ] `TRUSTED_PROXY_HOPS` が h（合格時）か、確認前の値（不合格時）になっている。Variables の値が h（または確認前の値）で、staged change が残っておらず、Active な deployment が最後の §4.7 の Deploy で作られたもの（控えた ID）と一致することで確かめた。
- [ ] start command が、上の表の戻し先になっている。`CONFIG GET maxmemory` がその bytes の値と一致する（1 のままではない）。戻し先が仮の設定か確定値なら、`maxmemory-policy` が `noeviction`。戻し先がどれかを記録した。
- [ ] 合成 key（`opscheck:`）が残っていない（`redis-cli --scan --pattern 'opscheck:*' | head` の出力がない。`KEYS` は使わない）。
- [ ] rate-limit-redis に TCP Proxy・Public Access・public domain が付いていない。
- [ ] ready が `200`、未一致 path が `404`。
- [ ] §2.1 の相手に、終わったことを知らせた。

満たされない項目があれば、該当する節に戻って直す。`TRUSTED_PROXY_HOPS` は §4.7、start command と `maxmemory` は、元の設定か仮の設定なら §3.4（控えた start command にして Deploy し、§3.5 の確認を行う）、確定値なら §5.4 の手順 2・3 と §6.4、合成 key は §5.2 の後片付け、TCP Proxy などは §3.1、ready と未一致 path は §3.6。

---

## 8. 記録（各 Issue へのコメント。運用記録）

`SPEC-180 §17.2` の「確認結果を本書または運用記録へ反映する」の運用記録として、担当2 が #42・#45 にコメントで記録する。`SPEC-180 §17.2` の表への反映（確認済みの事実の記載と SemVer）は、担当1 が別の仕様 PR で行う。本書では仕様を変えない。

**記録してよい値**

- 日付（UTC）
- API の commit SHA と deployment ID
- `TRUSTED_PROXY_HOPS` の値
- 追記型か上書き型か（または不合格の観測）と、当てはまる仮説（H1〜H6、H3'）
- B、`burst_limit`、`sustained_limit`
- 各試行の status の並びと経過秒（例 `404×20, 429×1, retry-after=4, elapsed=6s`）
- 回線A と回線B の IP が「異なる」こと
- staging と production の構成が同じかどうか
- start command のうち Secret でない引数
- `CONFIG GET` と `INFO` の値
- k1・m1、見積りの式・P・r・P_auth・安全係数
- 決めた `maxmemory`、service のメモリ上限
- 満杯試験の観測（status、ready が変わるまでの秒数、OOM の件数、`evicted_keys`）
- 資料と実機の差

**書かない値**

- IP アドレス（自分の回線、peer、Railway 内部のアドレスを含む）
- 本システムの実際のホスト名
- Secret、password、接続文字列、Access の service token
- counter key 名
- `X-Request-Id` の値（記録する必要がない）
- Redis の `run_id` の値（§6.1 と §6.3 で同じかどうかだけを書く）

### 8.1 #42 のテンプレート

```markdown
## staging での確認結果（#42）

- 日付（UTC）:
- API の commit SHA / deployment ID:
- 実施者: 担当2
- 構成（staging / production）: Cloudflare proxy の有無 = / Access の有無 = / Railway の custom domain と region = / 同じか =
- 回線: 回線A と回線B のグローバル IP は異なる（値は記録しない）
- RATE_LIMIT_CONFIG.public_read: burst_limit = / sustained_limit = / B =

| TRUSTED_PROXY_HOPS | 試行 | 回線 | status の並び（retry-after、elapsed） | 期待どおりか |
| --- | --- | --- | --- | --- |
| | T1 | A | | |
| | T2 | A | | |
| | T3-1・2 | A（並列、elapsed）→ B（本番）→ A（対照、retry-after） | | |
| | T3-3 | B | | |
| | T3-4 | B（並列、elapsed）→ A（本番）→ B（対照、retry-after） | | |
| h+1 = | T4a | A | | |
| h+1 = | T4b | A | | |
| h−1 = | T1〜T3 | | | |

- 判定: 合格 / 不合格 / 判定できない（理由: ）
- 決めた TRUSTED_PROXY_HOPS（staging）:
- X-Forwarded-For の扱い: 追記型 / 上書き型 / 分類できない（仮説 H?）
- production の T1〜T3: 実施 / 未実施（理由: ）
- 資料（specs-and-limits の Request Headers）との差:
- 後片付け（§7）: 済
```

### 8.2 #45 のテンプレート

```markdown
## staging での確認結果（#45）

- 日付（UTC）:
- rate-limit-redis の deployment ID（設定後 / restart 後 / 再デプロイ後）:
- 実施者: 担当2
- 構成（INF-RLS-001/002/003/005）: service 1 つ / public domain・TCP Proxy・Public Access なし / Volume なし / replicas 1 / worker から参照なし
- 接続方法: railway ssh（保守のための一時的な接続。TCP Proxy なし）
- 元の設定（§3.3。start command の Secret 以外の引数 / maxmemory）:
- 仮の設定（§3.4）: --maxmemory … --maxmemory-policy noeviction --save "" --appendonly no

| 時点 | maxmemory | maxmemory-policy | save | appendonly | evicted_keys |
| --- | --- | --- | --- | --- | --- |
| 設定後 | | | | | |
| restart 後 | | | | | |
| 再デプロイ後 | | | | | |

- 実測: baseline = / k1 = / m1 = / （任意）listpack の 1 member あたり = / zset-max-listpack-entries =
- 見積り: P = （根拠: ） / r = / P_auth = / E = / 安全係数 =
- 決めた maxmemory: / service のメモリ上限 L: / F（mem_fragmentation_ratio、§5.2 の後片付けの前）: / R0（baseline の used_memory_rss）: / 見込みの RSS: / L 以下か:
- 満杯試験: 未一致 path（5 回） = / OOM の件数の増加（O2 − O1） = / ready が 503 になるまで = 秒（外部 / 内部経路 / 観測不能） / PING = / SET opscheck:oom-probe = / run_id = 同じ・違う / evicted_keys の増加 = / 戻した後の ready が 200 になるまで = 秒 / alert の発火 =
- 判定: 合格 / 不合格 / 判定できない（理由: ）
- 後片付けの戻し先（§7 の表）: 元の設定 / 仮の設定 / 確定値
- follow-up（担当1）: used_memory の監視閾値と alert（仕様に定めがない）
- 資料との差:
- 後片付け（§7）: 済
```

---

## 9. 不合格・中断のときの扱い（まとめ）

- どの不合格でも、**Production promotion を止めたまま**にする（`INF-RLS-008`）。観測を Issue に記録し、担当1 が UCR 案（`SPEC-000 §15.2` 形式）を作り、利用者が判断する。
- staging の設定は、`TRUSTED_PROXY_HOPS` は確認前の値に、Redis の start command と `maxmemory` は §7 の表の戻し先に戻す。
- 担当2 は仕様・実装を変えない。仕様にない endpoint やログを足して確かめることもしない。

## 10. 根拠（手順 ↔ 仕様 ↔ 実装）

| 手順 | 仕様 | 実装 |
| --- | --- | --- |
| 未一致 path を `public_read` の IP の rule だけで評価し、404 / 405 にする | `SEC-ABU-018`、`SPEC-110 §56.1` | `apps/api/src/api/rate-limit.ts`（段階1 の `unmatched`）、`packages/security/src/rate-limit/limiter.ts`、`apps/api/src/api/app.ts`（`notFound`） |
| `X-Forwarded-For` の右から N 番目。それ以外は peer | `SEC-API-030`、`SEC-API-031`、`SPEC-180 §28.2` | `packages/security/src/rate-limit/client-ip.ts` |
| IPv6 は /64、IPv4-mapped は IPv4 | `SEC-API-032` | `packages/security/src/rate-limit/keys.ts`（`normalizeIp`） |
| 429 と整数の `Retry-After`。429 と 503 を区別する | `SEC-ABU-007`、`SEC-ABU-009` | `apps/api/src/api/app.ts`（`failure`） |
| sliding window log。拒否された評価は記録しない | `SEC-ABU-012`、`SEC-ABU-013` | `packages/rate-limit-redis/src/evaluate.lua` |
| store に書けなければ 503 | `SEC-ABU-019`、`INF-RLS-004` | `evaluate.lua`（メモリ上限の注記）、`packages/rate-limit-redis/src/store.ts` |
| readiness は書き込みを伴い、30 秒以内の間隔の背景 probe で更新する | `INF-HLT-004`、`INF-HLT-005` | `store.ts`（`assertReady`）、`apps/api/src/api/readiness-probe.ts` |
| Redis の配置・永続化なし・replicas 1 | `INF-RLS-001`〜`INF-RLS-005` | `docs/backend-foundation.md`（共有 Rate Limit の節） |
| 外部事実の確認と Production promotion の条件 | `SPEC-180 §17.2` #1・#4、`INF-RLS-008` | — |

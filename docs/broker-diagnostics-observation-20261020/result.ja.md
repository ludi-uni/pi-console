# 診断変更の適用と1回観測 — broker広告欠落を確認

本人承認 Sentinel_b89a7b207d24819183fb9311b0bc388b に基づき、pi-consoleの診断候補だけをDへ適用した。VTSを含む他アプリの起動/終了、PC再起動は一切行っていない。

## 適用・保全

候補sealとpublic source139ファイルを照合し競合0。公開helperの変更前sourceを作業Tempのsource-beforeへ保全した。適用したのは候補と同じbytesの次の2ファイルのみ。

- package/managed-resume-broker.mjs（安全な診断reason/HTTP statusの追加）
- tests/local-resume/broker-diagnostic.test.mjs（回帰）

反映後のD sourceでも新規診断36件 + 既存stdio3件、**39/39 PASS、失敗0**。全てfake IO/memory/dummy providerで、これらの試験から実helper・資格処理・OS暗号・実HTTPは呼んでいない。

最終source140ファイルは期待hash一致。元のbaseline139のうちhelper1だけを変更し、その他138は不変、新規回帰1を追加。dist37ファイルと既存Codex設定hashも不変。保護state/owner設定/workspaces/lock/管理state/tokenの既知10項目は、存在・size・mtime・file identityが前後一致した。秘密本文の手動取得/復号/コピーなし。正規管理helperが既存管理tokenを内部利用したが、値は保存/出力していない。

開始時の正規管理statusはPID43932 / startedAt=2026-10-20T01:16:33.010Z / 127.0.0.1:31717 / version0.5.2。新しいNode processで更新済み診断helperを読み込めるため、**Consoleの再起動は不要で0回**。管理status事前確認1回と、下記のbroker失敗理由観測1回を区別して記録した。

## 1回だけの実観測

2026-10-20 **03:10:30.955–03:10:30.963 UTC**（JST12:10:30）。新しいNode processで既存server-managerのmanagedResumeBrokerを呼び、GET管理identityだけを利用した。呼出直前にattempts=1のjournalを排他的に作成し、同じscriptが再実行されても2回目を送信できないようにした。

| 項目 | 観測値 |
| --- | --- |
| outcome | refused |
| 固定理由 | **broker_not_advertised** |
| HTTP status | **200** |
| broker診断観測数 | **1** |
| fallback / retry / MCP call | **0 / 0 / 0** |

raw response・例外本文/stack・descriptor・token/proof/cookie・資格・保護stateはlogしていない。成功時でもverifiedという固定outcomeだけで終了するscriptであり、接続/資格更新へ進む処理はない。

## 今回確定した原因と残る不明点

**helperが今回拒否した直接原因は、検証済みのidentity応答にresumeBrokerが含まれていないこと。** HTTP200を受け、service/PID/開始時刻/nonce/identity proofを同じ順序で通過した後の!bで拒否された。通信失敗、identity署名不一致、broker port/署名の検証失敗、fcf grant/scope拒否、Codex MCP RPC拒否と混同しない。

一方、広告がない内部理由を示すserver flagは応答にない。sourceではresume有効かつ本人用listenerのportがある場合だけ広告する。再起動でport=nullになり、owner-login issueか認証済みSettings startでのみ開く構造、再起動後それらを実行していない保存記録と合わせると、**再起動後のlistener未開設が有力な説明**である。OFF/終了途中等との内部分岐を直接測ったとは報告しない。追加の状態取得や拒否helperの再試行はしていない。

## 次の最小修正案（未実装・未適用）

**本人のブラウザーloginと、既に承認済みclientが使うbrokerの開始を分ける。** 現在のGET identityをread-onlyに保ち、既存の管理証明を使う明示的なPOSTで、既存MCPモードが有効な場合だけloopback brokerをオンデマンド開始する案を推奨する。

- 専用HMAC文脈・現在nonce・requestId、literal127/Host/proxy排除を検証する。既存の保護された管理helper内で処理し、人にキーを作らせたりcode/cookieを渡させたりしない。
- この操作はlistenerと署名付きdescriptorだけを扱う。owner bootstrap code/cookie、MCP用途別資格、grantを発行・更新しない。GET identityやclient初期化/catalog表示だけでは開始しない。
- 二重要求・応答喪失では同じrequestIdの開始結果を照合し、別listenerを増やさない。OFFや不正証明は拒否したまま。本人の新規許可・scope変更・解除は既存の本人確認を残す。

ただしbroker開始だけで全接続restoreへ進めてはいけない。既にコードで確定した**全family先行復元**を、read-only load→private proofの検証→対象1familyだけのbind/renewに分ける修正は別に必要。別接続の資格/epoch/receipt/scope/期限/runtimeは不変とする。この2点の次候補は、通常の本人再ログインを繰り返させる回避策より小さく明確な境界を持つ。

さらに、fcfの元の初回申請期限は **2026-10-20T01:26:54.443Z** で、今回の観測時には過ぎている。7日grantの未来期限とは別。clientに承認済み継続材料が未保存なら、brokerが開くだけで元申請を復活できない。generationや元期限を無視して秘密を再配布したり、新grantを勝手に作ったりしない。現在のfcfの接続成功までを、このbroker修正だけで保証しない。

## 今回の操作数・証拠

適用1実装 + 1回帰、反映後dummy39件、broker診断観測1回（別に管理status確認1回）。資格/認証状態の更新0、権限/期限変更0、全接続復元0、新規申請0、実MCP接続0、実作成0、owner-login0、Console/PC再起動0、他アプリ終了/起動0。画像0、UI操作0、本人への追加質問0。pi-warden、commit/push/publishなし。

証拠: before.json、application.json、installed-acceptance.tap、observation.json、verification.json。作業rootは `C:\Users\leade\AppData\Local\Temp\pi-console-broker-diagnostic-apply-20261020-6e84`。元の隔離候補 `docs/broker-diagnostics-candidate-20261020` は封印のまま保持した。

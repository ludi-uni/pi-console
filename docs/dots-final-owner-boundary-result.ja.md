# Dots final owner boundary result

## Status

**blocked、実装拡張前に停止。** requested owner review/allow/revoke UI、保存契約、通常server mount、同一構成producer結線、UI→実binary→解除拒否の縦断は未実装・未検証。既定OFF・実運用未反映を維持する。停止条件として指定された「宛先connectorとnative credentialの結び付きを現契約で保証不能」が該当した。

`D:\Develop\pi-console`、環境の `PI_PROVIDER=openai-codex / PI_MODEL=gpt-6.1-sol` を確認。先行fleet0。新subagentなし。前回contract/result/verificationを確認し、保存された98項目のhashを照合した。今回保全対象はverification自身を加えた99 file。

## Blockers

### connector_credential_binding_unverified

これは今回の判断点を表す識別子であり、新HTTP errorを実装したという意味ではない。

- `server/final-answer-mcp.ts` の有効化契約は `authentication:{mode:shared_secret,key}` のみ。dedicated native read-keyの所持を検証するが、connector ID / credential ID / 配布先を認証principalとして返さない。
- `shared/results-read.ts` のexact target/feature/expiry grant、`shared/workspace-permissions.ts` のworkspace/session permissionにはconnector bindingがない。`server/shared/web` 内のconnector ID / credential ID / tunnel ID検索でも、既存connector registryや権限内connector inventoryを確認できなかった。`server/integrations.ts` と `shared/integrations.ts` は存在しない。
- 通常serverの設定もreadonly authenticationとcontrol keyまで。稼働profile・キー・接続を読むことは承認外なので、その先の実構成を推測しない。
- JSON-RPCのclientInfoや新たなcaller-supplied connector header/名称は自己申告であり、配布先の証明にはならない。fixtureだけの対応表を作り、それをproductionの既存対応であるかのようには扱わない。

`tests/final-owner-boundary.test.ts` は実SDK public SessionManagerでTemp dummy回答を保存し、既存runtime/journal/core/authenticated adapterを通す。同一dummy key・同一許可targetで `clientInfo.name` をA/Bと名乗り替えた両HTTP要求が同じ最終回答を受信することを確認した。これは二つの本物のconnectorへの漏洩証明ではなく、**現在のadapterが自己申告connector名を認証していない**というcharacterization。実grant/実key/実接続は使っていない。

この状態では「宛先=connector 1件」と表示して許可・保存する意味を保証できない。既存status-only read checkboxを本文公開へ拡張せず、許可UI/mountを追加しなかった。

### access_owner_route_incompatible

- `server/index.ts` はowner APIより前に `allowedHost(...,access)` とAccess verifierを通す。
- `server/access.ts` のAccess構成はpublic Hostだけを許す。
- `server/dots-permissions-api.ts` の `permissionOwnerRequest()` はliteral `127.0.0.1:port` Host、HTTP同一Origin、native socket、no proxy/CF headersだけを許す。
- dummy Access構成のgate関数試験で、literal Hostはowner gate=true/public Host gate=false、public Hostはpublic gate=true/owner gate=false。既存経路の両条件を満たすHostがない。

JWT検証/JWKS取得/実Access接続はしていない。local default構成のowner gate通過はnative管理境界の確認に留まり、OS本人認証の証明ではない。management routeへの流用、gate順序変更、header例外、localhost経由の別経路回避、新認証方式を導入しなかった。

## Evidence

- 新規characterization **2 PASS**。UI同意経路のacceptanceではない。HTTP試験はdynamic loopback、専用Temp/dummy lifecycle/authのみ。読取によるworker mutation0、終了後fixture/Tempを削除。
- `tsc --noEmit` 最終exit0。最初のテスト用IncomingMessage castの型エラーを明示的な `unknown` castに修正した。runtimeロジックの変更なし。
- 先行65 unique PASS / pin実binary5 call・154 UTF-8 bytes hash一致の証拠は保全したが、今回のUI縦断合格には流用しない。
- production/UI sourceは変更なし。desktop/mobile、取消・保存中移動・応答喪失・再読取・失効のUI試験、実binary再実行、別出力buildは、停止条件により未実施。正常に動くowner UIを作れたとの主張をしない。
- 今回差分はこの報告、preservation/verification、characterization testだけ。既存99 file byte一致、stagedなし。詳細は `docs/dots-final-owner-boundary-verification.json`。

## Decision

承認が必要な候補は狭く二つ。まだ選択・実装・実設定変更していない。

1. **native構成限定**: 本人管理された既存connectorと既存専用read credentialの対応を、serverがどの既存の信頼済み情報源から受け取るかを定義する最小binding契約。情報源、未観測/曖昧時拒否、credential変更/解除時の失効を決める。自己申告名称、任意URL、キー入力、黙った対応推定は不可。現ソースにはその情報源がないため、今は実装不可。
2. **Accessを対象に含める場合**: public Host/verified Access ownerと既存native owner gateのどちらをowner管理契約として採用するかを別承認で設計する。今回の範囲では例外を加えず、Accessでのowner同意はblockedのまま。汎用auth brokerやOS隔離を新設する提案ではない。

## Owner operation

新しい最終回答許可画面は存在しないため、実行可能な画面手順はまだ提示できない。既存「設定 → Dots ワークスペース権限」のread checkboxは、最終回答本文の許可ではない。本人にキー/URL/報告本文を入力・貼付させる代替手順を案内しない。

binding判断後の運用前確認は以下に限定する。

- exactrun: 既存workspace/session/generation内の観測済みrun 1件。
- 公開text: 保存・foreground terminal・受付ACKを確認した最終回答textのみ。prompt/tool raw/他の会話/全履歴/artifactは対象外。
- connector: 信頼済み情報源で既存native credentialとの対応を確認できた既存connector 1件。
- 期限: 本人が選ぶ絶対expiry。期限経過/変更/解除/restartで不確定な許可を復活させない。
- 配布反映: 既定OFFのsource準備と、実配布・実grant/接続/本番適用を別々の承認にする。今回はどちらも新たに有効化していない。

同一SIDによるowner管理資源変更リスクは未解消。`controlIsolationVerified()`・制御/更新拒否をfalse→trueへ切替えていない。実履歴/data/秘密、grant、キー、plugin、接続、本番、OS/ACL/account/network/sandboxを変更せず、commit/push/publication/install/download/Events利用を行っていない。

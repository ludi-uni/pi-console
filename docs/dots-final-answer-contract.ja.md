# Dots final answer read contract

## Scope

`read_final_answer` だけを公開する明示opt-in factory `createFinalAnswerMcp()` を追加した。通常の `server/index.ts` には未登録。旧 `/mcp/readonly`、owner/control APIへの登録・fallbackはない。他のresults-read機能、artifact、全履歴、新workspaceへの公開を含まない。

本体は `ResultsReadService.finalAnswer()`。既存status-only permissionでは本文を公開しない。service有効化と、`ResultTarget {instance,revision,workspaceId,sessionId,generation,runId}` 全項目一致、feature `final_answer`、未経過の `expiresAt` が必要。既存 `WorkspacePermissions.admit()` のinstance/revision/CAS・session/generation・解除直列化・canonical workspace検証を再利用する。全I/O後にgeneration/expiry/foreground terminalを同期再確認する。

## Producer

`RuntimeManager` の第五引数 `finalAnswerDirectory` は省略時無効。明示設定時だけSDK workerへ `--final-answer-evidence` を渡す。SDK 1.0.2のみ確認済みで、他のSDKはこのopt-inを拒否する。通常のSDK対応範囲は変更しない。

`package/final-answer-evidence.mjs` は次を同時に要求する。

- Console run IDを持つ `started` preflight時のSDK session ID/file/cwd/active leafを固定する。
- `message_end` のassistant、`stopReason: stop`、toolCallなしのtextのみ候補。thinking/user/toolResultは本文に含めない。
- public `message_end` はSDK保存前に届くため、それだけでは公開しない。`agent_settled` 時にSDK保存JSONLの新しいactive branchを読み、候補message全体のhash、session header、開始leafまでの確実な親鎖を検証する。
- fileは8 MiB/10,000行以内、通常file・linkなし・hardlinkなし・canonical identity一致・読取前後のstat一致を要求。末尾未完、欠落、branch/compaction変更、非final stopは本文を公開しない。
- SDK保存を確認したproofは通常のhistory/statusイベントへ流さず、runtime専用journalへ入れる。journalはruntime instance/workspace/session/generation/runで名前空間分離したprivate JSON、sync＋rename、メモリ保持seal、再読取hash/identity検証を行う。
- 本文公開にはjournal保存、Consoleの受付ACK確認、当該foreground `completed` の三つが必要。ACK不明は本文なし。後から正しいACKを観測しても再実行しない。

最終回答はUTF-8で最大65,536 bytes。超過は `too_large` で本文なし。journalの保持は当該runtime instance内の最大256 run。再起動後のjournal探索・旧session hydration・run推測は行わない。保存が進行中/欠落/不確定なら `saving` / `missing` / `unknown` 等と `readable:false,text:null` を返す。

## Adapter

`createFinalAnswerMcp(service,{enabled:true,authentication:{mode:'shared_secret',key}})` は専用64桁lowercase hex read-keyを要求する。キーがserviceのknown-secret除外一覧に含まれなければ構築拒否。キーを設定/file/envから自動発見しない。既定OFFは構築時に固定する。

- header `x-pi-console-dots-read-key`、exactly one、固定長constant-time比較。
- 既存native literal-loopback Host/socket、Origin/Fetch Metadata、Authorization/Cookie/proxy header拒否を緩和しない。重複Hostも拒否。
- `/mcp/dots` のmodern `2026-07-28` JSON-RPC、整合するprotocol/method/name header、JSON＋SSE Acceptだけ。empty POST/GET/metadata/legacy/notification/control/ownerは成功扱いしない。
- `server/discover`、`tools/list`、`tools/call read_final_answer` だけ。tools catalogは1件。control/OAuth/Events/resourcesを広告しない。
- 入力はexact targetとoptional `cursor` / `limit`。HTTP body上限32 KiB、同時4件、body受信deadline 5秒。本文chunkは最大8,192 bytes、既定4,096。

## Response

通常のtool JSONで `structuredContent` とserialized textを返す。`text` はUTF-8境界で分割し、`byteOffset,bytes,totalBytes,sha256,version,nextCursor,eof` を付ける。clientは順に結合し、全体UTF-8 bytesのSHA256を検証する。cursorはexact target＋purpose＋公開本文version＋位置のHMAC。再送は同じchunk、改竄/異なるtarget/履歴用cursor/旧service cursorは拒否する。

known secretsは**本文全体を処理してから**分割するのでページ境界では漏らさない。変換時のhashは公開された本文のhash。既知secret除外は万能な機密検出ではない。すべて `trust:untrusted_data,instructions:false`。

`foregroundFinalConfirmed:true` は選択runの保存済み回答＋foreground terminal＋ACKの確認であり、全体完了ではない。`aggregateCompletionConfirmed:false,aggregateCoverage:incomplete` は常に維持する。明示親関係で観測できたchild継続は `relatedChildrenActive` / `overallState:running`。他はoverall unknown。`snapshotLive:false` は切断/cached観測を区別する。OS全体のidle、子の完全census、実model使用を推定しない。

## Owner operation

現在のGUIはこの追加featureを承認・保存するUIではない。既存read/control checkboxだけでは有効化されない。実運用を行う前に、別途承認された実装/設定で以下を本人に確認する必要がある。

1. 対象: 既存workspaceのsession/generation内の **exact run 1件**。
2. データ: そのrunの保存済み最終回答textのみ。履歴全体/path/artifact/他workspaceは含まない。
3. 宛先: 本人が選んだ既存Dots connector/tunnel 1件。専用read-keyをその宛先だけへ渡す。
4. 期間: 本人が選んだ絶対expiry。今回fixtureは60秒、real permission保存なし。

maintainer側には通常serverへの明示mount、private stable journal directory、feature grant/認証のowner同意経路の結線が残る。未解決のowner authentication/public Host gate・同一OSユーザーによるowner resource変更リスクを解消したとの主張はしない。native guardに合わない実ingressを例外で通さない。worker isolationはfalse、制御と更新の既存拒否は維持する。

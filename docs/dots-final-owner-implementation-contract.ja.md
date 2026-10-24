# Dots final owner implementation contract

## Scope

`dots-final-owner-keyholder-design.ja.md` に従うfinal-only実装。宛先は専用read-key所持者であり、connector/clientInfo/端末/OS本人の認証ではない。同じキーを別接続へ渡せばそこからも読める。送信済みbytesは回収できない。既存status read/control許可はbase条件のみで、本文許可を暗黙に含めない。実運用の包括的リスク受容は含まない。

## Composition

`createFinalOwnerComposition()` はWorkspaceStore・WorkspacePermissions・既存runtime pathsと明示構成を受け取り、同じRuntimeManager、producer/journal、ResultsReadService、final-only MCP adapter、owner APIを結線する。通常 `server/index.ts` と隔離fixtureが同じfactoryを使用する。

bootstrapはliteral `enabled:false`、credential未設定。新しいenv/file discovery、キーUI入力、設定を勝手にOFFにする処理はない。後日の承認済み構成注入を除き有効化できない。起動時の構成だけを固定する。以下が不明/不成立ならproducer directoryを渡さず、final modeはblocked/404、旧adapterへのfallbackなし。

- 明示opt-in、Access未有効と確認した `accessMode:local`。
- 専用64桁lowercase hex read-key、既存status/control credentialとの分離を確認できる構成情報。
- private stable journal directory（software prefixと分離する運用設定は別承認）。

`access` / `unknown` はblocked。既存native Host/socket/Origin/Fetch/proxy拒否は維持する。owner APIは通常serverの既存public Host/Access gateを通った後、既存 `permissionOwnerRequest()` も要求する。manage routeや別listenerへの回避なし。Access本人管理は実装しない。

final modeでは `/mcp/dots` とそのprotected-resource absence aliasesをfinal adapterが担当する。共通 `/.well-known/oauth-protected-resource` の404/認証もfinal mode側で扱い、旧readonly keyによる先取りを避ける。namespaced `/mcp/readonly` / `/.well-known/oauth-protected-resource/mcp/readonly` は旧独立handlerのまま。gateを緩和する例外ではなく、明示modeのnamespace担当順序である。既定OFFなら旧routingを維持する。

## Persistence

WorkspacePermissionsの同一lock/CAS/atomic writeを使うversion 2 snapshot。旧version 1はfinal grantなしで読み、自動migration書込しない。

- `finalPublication`: nullまたはexact target、feature `final_answer`、絶対expiry、非秘密でキー非派生のcredentialEpoch、保存request ID。最大1件。
- `finalRequests`: 有界64件のrequest ID/instance/epoch/action/commit revision。本文/秘密/キーhashは保存しない。capacity到達は拒否し、古い結果を消して再送可能にはしない。
- base workspace/session scopeは変更しない。追加grant commitはrevisionを進め、targetをそのrevisionへ束縛。置換は旧一件の解除をreviewへ表示する。base permission編集は追加公開をclearする。

epochはactivationごとのUUIDで、UI/log/catalogには出さない。同じキーでもrestart/再activationは旧record・reviewを無効化する。キー変更/削除/不明は旧composition dispose＋新compositionとし、hot rotation/旧grant移植なし。単なるgrant解除はキー自体の失効とは別。

保存失敗は既存storeのpoison/tombstoneでfail closed。自動回復/lock回収なし。CAS/lock競合による未commit拒否と、atomic保存失敗による公開停止を区別する。既にadmitしたreadは直列化境界に従い、解除完了後の新readは拒否する。

## Owner API

`/api/workspace-permissions/final/{session,review,cancel,save,result}` のJSON POST。既存local owner boundaryとexact headersが必須。キー/URL/callbackは受け取らない。

- session: base scope内の登録済み・一意・live・非truncated・観測済みgenerationで、保存/ACK/foreground terminal確認済みPi runだけ。最大64候補。本文、prompt/tool raw、model、他の会話を返さない。旧epochのrecordはactiveにしない。
- review: exact target/instance/revision/絶対expiry（future、最大24時間）、旧公開の解除を固定する。1分の一回限りreview、UUID request IDを返す。解除はtarget/expiry=null。
- cancel: 未送信review capabilityを無効化する。commitのundoではない。
- save: review/request一致・明示confirmedを要求。一回だけconsumeして同じCAS/lock内で対象/期限/epochを再検証する。
- result: request IDの保存結果照合と現在stateだけ。未知/pending/committed/committed_inactiveを区別し、再実行しない。repeat saveは拒否。

UIの保存中離脱/応答喪失は成功・取消と決めつけない。sessionStorageにopaque request UUIDだけを残し、復帰時にresultを読む。保持できなければ未送信で停止する。readonly session/resultのpermission_busyだけ最大3回・80 msで再読取でき、review/save/cancelの自動再送はしない。

## Read

入場と全I/O後にbase permission、instance/revision、exact run/session/generation、active epoch、expiryを検証し、foreground変更も確認する。既存署名cursor/UTF-8 paging/公開本文hash/untrusted_data契約を継承。final/status/controlの既知credentialを全本文上でmaskしてから分割し、IDに含まれるknown secretは拒否/非表示。未知機密の万能検出は保証しない。

tools catalogはfinal-only一件。認証済みで現在有効・観測確認できたgrantについて、inputSchemaのconstからexact targetを取得できる。報告本文やtargetを人に貼り直させる必要は隔離経路ではなかった。失効/無許可時はconstを付与しない。実Dotsのcatalog利用/自動tool選択は未接続・未検証。

foreground完了と全体完了を分け、aggregateCompletionConfirmed=falseを維持する。readからworker/prompt/queue/provider/外部Eventsを起動せず、approvalに回答しない。controlIsolationVerified=false・本番制御/更新拒否は変更しない。同一SID管理資源リスク・OS本人識別は未解消。

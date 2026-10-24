# 隔離startup / modern discovery試験の結果

## Summary

2026-10-07 13:20:27 UTC承認の2点だけを実施。`D:\Develop\pi-console` / `openai-codex/gpt-6.1-sol`を確認し、active subagent 0、新規子作業なし。

**隔離startup / modern discovery試験：合格。今回の実binary startupは1回、exit0、失敗0。** 空POSTを成功にせず400拒否したまま、modern2026-07-28を実binaryが受理し、startup probe succeeded・readyz200になりました。試験中のlegacy initializeは0件です。

このfixtureのstartupにlegacyは不要でした。実Dots、実owner認証、実scope、C1全scope縦断、本番は未受入。legacy/app adapter、guard、新認証、Phase2は実装していません。

## Evidence

- [開始保全](dots-phase1-modern-preservation.json) / [終了検証](dots-phase1-modern-verification.json)：既存70ファイルを保全対象とし、許可対象の `tests/dots-phase1-startup-probe.mjs` だけを変更。
- [実行結果](dots-phase1-modern-startup-attempt-1.json) / [request単位journal](dots-phase1-modern-startup-attempt-1.jsonl)：22イベント。版・binary hashの完全一致、自己試験、startup状態、全cleanupの結果を保存。
- binary SHA256：`1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`
- version：`0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0`
- 専用Temp/profile、clear＋allowlist child環境、dummy認証、固定main、MCP63888/control-plane63889のdynamic literal IPv4 loopback。healthも当該childのTemp URL fileから取得するdynamic loopbackのみ。

## Cause / observation

| correlation ID | body実測 | 分類・検証結果 |
| --- | --- | --- |
| request-1 | 非空、257–1024 bytes分類、読み取り完了 | server/discover。header/bodyの版2026-07-28とMcp-Methodを検証し200成功 |
| request-2 | 空、zero（0 bytes）、読み取り完了 | 認証header1個・値一致の非RPC startup probe。400/-32600 `NON_RPC_NO_BODY`。MCP成功にしない |
| request-3 | 空 | GET dotsは405、GET streamなし |
| request-4 / request-5 | 空 | OAuth protected-resource metadata両pathは404、OAuthをadvertiseしない |

それぞれrequest→body→validationを同じ非秘密IDで結び、各行を書込み＋syncしてから次へ進めています。非空の不正JSONは自己試験で400/-32700 `INVALID_RPC_JSON` と区別。未知値はother、body長は固定bucketであり、本文・header値・RPC ID・clientInfoを保存していません。

**原因はfixtureの「全POSTをJSON RPCとして解析する」前提でした。** 今回、同binaryからの認証済み非RPC POSTが実際に0 bytesであることを確認できました。[pin commitのresource_meta.go](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/pkg/oauth/resource_meta.go) はWWW-Authenticate discoveryでPOST→GETを試し、`http.NoBody` を使用します。このsourceと今回の空POST/header構造が一致します。400による拒否は、[HTTP仕様](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)のJSON RPC要求要件とも整合し、OAuthや匿名成功を加える必要はありませんでした。

前回はbody長を実測しておらずNoBodyはsourceからの推定でした。今回の証拠で前回の並行journalの個別因果まで遡って確定したとは扱いません。初回および前回の失敗証拠は上書きしていません。

## Modern acceptance / legacy

[現行Discovery仕様](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)どおり、200のJSON RPC resultに `resultType:complete`、`supportedVersions:[2026-07-28]`、`capabilities:{}`、固定serverInfo `_meta`、ttlMs0/cacheScope privateを返しました。**公開機能は読み取りのdiscoveryだけ**で、tools/resources/prompts/control/ownerAPI/Events/OAuth能力を宣言していません。未実装read toolもadvertiseしていません。

- 実binaryのmodern discovery要求1件に200。
- 当該childのhealthで startup probe `succeeded`、`readyz=200`、OAuth `state=not_advertised`。
- 成功状態の初回観測からさらに500ms以上、同じ限定試験内で状態を確認し、全traceにinitialize要求なし。その後childを終了。
- [同commitのprotocol_observation.go](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/pkg/mcpclient/protocol_observation.go)ではHTTP StartupProbeが完了しerr=nilの場合にsucceededを公開します。これは応答を返しただけでなく、binary側のstartup受理を裏付けます。一方HTTPのsame-child catalog観測はunsupported_transportであり、catalog/ツール実行の証拠とは扱いません。

従って**このpin binary＋fixtureのstartupにはlegacyは不要**です。前回のmodern400後のlegacy観測はfallbackと整合しますが、前回のcorrelation欠落を理由に厳密な個別因果は未証明のまま。今回の正常応答条件ではlegacyなしでstartupできたことを独立に示しました。長期運転、別serverや実Dotsにもlegacy不要と一般化しません。

## Changes / tests / attempts

変更はstandalone probeのみ。非RPC拒否と不正RPCを分離、非秘密correlation/body長bucket/検証結果を追加、modern discoveryにだけ成功応答を追加しました。認証値一致/重複拒否・固定path・無作用を維持し、literal host・Origin/proxy header拒否も明示化。GET dotsはmodern仕様のGET stream廃止に合わせ404から405へ変更（拒否のまま）。legacy initializeは拒否のみ。

自己試験は最初31PASS後、method mismatch・Content-Type・Accept・clientCapabilities欠落・不正版formatの5件を追加して36PASS。**36件が最終版の独立case数**で、startup実行前の内部自己試験でも確認しますが、件数は二重計上しません。

検証対象：正常discovery、空POST、不正JSON、未知版/mismatch版/method、header欠落/重複、認証missing/mismatch/duplicate、固定path/query、ownerAPI path、各control toolおよび未公開read tool、Origin/proxy/foreign Host、legacy拒否、metadata拒否、秘密混入時の観測redaction、chunkをまたぐdummy秘密検出、全requestのcorrelation順序。

実binary startupは修正後attempt-1だけ（再試行なし）。その前の31→36自己試験拡充はstartup失敗に対する修正ではありません。今回のfailure配列は空。空POST400/GET405/metadata404は意図した拒否であり失敗として合否を逆転させません。

## Boundaries / cleanup

raw body/header・キー・Authorization値・client raw log・profile内容は証拠へ保存していません。stdout/stderrはmemoryで固定dummy秘密の完全一致/分割chunk検査だけに使用し、検出0、終了時tail消去。任意encodingや未知秘密まで保証する監査ではありません。

所有child/HTTP fixtureの終了、pending handler終了、Temp削除を確認しました。実キー/既存data/grant・既存接続/profile・production portは使用せず、本番stop/restart/install/deploy、ACL/network/account/sandbox、provider/Events、commit/push/公開なし。binary/download/install変更なし。OS全体egress監査は未実施であり、fixture限定宛先の設定と区別します。

## Next minimum stage

今回の合格をもって停止。次は別承認のもと、アプリのmodern read adapter、専用固定guard、legacyとは独立したread認証を実装し、dummy対象/session scopeでcatalog/status/progressと対象違い・世代/stale・revocation・header/metadata/redirect・owner/control拒否を縦断確認する段階です。C1合格、本番受入、worker隔離検証済み、production更新可能とはまだ呼びません。既存のcontrol/更新拒否は維持します。

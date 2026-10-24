# Phase1 startup probe：観測修正・1回再実行の結果

## Summary

2026-10-07 12:25:38 UTCの承認範囲のみ実施。`D:\Develop\pi-console` / `openai-codex/gpt-6.1-sol`、active subagent 0を確認し、新規subagent/orchestratorは起動していません。

**観測修正の受入は成功、startup fixtureは拒否のまま（exit2）、C1は未達です。** 自己試験14件合格後、同じbinaryでstartupを1回だけ再実行しました。失敗条件を `MCP_INVALID_JSON` と記録でき、要求protocolはmodern/legacy両方の値を観測できました。adapter/guard/認証独立・Phase2は未実装です。

初回の[失敗記録](dots-phase1-startup-probe.json)・[報告](dots-phase1-result.ja.md)は上書きせず保存しています。初回の原因を後から確定したという意味ではありません。

## Evidence

- binary SHA256：`1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`
- `--version` の完全一致を再確認：`0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0`（git shaも一致）。出力は版確認にのみ使用し、raw client logは保存/表示していません。
- 試験宛先：専用Temp/profile、dynamic IPv4 loopback MCP51272 / control-plane51273、固定main、固定dummy認証、新 `/mcp/dots` fixture。既存profile/接続/binary更新・downloadは使用していません。
- [構造化journal](dots-phase1-startup-observation.jsonl)：16イベント。request情報をFileHandle書込み＋syncで先に残し、後続のassert/parse/固定failure codeも保存しました。
- [実行結果JSON](dots-phase1-startup-observation.json)：startupRuns 1、hash/version検証成功、`MCP_INVALID_JSON`、owned child/fixture終了・Temp削除成功。
- [開始保全manifest](dots-phase1-observation-preservation.json) / [終了検証とsource hash](dots-phase1-observation-verification.json)。

## Observed requests / failure

| 実観測 | 記録した非秘密の構造 | 判定 |
| --- | --- | --- |
| POST /mcp/dots（protocol headerなし） | dummy MCP認証headerは1個。Content-Type/MCP-Protocol-Version/Mcp-Methodはなし | journalにJSON parse失敗1件を `MCP_INVALID_JSON` / 500として保存。raw bodyや本文長は保存していない |
| POST /mcp/dots / server/discover | HTTP版2026-07-28、Mcp-Method=server/discover、body `_meta` の版2026-07-28。認証header1個 | modern要求を実binaryで観測。fixtureは元の設計どおり400/-32601を返す。modern成功ではない |
| POST /mcp/dots / initialize | body `protocolVersion=2025-11-25`。HTTP版/Mcp-Methodなし。認証header1個 | legacy要求を実観測。fixtureは400を返し、legacyを受け入れていない |
| GET /mcp/dots と2種類のmetadata path | 固定dots / dots-metadata / root-metadata分類。認証header1個 | 元と同じ404。OAuthやEventsを追加していない |
| dummy control-plane GET metadata/poll | Authorizationは有無/個数だけ記録。MCP認証headerなし | fixture内のみ。scope/実行commandを投入していない |

要求は並行しており、journalにはrequest correlation IDを追加していません。したがって行の前後だけから個別requestの因果を断定せず、JSON parse失敗1件・有効JSON RPC2件・該当header構造を区別して報告します。版値は固定allowlistと照合した観測値であり、MCP契約全体の検証/negotiation成功ではありません。

結果JSONの `protocolDetermined:true` は「要求内の既知版値を観測できた」という意味です。**選択・合意された接続protocolは未確定**で、`legacyObserved:true` はlegacy必須を意味しません。

## Primary specification / source comparison

公開一次資料のみ、binaryのgit sha固定sourceと仕様を照合しました。

1. [同commitのOAuth resource_meta.go](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/pkg/oauth/resource_meta.go) の `probeWWWAuthenticateResourceMetadata` はPOST→GETを試し、`tryWWWAuthenticateProbe` は `http.NoBody` で要求を作ります。Acceptを設定する一方、この関数でContent-TypeやMCP版を設定しません。今回の非JSON POST/header構造は、このstartup認証discovery probeと整合します。**実bodyが空だったことはbyte長の実測記録がないため、sourceからの推定**です。
2. [同版configuration](https://github.com/openai/tunnel-client/blob/v0.0.15/docs/configuration.md) はWWW-Authenticate probe、metadata discovery、startup MCP probeを区別し、discovery用header設定も説明しています。今回認証headerは観測上欠落しておらず、「キーがないことが原因」とは判定しません。
3. [MCP 2026-07-28 HTTP仕様](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#backward-compatibility) はmodernから開始し、400のbodyが認識可能なmodern errorでない場合にinitializeへfallbackする互換動作を記述しています。fixtureの意図的な400/-32601はmodernの正常discovery応答ではありません。その後の2025-11-25 initializeは、この拒否に対するfallbackと整合します。

以上から、**「全POSTは必ずJSON RPC」という元fixtureの前提は、同binaryの認証discovery用NoBody POSTを考慮していない**ことが分かりました。受信解析を失敗させる保護条件は今回も維持し、通すための条件変更はしていません。modernを実binaryが要求することは確認できたため、最新版の存在だけによる推測ではありません。ただしmodern成功応答でlegacy fallbackが不要になるかは試験しておらず、legacy必須とも非必須とも実運用判定していません。

## Observation protection / self-test

対象script以外のアプリ本体・auth/gateには変更なし。固定header/path/認証の受入条件を維持し、GET404 / 正常解析POST400 / 条件失敗500も維持しました。観測を検証前に置くためparseの順序は変わっていますが、認証不正や不正JSONを成功応答にしていません。

自己試験14件は、未知method/path/header名/value、query、body/clientInfo/metadataのdummy秘密混入をbounded分類へ変換し、既知版だけを記録すること、missing/duplicate/mismatch/query失敗code、chunkをまたぐ秘密検出、失敗より前のjournal永続化を確認しました。実行mode内でも同じ防護検査を適用していますが、合格数を28件へ水増ししません。

raw headers/body・Authorization値・キー・raw client logはjournal/reportへ残していません。client stdout/stderrは短いmemory tailによる固定dummy秘密の非露出検査だけに使用し、終了時に消去。完全一致/分割chunkでの検出は0でした。任意encodingや未知秘密すべてを検出したという保証ではありません。

実profile/既存data/実キーの取得、実grant・接続変更、本番port・本番stop/restart/install/deploy、OS/ACL/network/account/sandbox設定、provider/Events/Orchestrator、commit/push/公開はなし。試験child/HTTP fixtureだけをfinallyで終了しました。OS全体のegress監査は実施しておらず、宛先はfixture限定設定として記録します。

## Next minimum change / owner decision

今回はここで停止します。提案は次の2点だけです。

- **probe条件の別承認**：認証discovery用の非RPC POSTを構造化分類し、認証/固定path/無作用を保ったまま適切な拒否400等を返すことと、RPC JSON不正の拒否を区別する。空POSTをMCP成功として扱わず、auth/gateを緩めない。現500→別の拒否分類/扱いは条件変更なので、今回自動適用しません。
- **modern成功を試す次段階の別確認**：2026-07-28 `server/discover` の正しい限定成功応答を用意した隔離試験で、legacy fallbackの必要性を判定する。今回の権限は観測修正のみなので、adapter/guard実装や再試行はしていません。legacyが実際に必要なら、2025-11-25の必要差分を改めて報告・承認待ちにする。

診断の成功とC1「隔離実binary transport＋dummy scope合格」、実Dots/本人認証/実scope/本番適用の合格は、引き続き別です。

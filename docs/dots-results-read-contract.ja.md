# Dots result read：共通service / ツール契約

## Status

2026-10-07 13:52:55 UTC承認の4機能のread core・passive runtime projection・host opt-inツール契約を実装。**既定OFF、両endpoint未登録、既存接続/permission未変更**です。実Dotsに公開済みとは呼びません。`server/results-read.ts` / `server/results-read-tools.ts` / `shared/results-read.ts`。

既存status-only read/control scopeは本文・path・ファイル公開の同意ではありません。serviceのenabled=true **かつ**正確なtargetに対するfeature grant、tool factoryのenabled=trueを要し、その上で既存WorkspacePermissions.admitのinstance/revision/workspace/session/generation照合と排他lockを通します。targetは `{instance,revision,workspaceId,sessionId,generation,runId}`。featureはhistory/aggregate/artifacts/metadata、grantはexact target＋feature一覧＋expiresAt。default grant=[]。実際のgrant UI/保存/接続管理を追加したわけではなく、trusted hostが別途同意を取得して供給する契約です。

HTTP認証は呼出adapterの責務で、service admissionは認証やOS隔離ではありません。どちらのendpointにもimport/registrationしていません。旧endpointを使って新側の拒否を回避せず、`controlIsolationVerified()`・既存receipt/二重実行防止・production更新拒否も不変です。

## Tools

共通必須引数はtargetの6項目。未知引数、path/URLや任意scopeの指定は拒否。

| tool | feature | 追加引数 | 結果 |
| --- | --- | --- | --- |
| read_history | history | cursor?, limit1–100（default50） | sequence付き差分、nextCursor/highWaterSequence、paging/gap/truncation/storage/readable/bodyUnavailable/redactionPending。承認は読むだけ |
| read_work_state | aggregate | なし | foreground terminalとaggregateを分離。coverage/fresh/incomplete/completionConfirmed、確かな子だけの状態 |
| read_target_metadata | metadata | なし | 許可対象のみの表示名/canonicalpath/session名、savedModel/runModelを分離。未観測=null＋unknownFields、source明示 |
| list_artifacts | artifacts | offset0–1024?, limit1–100? | 明示登録artifactのmetadata、nextOffset。ファイル探索なし |
| read_artifact | artifacts | artifactId, version, offset0–8MiB?, limit1–32768? | bounded inline base64、chunkSha256/全体sha256/size/bytes/eof/nextOffset |

MCPツール結果はJSONのstructuredContentと同じ内容のtext block。`trust:untrusted_data` / `instructions:false`を付けます。ツール名・annotationsだけで信頼を主張せず、返った本文や成果物から新permissionや命令を作ってはいけません。factoryのエラーは固定codeのみ、filesystem例外のpath等を返しません。承認回答、命令submit、resume、queue dispatch、worker.open/callはserviceから呼びません。

## History

sourceは既存SessionEventsの最大5000 retained events。同じgeneration/runのbodyだけをwhitelistし、thinking・tool arguments・自動path抽出・任意sessionfile読取りはしません。scope外のeventは返さず、許可session全体のsequenceをhighwaterとして使います。server専用鍵のHMAC cursorは全targetとafter-sequenceをbinding。再送の同cursorは同範囲を返し、受信側はsequenceでupsert/重複除去します。cursorはservice再作成では無効。sequenceの重複/欠落、先頭retention欠落、末尾projection欠落をgapとして明示。

1 eventのtextは8192 UTF-8 bytes以下、最大100件。全選択textが512Ki charactersを超えるprojectionは本文を返さずtruncation/readable=falseにします。upstream tool outputのtruncationや本文欠落も明示し、summaryだけで本文取得成功としません。body保存中/expired/unknownのprojectionは読めたとは言わず、completionConfirmedは常にfalse（本文取得から全体完了を推定しない）。MessageCompletedは発話の完了であって全作業終了ではありません。roleとtoolNameもwhitelist projectionとして返します。

knownSecretsの完全一致はdelta/pageを跨いでもmask。末尾のknown-secret prefix候補はwithholdし、redactionPending/readable=false、cursorを該当eventの直前に保持して後で再取得します。一般のencoded/分割/変形秘密をすべて検出する保証ではありません。

**実runtimeの範囲**：メモリ上の現generation/retained eventsのみ。起動前の保存historyを読むためにworkerを開いたり、run binding不明のchat履歴を当該runへ推測で紐付けたりしません。再起動/未観測対象はtarget_unavailable等で拒否します。

## Aggregate

明示/derived-safe parentの祖先関係だけを辿り、無関係nodeを対象runへ付けません。parent完了でもchild running/waitingならaggregateはrunning/waitingでcompletionConfirmed=false。failed/cancelled/unknownを別に返し、terminal確認は成功の保証とは別です。

全対象終了の確認にはlive、30秒以内のprojection、全5 coverage（pi/subagents/orchestrator/queue/background）complete、重複/cycle/unknown状態なしを要求。切断/古いprojectionはunknown。関係不明の稼働nodeはincompleteで、勝手に所属を推測しません。wholeOSIdleConfirmedは常にfalse。

**実runtimeの範囲**：既存projectionには全generator・queue・backgroundの確実なrun関係/censusがないためcoverageはincompleteを返します。自動OS探索やkit起動は追加しません。dummyの完全な関係projectionは完了判定まで検証できますが、実runtimeでall-work completionを証明したとは呼びません。

## Artifacts

trusted producerだけが `registerArtifact(target,{relativePath,name,mime,kind:generated|attached})` を明示呼出。これはMCP toolではありません。モデル本文の「生成しました」やURL/任意pathを解析して登録しません。現worker/attachment producerには自動登録を接続していません。

run binding、opaque UUID、name/MIME、size/SHA256/version（content hash）、inode/time/root identityをmemory registryへ保存。全体最大8MiB、1転送32KiBまで。textも同じbyte転送なのでUTF-8 chunk跨ぎで欠落せず、clientはbase64復号後に結合、全体hashを確認してdecodeします。対応MIMEはtext/plain, text/markdown, text/csv, application/json, application/octet-stream, application/pdf, image/png/jpeg/webp。

許可workspace内のrelativePathのみ。traversal/absolute/UNC/URL/ADS、credential names (.env, key/pem/pfx/p12, auth/credentials/secrets/token等)、.git/.pi/permission/receipt資源を拒否。root/canonicalpath/各ancestorとleafを再確認し、symbolic link/junction/hardlink、削除、差替え、in-place更新、サイズ超過、version違い、scope/revision/generation違いを拒否。descriptorとpathのidentity、read前後stat、全体hashを再確認。known-secret bytesを含むファイルは内容公開せず登録/取得を拒否します。任意コードの全秘密検出保証や同ユーザー攻撃に対するOS sandboxではありません。

### Client contract / transfer limits

[pin済みofficial clientのconnector契約](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/docs/connectors.md)はJSON RPC callと対応する最終responseを転送する契約です。[既存2025-06-18 tool契約](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)はstructuredContentとserialized text併記を定義しています。[MCP resource](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)にはbase64 blobがありますが、pin client/Dotsがresourceを取得・保存・提示できることは未実測で、既存endpointもresources能力を宣言していません。

今回は新resource能力/URLを作らず、通常tool JSON内のbase64 chunkを採用。未知のダウンロードURLやfile URIは返しません。仕様/転送契約に整合する設計とdummy coreでのbinary roundtripは確認していますが、**実clientのbinary転送・保存成功は未確認**。最小の次試験は許可済みadapterを隔離fixtureにだけ接続し、同pin binary経由でread_artifactの複数chunk/全hashを確認、その後実Dots側の復号・保存対応を確認することです。未対応ならclient側のbounded chunk結合/保存実装が必要で、モデルへbase64を貼る運用を完成形とは呼びません。

## Metadata

workspace表示名/canonicalpathはpermission対象の登録だけから取得。session名は既存projection、modelは観測projectionだけ。savedModelをactual run modelとして流用しません。今の実runtimeには保存設定/実Pi run modelの確かな投影がないためnull/unknownであり、既存options()を呼んでworkerを開く回避はしません。dummyでは両者が異なるケースを確認しています。未許可workspace/session名・path/historyのlisting機能は追加していません。

## Remaining minimum operation

貼付往復をなくすために残るのは、(1) owner同意したfeature/scopeを渡す認証済みadapterへの明示接続、(2) 実producerの明示artifact登録と確かなrun/model/children coverage投影、(3) pin client→実Dotsの本文・byte転送/保存試験です。今のowner管理資源隔離/auth既知リスクとcontrol拒否は未解決で、「Dotsから依頼」の起動権限をread機能や旧endpointで迂回できません。今回実scope/接続/本番は変更せず、無断で大きなauth/broker/sandbox基盤を追加しません。

# 3操作試験 — 接続確認で停止、実作成なし

2026-10-20。ユーザーの本人承認完了報告を受け、既存Codex pi_console_localの正規経路で接続6457004cからの継続ではなく、新しい対象 **fcf3c891-84b6-4b2a-a074-8dd4637aeaa5** の実許可を確認しようとした。

**結果は接続確認RPCの拒否。ディレクトリ・repo・workspaceの実作成はすべて未実行。**

## 実際の結果

- 実Codex CLIで既存selected設定のalias/enabled/stdio/command/args/cwdと所有hashを確認した。
- 既存管理helper内部の署名検証で、現行brokerのPID26656 / startedAt=2026-10-19T06:21:30.396Zを確認した。
- actual Codex app-server MCP clientがpi-console-local-resumeのcatalogをロードした。
- **00:34:31–00:34:33 UTC、get_local_connectionの呼出がapp_server_rpc_rejectedとなった。** 生のエラーメッセージ/秘密/生protocolは記録しておらず、この応答だけで拒否の細かい原因を確定していない。
- connectedと接続ID、承認済み親・4操作・7日のmetadataを取得できなかったため、list_allowed_parentsにも進まず停止した。
- create_managed_workspaceの送信は**0回**。作成helperは未到達で、creation-result.jsonも生成されていない。get_operation、作成後のfilesystem検査、registry読取/書込、Git rev-parseも実行していない。

予定していたpathは次のままである。今回の作成物はない。この失敗後にscope guardを迂回してpathを直接作成したり、未確認の権限でfilesystemを調べたりしていない。

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019\mcp-create-check-20261019
```

workspace IDの発行/登録はなし。repoの固定.git生成もGit自身での認識確認も未実行。既存物の上書き、削除、Pi起動、外部repo/remote/clone/push、導入、追加権限/再申請/取消/本人再認証/設定削除はゼロ。

## 残る確認

本人画面のこの接続のstateと接続期限を非秘密情報で確認する必要がある。今回のMCP拒否を、親や4操作の指定違い、grant取消、期限切れのいずれかと断定していない。

実装上、初回のprivate claimにも短期access期限の検査があり、未受取のclientはget_local_connectionでそれを通らないと保存済み再接続proofを得られない（server/folder-mcp.tsのclaim/live、package/local-resume-session.mjsのget）。ただし今回の承認時刻/短期期限は取得できていないため、これが原因という実証はまだない。

接続確認前に検証scriptの準備を先行させ、最初の確認が00:34:31になった。初回の短期受取り時間を消費する進め方だった点は残る。今後の調査でも権限を迂回せず、再承認や資格再作成を無断で行わない。

## 終了と証拠

所有Codex app-server PID36372はexit0で終了し、processと直接の子が残っていないことをPID metadataだけで確認した。引数・環境は照会していない。モデルturn・永続threadはゼロ。通常companion内部以外でtoken/code/cookie/profileを取得せず、秘密を出力・転送していない。pi-wardenは未接触。

証拠: codex-read.json、owned-processes-ended.json、実行したtrial.mjs、未到達のperform-create.mjs。今回の範囲では新しい資格・grant・申請を作らず、本人が承認した状態も変更していない。

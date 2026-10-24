# 本番反映前チェック — 状態確認待ち、未適用

2026-10-20。本人の明示承認 Sentinel_0f642298b33881919b6cd1bdf25429ed に基づく、初回claim修正候補の反映・管理再起動・新規申請準備タスク。

## 完了した読み取り・保全

- 候補sealと全成果物hash一致。対象3実装ファイル + 新規回帰1ファイルに競合なし。
- 候補作成時のpublic source 138ファイルがDの現在値と一致。既存未コミット変更を保持。
- 変更予定3ファイルは本作業Tempのsource-beforeへ保全。dist 37ファイルのhash、既存Codex設定hash、既存データ8項目の存在/size/mtime/file identityだけを記録。秘密・保護state本文・環境一覧は読み出し/複製/出力していない。
- 既存正規管理helperで稼働所有を確認: pi-console 0.5.2、PID26656、startedAt 2026-10-19T06:21:30.396Z、127.0.0.1:31717。
- 停止前に既存Startup resolverを検証: インストール済みPi 1.1.0のpublic selector/manifest/cliへ解決し、readonly MCP OFF。Piの起動・再インストール・設定保存はない。
- apply-source.mjs と restart.mjs を本作業Tempに準備したが実行していない。現在の本人による両job停止確認を記録したjob-confirmation.jsonがなければ実行できない。後者は管理PID/開始時刻・候補hashを再照合し、正規Startup環境を使う。

最初のsandbox内管理確認はloopback到達が成立しなかった。読み取りのみの正規管理確認を許可した実行で確認できた。停止や変更は試していない。

## 現在のブロッカー

1. **現在のPi実行/orchestrator停止状態が未確認**。既存管理APIに件数がなく、本文や秘密を取得せず確認するため、本人へasync質問を送った。過去の停止回答を今回の現在状態と扱っていない。回答が届くまでsource反映/再起動は行わない。
2. **新規申請を開始するときの既存資格の通常復元と、今回の禁止条件の整合**。server/local-mcp-http.mjsではrequestを処理する前にservice()を呼ぶ。server/local-mcp-installation.mjsのget()はcreateLocalMcpCompositionを初期化し、server/local-mcp-composition.mjsのrestore()が既存の承認済み・grant未失効familyを読み込み、短期5分bundleが切れていればissuer.bundleとtransactionで資格を更新してruntimeに復元する。これは新規requestだけを呼んでも起こり得る。grant期限/親/操作は変わらないが、「既存の実資格を更新/復活させない」を保証できないため、その経路を実行していない。通常の内部復元を許可するか、新規申請を保留するかを本人へasync質問した。保存stateを手動解読したり、新しい別storeへ迂回したり、既存grantを勝手にrevokeする操作は行っていない。

元のfcf接続をget/claim/resume/renewしていない。新規申請scriptを旧scriptのまま使うと冒頭のgetが既存保存接続を自動更新し得るため、それも実行していない。後続で新規申請を行う場合は旧接続へのgetを避け、必要なローカル取消と新規beginだけを行い、新しいIDを得る。本人最終承認を代理実行しない。

再起動後はowner listener/cookieが終わるため、必要なら本人が既存owner-login CLIでyes・コード入力して新しい本人画面を開く。コード/cookieをチャットへ送ってもらわず、agent側で読み取って代理確認しない。新規申請の親は既存試験親 `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019`、操作list/directory/repo/workspace、7日。申請ID/期限は、まだ新規申請を送っていないので未発行。

## 実施回数

source反映0、dist変更0、stop0、start0、restart0、実資格生成/更新/配布0、実grant変更0、新規申請0、実client起動/接続0、実データでdirectory/repo/workspace作成0。今回の追加試験0（候補の106/106 PASS証拠を照合済み）。画像0、人への依頼は2つの状態/条件質問。pi-warden作業なし、commit/push/publishなし。

作業root: C:\Users\leade\AppData\Local\Temp\pi-console-initial-claim-apply-20261020-a73d。証拠はbefore.json、source-before/。次は本人回答を取り込み、許可された範囲だけ続行する。

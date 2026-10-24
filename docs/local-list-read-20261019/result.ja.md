# CodexローカルMCP・許可対象一覧の実読取成功

2026-10-19。ユーザーの接続完了報告後、既存Codexのpi_console_local設定を実CLIで確認し、その同じcommand/args/cwdを使う実Codex app-server MCP clientで読み取りに成功した。最初の成功結果は作業中にもすぐ報告した。失効試験・設定削除は行っていない。

## 確認した非秘密の範囲

- 接続ID: **6457004c-aeb4-4c0a-904c-27f2eb6c3bff**（依頼されたIDと一致）
- 親: **C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019**（canonicalな小文字表記で返り、指定pathと一致）
- 操作: **listだけ**
- grant期限: **2026-10-26T08:34:43.484Z**（日本時間17:34:43）
- 期限は7日設定と整合。サーバーの期間選択肢7日/31日/無期限のうち、観測日時・先の申請時刻と返却期限から7日に一致することを確認した。

呼んだMCP toolは **get_local_connection → list_allowed_parents の2回だけ**。最初に接続IDとconnected状態を確認し、次の1回で許可metadataを読み、親1件・listだけ・期限が想定に一致するか検査した。この一覧toolが範囲確認そのものを返す。想定不一致なら以後の呼出を止める分岐にしていたが、今回は一致した。

## 読み取り結果の意味

**今回読めたのは「許可された親フォルダ、許可操作、有効期限の一覧」である。** 返却された親は1件。toolは許可された親のidentityを検証し、このmetadataと、この接続の作成receiptに記録されたworkspace情報だけを返す。今回そのworkspace記録は0件だった。

試験フォルダ内のファイル一覧、既存workspace全体、ファイル本文を取得するtoolではなく、これらは実行していない。workspace記録0件を、ディレクトリ内のファイルが0件という意味に使ってはいけない。現在も空であるという再判定はしていない。

実証したのは、実Codex clientから現在のConsoleへの接続・通常の内部認証/資格受取・許可metadataの読み出しが動作すること。ファイル列挙、repo/workspace作成、Pi実行、run/history/final本文共有の試験はしていない。

## 境界と保全

設定の所有hashと実Codex CLIのselected server設定が一致し、書換はゼロ。管理helper内部で現行のPID26656/startedAt=2026-10-19T06:21:30.396Zのbrokerを検証した。秘密・コード・cookie・profile・生protocolは読取/保存/出力していない。通常のcompanion内部の承認済み資格受取/保護保存だけを使った。

新規申請、grant承認、取消、作成、失効テスト、設定削除はゼロ。scopeや期間を追加・変更していない。試験フォルダ、Codex設定、現在の7日grantはそのまま残している。pi-wardenは未接触。

Codex app-serverは専用の一時CODEX_HOMEとephemeral contextを使い、モデルturn/永続threadはゼロ。app-server PID39316はexit0で終了し、本人processと直接の子が残っていないことをPID metadataだけで確認した。引数・環境の照会はしていない。

証拠はcodex-read.json、read-result.json、owned-processes-ended.json。これらには非秘密の接続ID・許可path/操作/期限・実行tool名・終了状態だけを保存した。

# 本人取消後・CodexローカルMCPの拒否確認

ユーザーの「もう取り消した」という報告後、直前と同じ既存Codexのpi_console_local設定/clientIdで試し、**再接続と許可対象一覧の取得が両方拒否された**。対象は直前に成功した接続 `6457004c-aeb4-4c0a-904c-27f2eb6c3bff` の保存済みclient状態。既存設定hashと実Codex CLIのselected設定を確認し、現行brokerのPID26656/startedAt=2026-10-19T06:21:30.396Zを既存管理helper内部で検証した。

結果は取得直後に作業中の報告でも通知した。

| 呼出 | 結果 |
| --- | --- |
| get_local_connection | 拒否。`local_resume_or_scope_unavailable`、MCP内部の-32602を確認。app-server側の包みは-32603 |
| list_allowed_parents | 同じ理由で拒否。許可一覧metadataは返らなかった |
| 接続状態 | この再接続ではconnected状態は成立しなかった。エラー応答のため、serverの明示的なstate文字列を取得したものではない |
| 想定外の読取 | なし |

## 確認範囲

実際のインストール済みCodex app-server MCP clientから、選択済みserverだけを起動し、以前と同じ2つのtoolを呼んだ。新規申請、取消の重複、本人再認証、grant承認/再作成、権限追加、作成tool、設定削除は実行していない。明示的なcredential更新toolも呼んでいない。秘密や生protocolは出力/保存していない。

前回のapp-serverは既に終了していたため、今回は保存済みclient状態を使う新しいclient processである。再接続が拒否され、そのため接続が未成立のcompanionは一覧toolも拒否した。このコード経路では、一覧のserver RPCは接続成立guardを通らない。**既存processのメモリに残るtokenを保持したまま、一覧RPCをserverへ直送した試験とは区別する。** serverの暗号化grant記録を直接読んでrevoked状態を確認したものでもない。

通常の既存Codex利用経路で、本人取消後に接続を再開できず、許可対象一覧も取得できなかった、という実証である。元のgrant期限は10月26日であり、現在の操作は期限を進める失効試験ではない。フォルダ内のファイル一覧・本文・run/history/final本文は取得していない。

設定・試験フォルダ・保存済みclient記録はそのまま残した。再申請、grant作成、cleanupを勝手に始めていない。予期せず読めたら以後のアクセスを止める分岐だったが、今回は拒否された。pi-wardenは未接触。

Codex app-server PID7380はexit0で終了し、processと直接の子が残っていないことをPID metadataだけで確認した。引数・環境の照会はなし。モデルturn・永続threadはゼロ。

証拠: public-result.json、codex-revoke-read.json、owned-processes-ended.json。非秘密のエラー種別、設定一致、tool名、接続未成立と終了状態を保存した。

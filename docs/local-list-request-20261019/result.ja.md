# CodexローカルMCP・一覧だけの試験申請

現行のpi-console PID26656 / startedAt 2026-10-19T06:21:30.396Zに対し、実際のインストール済みCodex CLI app-serverのMCP client経由で、新しい未承認申請を作成した。作成時の結果はpending / connected=false。最終承認・grant作成・フォルダtool呼出はしていない。

- **本人画面で選ぶ接続ID**: `6457004c-aeb4-4c0a-904c-27f2eb6c3bff`
- **requestId**: `codex-list-trial-99aee0c4-b4a6-4bf0-b7c9-d612c04f4aff`
- **申請待ち期限**: `2026-10-19T09:31:10.314Z`（日本時間18:31:10）
- 作成応答時の残り: **3599秒**。非秘密のrequestExpiresAtと呼出前後時刻による待ち幅は3,599,149–3,600,994msで、約60分を確認した。固定期限であり、再表示で延長しない。

## 本人の最小操作

本人確認済みのConsole PC画面で「ローカル連携を始める」（開いていれば「接続一覧を再取得」）を押し、上の接続IDを選ぶ。

親フォルダは次の既存試験フォルダを指定し、期間は**7日**にする。

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019
```

操作は**「許可対象一覧」だけ**を残す。初期選択されている「新しいディレクトリ」「空local repo」「workspace作成・登録」の3つを外す。「許可内容を確認」でこの親・一覧だけ・7日であることを確認し、接続IDの確認チェック後、本人が「この内容で始める」を押せる。

**申請そのものにはまだ親folderや操作権限は付いていない。** この正規申請APIはclientからscopeを固定する方式ではなく、本人のreview画面で親・操作・期間を確定する。こちらがlist以外を許可したりgrantを作ったりしていない。承認後の資格受取/接続確認/listも今回まだ呼んでいない。

本人確認の残り時間はclient応答からは確認できず、cookieを取得していない。本人画面が期限切れと表示した場合は承認を進めず、本人が通常のowner-loginで再確認する必要がある。こちらで再認証・コード発行を代行していない。本人確認10分とこの申請待ち60分は別の期限である。

## 正規経路と境界

1. Dの既存pi_console_local設定の所有hashが一致し、実Codex `mcp get pi_console_local --json` でenabled/stdio/command/args/cwdの一致を確認した。設定の書換や再登録はゼロ。
2. 対象試験フォルダは既存所有記録のpath/file identityと一致。内容は列挙しておらず、MCP folder toolも呼んでいない。空として作られた既存試験フォルダの内容を未承認で読み直してはいない。
3. 既存管理helperが内部で署名照合した現行loopback broker（127.0.0.1:51443）を使った。管理token/code/cookieやproofをチャット/URL/argv/logへ出していない。clientInfoは認証に使っていない。
4. actual Codex app-serverは新しい専用CODEX_HOMEで選択済みserverだけを起動し、検証済みの同じcommand/args/cwdを渡した。モデルturnゼロ・永続threadゼロ。六つのtool catalogとpi-console-local-resumeを確認した。
5. 事前に承認済みserver/client状態ファイルがないことをmetadataで確認し、正規のcancel_local_connectionで古いexpiredローカル記録を閉じた。これはgrant解除ではなく、期限切れ申請の延命でもない。その後、別の新requestIdでbegin_local_connectionを1回呼んだ。get_local_connection/claim/renew/list/create/owner approveは呼んでいない。
6. MCPの用途別read/control/final資格・grantは作っていない。新規申請に必要なprivate enrollment proofは通常のcompanion内部で保護・送信され、生値は取り出していない。汎用の旧echo pluginの申請toolは使っていない。

申請用Codex app-server PID41524はexit0で終了し、PID照会で本人processも直接の子も不在を確認した。引数・環境・生protocolは読取/保存していない。実稼働Consoleはこの試験の終了対象ではない。申請intentは通常の保護状態として残り、client終了で申請を自動取消しない。

証拠: preflight.json、request-intent.json、public-request.json、codex-real-request.json、owned-processes-ended.json。コード/秘密値ではなく、非秘密のID・期限・手順だけを報告した。最終承認以降の状態は監視していないため、この記録のpendingは作成応答時の状態である。
